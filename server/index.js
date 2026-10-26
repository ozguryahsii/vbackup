import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, tx, audit, getSetting, setSetting, dailyBackup, snapshot, DB_PATH, MIG_STATUSES, DATA_DIR } from './db.js';
import { importPolicyWorkbook, importInventory } from './importer.js';
import {
  serverSummaries, summarizeServer, loadAll, stats, findings, windowHeatmap, runsForDate, monthCalendar, levels,
} from './analytics.js';
import { REPORTS, reportData, toXlsx, toPdf } from './reports.js';
import { detectTape } from '../public/js/lib/schedule.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules/chart.js/dist')));

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};
const filtersOf = q => ({
  system: q.system || '', environment: q.environment || '', criticality: q.criticality || '', policy_type: q.policy_type || '',
  tape: q.tape || '', covered: q.covered || '', active: q.active || '', mig_status: q.mig_status || '', q: q.q || '',
});
const sysOf = q => (q.system ? { system: q.system } : {});

// ---------- Meta ----------
app.get('/api/meta', (req, res) => {
  const distinct = col => db.prepare(`SELECT DISTINCT ${col} v FROM servers WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY 1`).all().map(r => r.v);
  res.json({
    levels: levels(),
    migStatuses: MIG_STATUSES,
    systems: db.prepare('SELECT DISTINCT backup_system v FROM policies WHERE backup_system IS NOT NULL ORDER BY 1').all().map(r => r.v),
    policyTypes: db.prepare('SELECT DISTINCT policy_type v FROM policies WHERE policy_type IS NOT NULL ORDER BY 1').all().map(r => r.v),
    methods: db.prepare('SELECT DISTINCT method v FROM policies WHERE method IS NOT NULL ORDER BY 1').all().map(r => r.v),
    environments: distinct('environment'),
    criticalities: distinct('criticality'),
    platforms: distinct('platform'),
    statuses: distinct('status'),
    waves: distinct('mig_wave'),
    owners: distinct('mig_owner'),
    importedAt: getSetting('imported_at'),
    companyName: getSetting('company_name', ''),
    empty: !db.prepare('SELECT COUNT(*) c FROM servers').get().c,
    reports: REPORTS,
  });
});

// ---------- Sunucular / Envanter ----------
const SERVER_FIELDS = ['hostname', 'domain', 'ip', 'environment', 'platform', 'vcpu', 'ram_gb', 'disk_gb', 'status', 'description',
  'criticality', 'os', 'location', 'owner_team', 'inventory_key', 'notes', 'mig_wave', 'mig_status', 'mig_target_date', 'mig_owner',
  'mig_target', 'mig_first_backup', 'mig_restore_test', 'mig_notes'];

app.get('/api/servers', (req, res) => {
  const { list, data } = serverSummaries(sysOf(req.query));
  const byId = new Map(data.servers.map(s => [s.id, s]));
  res.json(list.map(s => {
    const r = byId.get(s.id);
    return {
      ...s, domain: r.domain, ip: r.ip, vcpu: r.vcpu, ram_gb: r.ram_gb, disk_gb: r.disk_gb, owner_team: r.owner_team, source: r.source,
      mig_owner: r.mig_owner, mig_target: r.mig_target, mig_first_backup: r.mig_first_backup, mig_restore_test: r.mig_restore_test, mig_notes: r.mig_notes,
      full_lines: undefined, incr_lines: undefined, other_lines: undefined, passive_lines: undefined, tape_lines: s.tape_lines,
    };
  }));
});

app.get('/api/servers/:id', (req, res) => {
  const id = Number(req.params.id);
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!server) return res.status(404).json({ error: 'Sunucu bulunamadı' });
  const data = loadAll(sysOf(req.query));
  const pols = data.byServer.get(id) || [];
  const host = new Map(data.servers.map(s => [s.id, s.hostname]));
  res.json({
    server,
    summary: summarizeServer(server, pols, data.levels),
    policies: pols.map(p => ({
      ...p,
      client_name: p.clients.find(c => c.server_id === id)?.client_name,
      peers: p.clients.length,
      clients: p.clients.slice(0, 50).map(c => ({ id: c.server_id, hostname: host.get(c.server_id) })),
    })),
    exceptions: db.prepare('SELECT * FROM exceptions WHERE server_id = ? ORDER BY id DESC').all(id),
    audit: db.prepare("SELECT * FROM audit_log WHERE entity = 'server' AND entity_id = ? ORDER BY id DESC LIMIT 50").all(id),
  });
});

function pickServer(body) {
  const o = {};
  for (const f of SERVER_FIELDS) if (f in body) o[f] = body[f] === '' ? null : body[f];
  if (o.hostname) o.hostname = String(o.hostname).trim().toUpperCase();
  return o;
}

app.post('/api/servers', (req, res) => {
  const o = pickServer(req.body);
  if (!o.hostname) return res.status(400).json({ error: 'Hostname zorunludur' });
  if (db.prepare('SELECT id FROM servers WHERE hostname = ?').get(o.hostname)) return res.status(409).json({ error: 'Bu hostname zaten kayıtlı' });
  const keys = Object.keys(o);
  const r = db.prepare(`INSERT INTO servers(${keys.join(',')}, source) VALUES (${keys.map(() => '?').join(',')}, 'manual')`).run(...keys.map(k => o[k]));
  audit('server', Number(r.lastInsertRowid), 'create', `${o.hostname} eklendi`);
  res.json({ id: Number(r.lastInsertRowid) });
});

const FIELD_LABELS = {
  mig_status: 'Taşıma durumu', mig_wave: 'Dalga', mig_target_date: 'Hedef tarih', mig_owner: 'Sorumlu', mig_target: 'Hedef çözüm',
  mig_first_backup: 'İlk yedek', mig_restore_test: 'Test restore', environment: 'Ortam', criticality: 'Kritiklik', status: 'Durum',
};

function updateServer(id, o) {
  const old = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!old) return null;
  const changed = Object.keys(o).filter(k => (old[k] ?? null) !== (o[k] ?? null) && String(old[k] ?? '') !== String(o[k] ?? ''));
  if (!changed.length) return [];
  db.prepare(`UPDATE servers SET ${changed.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(...changed.map(k => o[k]), id);
  audit('server', id, 'update', changed.map(k => `${FIELD_LABELS[k] || k}: ${old[k] ?? '—'} → ${o[k] ?? '—'}`).join('; '));
  return changed;
}

app.put('/api/servers/:id', (req, res) => {
  const o = pickServer(req.body);
  if ('hostname' in o && !o.hostname) return res.status(400).json({ error: 'Hostname zorunludur' });
  const r = updateServer(Number(req.params.id), o);
  if (r === null) return res.status(404).json({ error: 'Sunucu bulunamadı' });
  res.json({ changed: r });
});

// Toplu güncelleme (taşıma ekranı): { ids: [], fields: { mig_status, mig_wave, ... } }
app.post('/api/servers/bulk', (req, res) => {
  const ids = (req.body.ids || []).map(Number);
  const o = pickServer(req.body.fields || {});
  delete o.hostname;
  let n = 0;
  tx(() => { for (const id of ids) if (updateServer(id, o)?.length) n++; });
  res.json({ updated: n });
});

app.delete('/api/servers/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT hostname FROM servers WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Sunucu bulunamadı' });
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  audit('server', id, 'delete', `${s.hostname} silindi`);
  res.json({ ok: true });
});

// ---------- Policy'ler ----------
app.get('/api/policies', (req, res) => {
  const data = loadAll(sysOf(req.query));
  res.json(data.policies.map(p => ({
    id: p.id, name: p.name, backup_system: p.backup_system, policy_type: p.policy_type, active: p.active, method: p.method,
    include_list: p.include_list, clients: p.clients.length, schedules: p.schedules.length,
    tape: p.schedules.some(s => s.tape === 'SLP'),
    categories: [...new Set(p.schedules.map(s => s.category))],
    summary: p.schedules.map(s => `${s.name}: ${s.description}`),
    updated_at: p.updated_at,
  })));
});

app.get('/api/policies/:id', (req, res) => {
  const id = Number(req.params.id);
  const data = loadAll();
  const p = data.policies.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Policy bulunamadı' });
  const host = new Map(data.servers.map(s => [s.id, s]));
  res.json({
    ...p,
    clients: p.clients.map(c => {
      const s = host.get(c.server_id);
      return { id: c.server_id, hostname: s?.hostname, client_name: c.client_name, environment: s?.environment, description: s?.description };
    }).sort((a, b) => a.hostname.localeCompare(b.hostname)),
    audit: db.prepare("SELECT * FROM audit_log WHERE entity = 'policy' AND entity_id = ? ORDER BY id DESC LIMIT 50").all(id),
  });
});

function savePolicy(id, b) {
  if (!b.name || !String(b.name).trim()) throw Object.assign(new Error('Policy adı zorunludur'), { status: 400 });
  const vals = [String(b.name).trim(), b.backup_system || 'NetBackup (Mevcut)', b.policy_type || null, b.active ? 1 : 0,
    b.method || null, b.include_list || null, b.description || null];
  return tx(() => {
    if (id) {
      const r = db.prepare(`UPDATE policies SET name=?, backup_system=?, policy_type=?, active=?, method=?, include_list=?, description=?,
        updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals, id);
      if (!r.changes) throw Object.assign(new Error('Policy bulunamadı'), { status: 404 });
    } else {
      id = Number(db.prepare(`INSERT INTO policies(name, backup_system, policy_type, active, method, include_list, description)
        VALUES (?,?,?,?,?,?,?)`).run(...vals).lastInsertRowid);
    }
    if (Array.isArray(b.client_ids)) {
      const existing = new Map(db.prepare('SELECT server_id, client_name FROM policy_clients WHERE policy_id = ?').all(id).map(r => [r.server_id, r.client_name]));
      db.prepare('DELETE FROM policy_clients WHERE policy_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO policy_clients(policy_id, server_id, client_name) VALUES (?,?,?)');
      const hn = db.prepare('SELECT hostname FROM servers WHERE id = ?');
      for (const sid of b.client_ids) {
        const h = hn.get(Number(sid));
        if (h) ins.run(id, Number(sid), existing.get(Number(sid)) || h.hostname);
      }
    }
    if (Array.isArray(b.schedules)) {
      db.prepare('DELETE FROM schedules WHERE policy_id = ?').run(id);
      const ins = db.prepare(`INSERT INTO schedules(policy_id, name, backup_type, tape, freq_every, freq_unit, calendar_json, dates_json,
        excluded_json, windows_json, retention_level, source_text, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      b.schedules.forEach((s, i) => {
        if (!s.name) throw Object.assign(new Error(`${i + 1}. schedule için ad zorunludur`), { status: 400 });
        const tape = s.tape === undefined ? detectTape(s.name) : (s.tape || null);
        ins.run(id, s.name, s.backup_type || 'Full Backup', tape, s.freq_every ? Number(s.freq_every) : null, s.freq_every ? s.freq_unit || 'day' : null,
          JSON.stringify(s.calendar || {}), JSON.stringify(s.dates || []), JSON.stringify(s.excluded || []),
          JSON.stringify(s.windows || []), s.retention_level === '' || s.retention_level === null || s.retention_level === undefined ? null : Number(s.retention_level),
          s.source_text || null, i + 1);
      });
    }
    return id;
  });
}

app.post('/api/policies', wrap((req, res) => {
  const id = savePolicy(null, req.body);
  audit('policy', id, 'create', `${req.body.name} oluşturuldu (${(req.body.client_ids || []).length} sunucu, ${(req.body.schedules || []).length} schedule)`);
  res.json({ id });
}));

app.put('/api/policies/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT COUNT(*) c FROM policy_clients WHERE policy_id = ?').get(id).c;
  savePolicy(id, req.body);
  const after = db.prepare('SELECT COUNT(*) c FROM policy_clients WHERE policy_id = ?').get(id).c;
  audit('policy', id, 'update', `${req.body.name} güncellendi` + (before !== after ? ` (sunucu: ${before} → ${after})` : ''));
  res.json({ id });
}));

app.post('/api/policies/:id/clone', wrap((req, res) => {
  const data = loadAll();
  const p = data.policies.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Policy bulunamadı' });
  const id = savePolicy(null, {
    ...p, name: req.body.name || `${p.name} (kopya)`, backup_system: req.body.backup_system || p.backup_system,
    client_ids: req.body.with_clients === false ? [] : p.clients.map(c => c.server_id),
    schedules: p.schedules,
  });
  audit('policy', id, 'create', `${p.name} kopyalanarak oluşturuldu`);
  res.json({ id });
}));

app.delete('/api/policies/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT name FROM policies WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Policy bulunamadı' });
  db.prepare('DELETE FROM policies WHERE id = ?').run(id);
  audit('policy', id, 'delete', `${p.name} silindi`);
  res.json({ ok: true });
});

// ---------- İstatistik / takvim / bulgular ----------
app.get('/api/stats', (req, res) => res.json(stats(sysOf(req.query))));
app.get('/api/heatmap', (req, res) => res.json(windowHeatmap({ week: Number(req.query.week || 0), kind: req.query.kind || 'all', system: req.query.system })));
app.get('/api/calendar/day', (req, res) => res.json(runsForDate(req.query.date, sysOf(req.query))));
app.get('/api/calendar/month', (req, res) => res.json(monthCalendar(Number(req.query.year), Number(req.query.month), sysOf(req.query))));
app.get('/api/findings', (req, res) => res.json(findings(sysOf(req.query))));

// ---------- İstisnalar ----------
app.get('/api/exceptions', (req, res) => {
  res.json(db.prepare(`SELECT e.*, s.hostname FROM exceptions e LEFT JOIN servers s ON s.id = e.server_id
    ORDER BY e.resolved, s.hostname IS NOT NULL, s.hostname, e.id`).all());
});
app.post('/api/exceptions', (req, res) => {
  if (!req.body.text) return res.status(400).json({ error: 'Not metni zorunludur' });
  const r = db.prepare('INSERT INTO exceptions(server_id, text) VALUES (?, ?)').run(req.body.server_id || null, req.body.text);
  if (req.body.server_id) audit('server', Number(req.body.server_id), 'note', `Not eklendi: ${req.body.text}`);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/exceptions/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM exceptions WHERE id = ?').get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  db.prepare('UPDATE exceptions SET text = ?, resolved = ?, server_id = ? WHERE id = ?')
    .run(req.body.text ?? e.text, req.body.resolved === undefined ? e.resolved : (req.body.resolved ? 1 : 0),
      req.body.server_id === undefined ? e.server_id : (req.body.server_id || null), e.id);
  res.json({ ok: true });
});
app.delete('/api/exceptions/:id', (req, res) => {
  db.prepare('DELETE FROM exceptions WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Ayarlar ----------
app.get('/api/settings/general-policy', (req, res) => res.json({ text: getSetting('general_policy', '') }));
app.put('/api/settings/general-policy', (req, res) => {
  setSetting('general_policy', String(req.body.text || ''));
  audit('system', null, 'update', 'Genel politika metni güncellendi');
  res.json({ ok: true });
});
app.put('/api/settings', (req, res) => {
  if ('company_name' in req.body) setSetting('company_name', String(req.body.company_name || ''));
  res.json({ ok: true });
});
app.put('/api/retention-levels', wrap((req, res) => {
  const list = req.body.levels || [];
  tx(() => {
    db.exec('DELETE FROM retention_levels');
    const ins = db.prepare('INSERT INTO retention_levels(level, label, days) VALUES (?,?,?)');
    for (const l of list) if (l.label) ins.run(Number(l.level), l.label, Number(l.days) || 0);
  });
  audit('system', null, 'update', 'Retention level tablosu güncellendi');
  res.json({ ok: true });
}));
app.get('/api/audit', (req, res) => {
  res.json(db.prepare(`SELECT a.*, CASE a.entity WHEN 'server' THEN s.hostname WHEN 'policy' THEN p.name END AS target
    FROM audit_log a LEFT JOIN servers s ON a.entity = 'server' AND s.id = a.entity_id
    LEFT JOIN policies p ON a.entity = 'policy' AND p.id = a.entity_id ORDER BY a.id DESC LIMIT ?`).all(Number(req.query.limit || 300)));
});

// ---------- İçe aktarma / yedek ----------
const raw = express.raw({ type: () => true, limit: '50mb' });
app.post('/api/import/workbook', raw, wrap(async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'Dosya boş' });
  res.json(await importPolicyWorkbook(req.body, { replace: true }));
}));
app.post('/api/import/inventory', raw, wrap(async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'Dosya boş' });
  res.json(await importInventory(req.body));
}));
app.get('/api/backup/download', (req, res) => {
  const file = snapshot('indirme');
  res.download(file, `vbackup-${new Date().toISOString().slice(0, 10)}.db`);
});

// ---------- Raporlar ----------
app.get('/api/reports/:id', wrap(async (req, res) => {
  const f = filtersOf(req.query);
  const ids = req.params.id === 'all' ? REPORTS.map(r => r.id) : req.params.id.split(',');
  const format = req.query.format || 'json';
  const stamp = new Date().toISOString().slice(0, 10);
  const base = ids.length > 1 ? 'yedekleme-politikasi-tum-raporlar' : `yedekleme-${ids[0]}`;
  if (format === 'xlsx') {
    const buf = await toXlsx(ids, f);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-${stamp}.xlsx"`);
    return res.send(buf);
  }
  if (format === 'pdf') {
    const buf = await toPdf(ids, f);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-${stamp}.pdf"`);
    return res.send(buf);
  }
  const rep = reportData(ids[0], f);
  res.json({ ...rep, rows: rep.rows.slice(0, Number(req.query.limit || 500)), total: rep.rows.length });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public/index.html')));

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Sunucu hatası' });
});

try { dailyBackup(); } catch (e) { console.warn('Günlük yedek alınamadı:', e.message); }
setInterval(() => { try { dailyBackup(); } catch { /* sonraki denemede */ } }, 6 * 3600 * 1000).unref();

app.listen(PORT, HOST, () => {
  console.log(`vbackup çalışıyor → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Veri klasörü: ${DATA_DIR}`);
  if (!fs.existsSync(DB_PATH) || !db.prepare('SELECT COUNT(*) c FROM servers').get().c) {
    console.log('Veritabanı boş: tarayıcıdan Excel dosyasını yükleyin ya da "npm run seed" çalıştırın.');
  }
});

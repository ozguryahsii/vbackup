// Excel (NetBackup policy özeti + CMDB envanter export'u) içe aktarımı
import ExcelJS from 'exceljs';
import { db, tx, audit, setSetting, snapshot } from './db.js';
import { cleanText } from './textClean.js';
import {
  parseFrequency, parseIncluded, parseExcluded, parseWindows, detectTape,
} from '../public/js/lib/schedule.js';

function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return v.result === null ? null : String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

function sheetRows(ws) {
  if (!ws) return [];
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = cellText(c.value)?.trim(); });
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const o = {};
    let any = false;
    header.forEach((h, i) => {
      if (!h) return;
      const v = cellText(row.getCell(i).value);
      o[h] = v;
      if (v !== null) any = true;
    });
    if (any) rows.push(o);
  });
  return rows;
}

function findSheet(wb, names, mustHaveHeader) {
  for (const n of names) {
    const ws = wb.getWorksheet(n);
    if (ws) return ws;
  }
  if (mustHaveHeader) {
    for (const ws of wb.worksheets) {
      const h = [];
      ws.getRow(1).eachCell(c => h.push(cellText(c.value)));
      if (mustHaveHeader.every(x => h.includes(x))) return ws;
    }
  }
  return null;
}

const shortHost = h => String(h || '').trim().split('.')[0].toUpperCase();
const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const retentionLevel = v => {
  const m = /^\s*(\d+)/.exec(v || '');
  return m ? Number(m[1]) : null;
};

// Envanter satırı (CMDB export formatı) -> servers kolonları
function inventoryRecord(r) {
  return {
    hostname: shortHost(r['Hostname']),
    domain: r['Domain Name'],
    ip: r['IP Adresi'],
    environment: r['Ortam'],
    platform: r['Platform'],
    vcpu: num(r['vCPU']),
    ram_gb: num(r['RAM (GB)']),
    disk_gb: num(r['Disk (GB)']),
    status: r['Sunucu Durumu'],
    description: r['Açıklama'],
    criticality: r['Kritiklik Seviyesi'],
    os: r['OS Ref'],
    location: r['Lokasyon'],
    owner_team: r['Owner Team'],
    inventory_key: r['Key'],
  };
}

const INV_COLS = ['domain', 'ip', 'environment', 'platform', 'vcpu', 'ram_gb', 'disk_gb', 'status',
  'description', 'criticality', 'os', 'location', 'owner_team', 'inventory_key'];

export function upsertInventory(records) {
  let inserted = 0, updated = 0;
  const get = db.prepare('SELECT id FROM servers WHERE hostname = ?');
  const ins = db.prepare(`INSERT INTO servers(hostname, ${INV_COLS.join(',')}, source)
    VALUES (?, ${INV_COLS.map(() => '?').join(',')}, 'envanter')`);
  const upd = db.prepare(`UPDATE servers SET ${INV_COLS.map(c => `${c} = COALESCE(?, ${c})`).join(', ')},
    source = 'envanter', updated_at = datetime('now','localtime') WHERE id = ?`);
  for (const rec of records) {
    if (!rec.hostname) continue;
    const ex = get.get(rec.hostname);
    const vals = INV_COLS.map(c => rec[c] ?? null);
    if (ex) { upd.run(...vals, ex.id); updated++; } else { ins.run(rec.hostname, ...vals); inserted++; }
  }
  return { inserted, updated };
}

async function loadWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// Sadece envanter güncelle (CMDB export'u: 'export' sayfası ya da Hostname kolonlu ilk sayfa)
export async function importInventory(buffer) {
  const wb = await loadWorkbook(buffer);
  const ws = findSheet(wb, ['export', 'Envanter'], ['Hostname']) ||
    wb.worksheets.find(w => sheetRows(w).some(r => r['Hostname']));
  if (!ws) throw new Error('Envanter sayfası bulunamadı ("Hostname" kolonu olan bir sayfa gerekli).');
  const records = sheetRows(ws).map(inventoryRecord).filter(r => r.hostname);
  const res = tx(() => upsertInventory(records));
  audit('inventory', null, 'import', `Envanter içe aktarıldı: ${res.inserted} yeni, ${res.updated} güncellendi`);
  return res;
}

// Tam içe aktarım: politika özeti çalışma kitabı (Detay + Policy Listesi + export + İstisnalar + Genel Politika)
export async function importPolicyWorkbook(buffer, { replace = true } = {}) {
  const wb = await loadWorkbook(buffer);
  const detayWs = findSheet(wb, ['Detay (Sunucu-Policy-Schedule)'], ['Policy Name', 'Schedule', 'Kaynak satır (AGO.xlsx)']);
  const policyWs = findSheet(wb, ['Policy Listesi'], ['Policy Name', 'İstemciler']);
  if (!detayWs || !policyWs) {
    throw new Error('"Detay (Sunucu-Policy-Schedule)" ve "Policy Listesi" sayfaları bulunamadı. Doğru Excel dosyasını seçtiğinizden emin olun.');
  }
  const detay = sheetRows(detayWs);
  const policyRows = sheetRows(policyWs);
  const invRows = sheetRows(findSheet(wb, ['export'], ['Hostname', 'IP Adresi']));
  const serverRows = sheetRows(findSheet(wb, ['Sunucu Bazlı Politika'], ['Sunucu (kısa ad)']));
  const excRows = sheetRows(findSheet(wb, ['İstisnalar ve Notlar'], ['İstisna / Not']));
  const genelWs = findSheet(wb, ['Genel Politika']);

  if (replace && db.prepare('SELECT COUNT(*) c FROM servers').get().c) snapshot('import-oncesi');

  const stats = tx(() => {
    if (replace) {
      db.exec('DELETE FROM schedules; DELETE FROM policy_clients; DELETE FROM policies; DELETE FROM exceptions; DELETE FROM servers;');
    }
    const inv = upsertInventory(invRows.map(inventoryRecord).filter(r => r.hostname));

    const getServer = db.prepare('SELECT id, description FROM servers WHERE hostname = ?');
    const insServer = db.prepare("INSERT INTO servers(hostname, description, source) VALUES (?, ?, 'policy')");
    const roleByHost = new Map(serverRows.map(r => [shortHost(r['Sunucu (kısa ad)']), r['Sunucu Görevi']]));
    const serverId = host => {
      const h = shortHost(host);
      if (!h) return null;
      const ex = getServer.get(h);
      if (ex) return ex.id;
      return Number(insServer.run(h, roleByHost.get(h) || null).lastInsertRowid);
    };

    // Policy'ler
    const insPolicy = db.prepare(`INSERT INTO policies(name, backup_system, policy_type, active, method, include_list, source_row)
      VALUES (?, 'NetBackup (Mevcut)', ?, ?, ?, ?, ?)`);
    const policyByRow = new Map();
    for (const p of policyRows) {
      const row = num(p['Kaynak satır']);
      const id = Number(insPolicy.run(p['Policy Name'], p['Policy Type'], p['Active'] === 'yes' ? 1 : 0,
        p['Yöntem'], p['Include'], row).lastInsertRowid);
      policyByRow.set(row, id);
    }

    // Schedule'lar ve istemciler (Detay satırları sunucu x schedule şeklinde)
    const insSched = db.prepare(`INSERT INTO schedules(policy_id, name, backup_type, tape, freq_every, freq_unit,
      calendar_json, dates_json, excluded_json, windows_json, retention_level, source_text, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insClient = db.prepare('INSERT OR IGNORE INTO policy_clients(policy_id, server_id, client_name) VALUES (?,?,?)');
    const seenSched = new Set();
    const sortByPolicy = new Map();
    let schedCount = 0;
    for (const r of detay) {
      const row = num(r['Kaynak satır (AGO.xlsx)']);
      let pid = policyByRow.get(row);
      if (!pid) {
        pid = Number(insPolicy.run(r['Policy Name'], r['Policy Type'], r['Active'] === 'yes' ? 1 : 0,
          r['Yöntem'], r['Include (döküm)'], row).lastInsertRowid);
        policyByRow.set(row, pid);
      }
      const sid = serverId(r['Sunucu']);
      if (sid) insClient.run(pid, sid, r['İstemci adı (döküm)'] || r['Sunucu']);
      const key = `${pid}|${r['Schedule']}`;
      if (!r['Schedule'] || seenSched.has(key)) continue;
      seenSched.add(key);
      const { freq_every, freq_unit } = parseFrequency(r['Frequency']);
      const { calendar, dates } = parseIncluded(r['Included Dates']);
      const sort = (sortByPolicy.get(pid) || 0) + 1;
      sortByPolicy.set(pid, sort);
      let tape = detectTape(r['Schedule']);
      if (!tape && r['Kaset (SLP) mi?'] === 'EVET') tape = 'SLP';
      insSched.run(pid, r['Schedule'], r['Type'] || 'Full Backup', tape, freq_every, freq_unit,
        JSON.stringify(calendar), JSON.stringify(dates), JSON.stringify(parseExcluded(r['Excluded Dates'])),
        JSON.stringify(parseWindows(r['Daily Windows'])), retentionLevel(r['Retention Level']),
        r['Türkçe açıklama'], sort);
      schedCount++;
    }

    // Sunucu görevleri (envanterde olmayan sunucular için)
    const setDesc = db.prepare('UPDATE servers SET description = ? WHERE id = ? AND description IS NULL');
    for (const [h, role] of roleByHost) {
      if (!role) continue;
      const s = getServer.get(h);
      if (s) setDesc.run(role, s.id);
    }

    // İstisnalar / notlar
    const insExc = db.prepare('INSERT INTO exceptions(server_id, text) VALUES (?, ?)');
    let excCount = 0;
    for (const e of excRows) {
      const text = e['İstisna / Not'];
      if (!text) continue;
      const host = e['Sunucu'];
      insExc.run(!host || host === 'GENEL' ? null : serverId(host), cleanText(text));
      excCount++;
    }

    if (genelWs) {
      const lines = [];
      genelWs.eachRow(row => { const t = cellText(row.getCell(1).value); if (t) lines.push(t); });
      setSetting('general_policy', cleanText(lines.join('\n')));
    }
    setSetting('imported_at', new Date().toISOString());

    return {
      inventory: inv,
      policies: policyByRow.size,
      schedules: schedCount,
      servers: db.prepare('SELECT COUNT(*) c FROM servers').get().c,
      exceptions: excCount,
    };
  });
  audit('system', null, 'import', `Excel içe aktarıldı: ${stats.policies} policy, ${stats.schedules} schedule, ${stats.servers} sunucu`);
  return stats;
}

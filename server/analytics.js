// Ham tablolardan türetilen görünümler: sunucu bazlı politika, istatistikler, riskler, takvim
import { db } from './db.js';
import {
  category, describeSchedule, describeWhen, describeWindows, retentionText, serverRpoHours, rpoBucket,
  RPO_BUCKETS, runsOn, windowsOn, windowRanges, hhmm, isoDate, DAYS_SHORT, weekOfMonth,
} from '../public/js/lib/schedule.js';

export function parseSchedule(r) {
  return {
    ...r,
    calendar: JSON.parse(r.calendar_json || '{}'),
    dates: JSON.parse(r.dates_json || '[]'),
    excluded: JSON.parse(r.excluded_json || '[]'),
    windows: JSON.parse(r.windows_json || '[]'),
  };
}

export function levels() {
  return db.prepare('SELECT * FROM retention_levels ORDER BY level').all();
}

// filters: { system } — yedekleme sistemi (ör. "NetBackup (Mevcut)")
export function loadAll(filters = {}) {
  const lv = levels();
  const servers = db.prepare('SELECT * FROM servers ORDER BY hostname').all();
  let policies = db.prepare('SELECT * FROM policies ORDER BY name').all();
  if (filters.system) policies = policies.filter(p => p.backup_system === filters.system);
  const pmap = new Map(policies.map(p => [p.id, { ...p, schedules: [], clients: [] }]));
  for (const r of db.prepare('SELECT * FROM schedules ORDER BY policy_id, sort, id').all()) {
    const p = pmap.get(r.policy_id);
    if (!p) continue;
    const s = parseSchedule(r);
    s.category = category(s);
    s.description = describeSchedule(s, lv);
    p.schedules.push(s);
  }
  const byServer = new Map();
  for (const c of db.prepare('SELECT * FROM policy_clients').all()) {
    const p = pmap.get(c.policy_id);
    if (!p) continue;
    p.clients.push(c);
    if (!byServer.has(c.server_id)) byServer.set(c.server_id, []);
    byServer.get(c.server_id).push(p);
  }
  const excs = db.prepare('SELECT * FROM exceptions ORDER BY id').all();
  return { servers, policies: [...pmap.values()], byServer, levels: lv, exceptions: excs };
}

const levelDays = (lv, level) => lv.find(l => l.level === level)?.days ?? null;

export function summarizeServer(server, policies, lv) {
  const active = policies.filter(p => p.active);
  const passive = policies.filter(p => !p.active);
  const tag = p => `[${p.method || p.policy_type || ''} | ${p.name}]`;
  const lines = { full: [], incr: [], tape: [], other: [] };
  const activeSchedules = [];
  for (const p of active) {
    for (const s of p.schedules) {
      activeSchedules.push(s);
      const bucket = s.category === 'full' ? 'full' : s.category === 'tape' ? 'tape'
        : (s.category === 'incr' || s.category === 'log') ? 'incr' : 'other';
      lines[bucket].push(`${tag(p)} ${s.name} → ${s.description}`);
    }
  }
  const passiveTape = passive.some(p => p.schedules.some(s => s.tape === 'SLP'));
  const activeTape = activeSchedules.some(s => s.tape === 'SLP');
  const tapeStatus = activeTape ? 'EVET' : passiveTape ? "Sadece pasif policy'de" : 'HAYIR';
  const disk = activeSchedules.filter(s => !s.tape && s.category !== 'app');
  const retDays = disk.map(s => levelDays(lv, s.retention_level)).filter(x => x !== null);
  const fullRet = disk.filter(s => s.category === 'full').map(s => levelDays(lv, s.retention_level)).filter(x => x !== null);
  const rpo = serverRpoHours(activeSchedules);
  const methods = [...new Set(active.map(p => p.method || p.policy_type).filter(Boolean))];
  const types = [...new Set(active.map(p => p.policy_type).filter(Boolean))];
  const tapeSchedules = activeSchedules.filter(s => s.tape === 'SLP');
  return {
    id: server.id,
    hostname: server.hostname,
    description: server.description,
    environment: server.environment,
    criticality: server.criticality,
    status: server.status,
    platform: server.platform,
    os: server.os,
    in_inventory: server.source === 'envanter',
    active_count: active.length,
    passive_count: passive.length,
    covered: active.length > 0,
    methods,
    types,
    policy_names: active.map(p => p.name),
    passive_names: passive.map(p => p.name),
    full_lines: lines.full,
    incr_lines: lines.incr,
    tape_lines: lines.tape,
    other_lines: lines.other,
    tape_retention: tapeSchedules.map(s => `${s.name}: ${retentionText(s.retention_level, lv)}`),
    passive_lines: passive.map(p => `${tag(p)} ` + p.schedules.map(s => `${s.name} → ${s.description}`).join('; ')),
    tape_status: tapeStatus,
    rpo_hours: rpo,
    rpo_bucket: rpoBucket(rpo),
    max_retention_days: retDays.length ? Math.max(...retDays) : null,
    full_retention_days: fullRet.length ? Math.max(...fullRet) : null,
    mig_status: server.mig_status || 'Planlanmadı',
    mig_wave: server.mig_wave,
    mig_target_date: server.mig_target_date,
  };
}

export function serverSummaries(filters = {}) {
  const data = loadAll(filters);
  const notes = new Map();
  for (const e of data.exceptions) {
    if (!e.server_id || e.resolved) continue;
    if (!notes.has(e.server_id)) notes.set(e.server_id, []);
    notes.get(e.server_id).push(e.text);
  }
  const list = data.servers.map(s => {
    const sum = summarizeServer(s, data.byServer.get(s.id) || [], data.levels);
    sum.notes = notes.get(s.id) || [];
    return sum;
  });
  return { data, list };
}

const isActiveServer = s => !s.status || s.status === 'Aktif';
const isHighCrit = s => /^3/.test(s.criticality || '');
const isDR = s => /^DR$/i.test(s.environment || '');
const isProd = s => /PROD/i.test(s.environment || '') && !/PREPROD/i.test(s.environment || '');

// Kapsam durumu — gösterge paneli, istatistik, envanter filtresi ve raporlarda TEK tanım:
//   covered   : en az bir aktif policy'de
//   uncovered : yedeksiz, envanterde aktif, DR dışı  → "Yedeksiz" olarak sayılan
//   dr        : yedeksiz, DR ortamında (çoğunlukla replikasyonla korunur; ayrı gösterilir)
//   inactive  : yedeksiz ve envanterde aktif değil (ör. İşletimden Çıkarıldı) → istatistiklere girmez
export function coverageState(s) {
  if (s.covered) return 'covered';
  if (!isActiveServer(s)) return 'inactive';
  return isDR(s) ? 'dr' : 'uncovered';
}
export const NO_BACKUP_DR = 'Yedek yok (DR)';

// { label: { value, ids } } biriktirici: her sayı, onu oluşturan sunucu id'leriyle birlikte döner
function groupIds(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    for (const k of [].concat(keyFn(x) ?? '—')) {
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(x.id);
    }
  }
  return [...m].map(([label, set]) => ({ label, value: set.size, ids: [...set] })).sort((a, b) => b.value - a.value);
}

export function stats(filters = {}) {
  const { data, list } = serverSummaries(filters);
  for (const s of list) {
    s.coverage = coverageState(s);
    if (s.coverage === 'dr') s.rpo_bucket = NO_BACKUP_DR;
  }
  // Kapsam istatistikleri envanterde aktif görünen ya da yedeği olan sunucular üzerinden yapılır
  const considered = list.filter(s => s.coverage !== 'inactive');
  const covered = considered.filter(s => s.covered);
  const activePolicies = data.policies.filter(p => p.active);
  const allSchedules = activePolicies.flatMap(p => p.schedules.map(s => ({ ...s, policy: p })));
  const ids = arr => arr.map(s => s.id);

  const byType = {};
  for (const p of data.policies) {
    const t = p.policy_type || '—';
    byType[t] ||= { label: t, active: 0, passive: 0 };
    byType[t][p.active ? 'active' : 'passive']++;
  }

  const coverageBy = key => {
    const m = new Map();
    for (const s of considered) {
      const k = s[key] || 'Belirtilmemiş';
      if (!m.has(k)) m.set(k, { label: k, covered: [], uncovered: [], dr: [], tape: [] });
      const o = m.get(k);
      o[s.coverage].push(s.id);
      if (s.tape_status === 'EVET') o.tape.push(s.id);
    }
    return [...m.values()]
      .map(o => ({ label: o.label, covered: o.covered.length, uncovered: o.uncovered.length, dr: o.dr.length, tape: o.tape.length, ids: o }))
      .sort((a, b) => (b.covered + b.uncovered + b.dr) - (a.covered + a.uncovered + a.dr));
  };

  // Saklama süresi × yedek türü: o saklamayla yedeklenen (tekil) sunucu sayısı
  const retentionDist = {};
  for (const s of allSchedules) {
    if (s.category === 'app') continue;
    const lab = retentionText(s.retention_level, data.levels);
    retentionDist[lab] ||= { label: lab, level: s.retention_level, sets: { full: new Set(), incr: new Set(), log: new Set(), tape: new Set() } };
    for (const c of s.policy.clients) retentionDist[lab].sets[s.category].add(c.server_id);
  }
  const retentionOut = Object.values(retentionDist)
    .sort((a, b) => (levelDays(data.levels, a.level) ?? 0) - (levelDays(data.levels, b.level) ?? 0))
    .map(r => {
      const o = { label: r.label, level: r.level, ids: {} };
      for (const [k, set] of Object.entries(r.sets)) { o[k] = set.size; o.ids[k] = [...set]; }
      return o;
    });

  // RPO x kritiklik matrisi
  const rpoBuckets = [...RPO_BUCKETS, NO_BACKUP_DR];
  const critLevels = ['3-Yüksek', '2-Orta', '1-Düşük', 'Belirtilmemiş'];
  const rpoMatrix = critLevels.map(c => {
    const cells = rpoBuckets.map(b => ids(considered.filter(s => (s.criticality || 'Belirtilmemiş') === c && s.rpo_bucket === b)));
    return { criticality: c, values: cells.map(x => x.length), ids: cells };
  });

  // Full yedek günleri: o gün Full yedeği alınan (tekil) sunucu sayısı
  const fullDaySets = Array.from({ length: 7 }, () => new Set());
  for (const s of allSchedules) {
    if (s.category !== 'full') continue;
    const days = new Set();
    for (let d = 0; d < 7; d++) if ((s.calendar[d] || []).length) days.add(d);
    if (!days.size && s.freq_every) for (const w of s.windows) days.add(w.d);
    for (const d of days) for (const c of s.policy.clients) fullDaySets[d].add(c.server_id);
  }

  // Kaset: ayın haftası x gün matrisi — o gün kasete çıkan (tekil) sunucu
  const tapeSets = [1, 2, 3, 4, 5].map(() => Array.from({ length: 7 }, () => new Set()));
  for (const s of allSchedules) {
    if (s.tape !== 'SLP') continue;
    for (let d = 0; d < 7; d++) for (const w of s.calendar[d] || []) for (const c of s.policy.clients) tapeSets[w - 1][d].add(c.server_id);
  }

  const topPolicies = activePolicies.map(p => ({ id: p.id, label: p.name, value: p.clients.length, ids: p.clients.map(c => c.server_id) }))
    .sort((a, b) => b.value - a.value).slice(0, 15);

  const migration = groupIds(list.filter(s => s.covered || s.mig_wave || (s.mig_status && s.mig_status !== 'Planlanmadı')), s => s.mig_status || 'Planlanmadı');
  const methodDist = groupIds(covered, s => [...new Set(s.methods.map(m => m.replace(/ – instance .*/, '')))]);

  return {
    kpi: {
      servers_total: list.length,
      servers_considered: considered.length,
      covered: covered.length,
      uncovered: considered.length - covered.length,
      uncovered_non_dr: considered.filter(s => s.coverage === 'uncovered').length,
      uncovered_dr: considered.filter(s => s.coverage === 'dr').length,
      tape_yes: covered.filter(s => s.tape_status === 'EVET').length,
      passive_only: list.filter(s => !s.covered && s.passive_count > 0).length,
      policies_active: activePolicies.length,
      policies_passive: data.policies.length - activePolicies.length,
      schedules: allSchedules.length,
      high_crit_uncovered: considered.filter(s => s.coverage === 'uncovered' && isHighCrit(s)).length,
      open_notes: data.exceptions.filter(e => !e.resolved).length,
      not_in_inventory: list.filter(s => !s.in_inventory).length,
    },
    kpiIds: {
      covered: ids(covered),
      uncovered: ids(considered.filter(s => s.coverage === 'uncovered')),
      uncovered_dr: ids(considered.filter(s => s.coverage === 'dr')),
      high_crit_uncovered: ids(considered.filter(s => s.coverage === 'uncovered' && isHighCrit(s))),
      tape_yes: ids(covered.filter(s => s.tape_status === 'EVET')),
    },
    policyTypes: Object.values(byType).sort((a, b) => (b.active + b.passive) - (a.active + a.passive)),
    coverageByEnv: coverageBy('environment'),
    coverageByCrit: coverageBy('criticality'),
    coverageByPlatform: coverageBy('platform'),
    // yedeği olan sunucular (EVET + HAYIR = yedeklenen) ve yalnızca pasif policy'sinde SLP olanlar
    tapeStatus: groupIds(considered.filter(s => s.covered || s.tape_status !== 'HAYIR'), s => s.tape_status),
    rpoDist: rpoBuckets.map(b => { const x = ids(considered.filter(s => s.rpo_bucket === b)); return { label: b, value: x.length, ids: x }; }),
    rpoBuckets,
    rpoMatrix,
    retentionDist: retentionOut,
    fullDays: fullDaySets.map((set, i) => ({ label: DAYS_SHORT[i], value: set.size, ids: [...set] })),
    tapeMatrix: tapeSets.map(r => r.map(set => set.size)),
    tapeMatrixIds: tapeSets.map(r => r.map(set => [...set])),
    topPolicies,
    migration,
    methodDist,
    systems: db.prepare('SELECT backup_system label, COUNT(*) value FROM policies GROUP BY backup_system').all(),
  };
}

// Haftalık yedek penceresi yoğunluğu: gün x saat, açık penceresi olan sunucu sayısı
// week: 0 = ortalama (5 haftanın ortalaması), 1..5 = ayın o haftası
export function windowHeatmap({ week = 0, kind = 'all', system } = {}) {
  const data = loadAll({ system });
  const weeks = week ? [Number(week)] : [1, 2, 3, 4, 5];
  // hücre başına (gün x saat) her hafta için penceresi açık TEKİL sunucular
  const cells = weeks.map(() => Array.from({ length: 7 * 24 }, () => new Set()));
  for (const p of data.policies) {
    if (!p.active || !p.clients.length) continue;
    for (const s of p.schedules) {
      if (s.category === 'app') continue;
      if (kind !== 'all' && s.category !== kind) continue;
      weeks.forEach((wk, wi) => {
        for (const w of s.windows) {
          // pencere hangi gün açılıyorsa o gün o hafta çalışıyor mu?
          const fake = dateForWeekDay(wk, w.d);
          if (!runsOn(s, fake) && !(s.freq_unit && s.freq_unit !== 'day')) continue;
          const [a, b] = windowRanges(w);
          for (let m = Math.floor(a / 60) * 60; m < b; m += 60) {
            const h = Math.floor(m / 60) % (7 * 24);
            for (const c of p.clients) cells[wi][h].add(c.server_id);
          }
        }
      });
    }
  }
  const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) =>
    Math.round(cells.reduce((a, wk) => a + wk[d * 24 + h].size, 0) / weeks.length * 10) / 10));
  // Tıklanınca gösterilecek liste: seçili haftada (ortalamada: herhangi bir haftada) penceresi açık sunucular
  const ids = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => {
    const u = new Set();
    for (const wk of cells) for (const id of wk[d * 24 + h]) u.add(id);
    return [...u];
  }));
  return { grid, ids };
}

// Belirli bir haftagünü + ayın haftası için örnek tarih (2026 Mart: 1 Mart Pazar)
function dateForWeekDay(week, day) {
  return new Date(2026, 2, 1 + (week - 1) * 7 + day);
}

// Seçilen tarihte çalışacak yedekler
export function runsForDate(dateStr, { system } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const data = loadAll({ system });
  const servers = new Map(data.servers.map(s => [s.id, s]));
  const out = [];
  for (const p of data.policies) {
    if (!p.active) continue;
    for (const s of p.schedules) {
      if (!runsOn(s, date)) continue;
      const wins = windowsOn(s, date).filter(w => w.d === date.getDay());
      const winTxt = wins.length ? describeWindows(wins) : (s.windows.length ? describeWindows(s.windows) : '—');
      out.push({
        policy_id: p.id, policy: p.name, policy_type: p.policy_type, schedule: s.name,
        category: s.category, backup_type: s.backup_type, tape: s.tape,
        when: describeWhen(s), window: winTxt,
        start: wins.length ? hhmm(wins[0].s) : null,
        retention: retentionText(s.retention_level, data.levels),
        servers: p.clients.map(c => servers.get(c.server_id)?.hostname).filter(Boolean).sort(),
      });
    }
  }
  out.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  return { date: dateStr, week: weekOfMonth(date), weekday: date.getDay(), runs: out };
}

// Ay takvimi: her gün için kategori bazında sunucu sayıları
export function monthCalendar(year, month, { system } = {}) {
  const data = loadAll({ system });
  const days = [];
  const last = new Date(year, month, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, month - 1, d);
    const c = { full: new Set(), incr: new Set(), log: new Set(), tape: new Set() };
    for (const p of data.policies) {
      if (!p.active) continue;
      for (const s of p.schedules) {
        if (s.category === 'app' || !runsOn(s, date)) continue;
        for (const cl of p.clients) c[s.category]?.add(cl.server_id);
      }
    }
    days.push({
      date: isoDate(date), day: d, weekday: date.getDay(), week: weekOfMonth(date),
      full: c.full.size, incr: c.incr.size, log: c.log.size, tape: c.tape.size,
    });
  }
  return days;
}

// ---------- Uyum & Risk kuralları ----------
export function findings(filters = {}) {
  const { data, list } = serverSummaries(filters);
  const inv = list.filter(s => s.in_inventory);
  const rules = [];
  const add = (id, severity, title, description, items) => rules.push({ id, severity, title, description, count: items.length, items });
  const row = (s, extra) => ({ id: s.id, hostname: s.hostname, description: s.description, environment: s.environment, criticality: s.criticality, detail: extra || '' });

  add('prod-uncovered', 'critical', 'Aktif PROD sunucuda yedek yok',
    'Envanterde Aktif durumda, PROD ortamında olan ve hiçbir aktif policy\'ye bağlı olmayan sunucular.',
    inv.filter(s => isActiveServer(s) && isProd(s) && !s.covered).map(s => row(s)));
  add('highcrit-uncovered', 'critical', 'Yüksek kritik sunucuda yedek yok',
    'Kritiklik seviyesi 3-Yüksek olup aktif policy\'si bulunmayan sunucular (ortam fark etmeksizin).',
    inv.filter(s => isActiveServer(s) && isHighCrit(s) && !s.covered && !isProd(s) && !isDR(s)).map(s => row(s)));
  add('dr-uncovered', 'info', 'DR ortamında yedeği olmayan sunucular',
    'DR sunucuları çoğunlukla replikasyonla korunur; bu liste bilinçli bir karar olup olmadığının teyidi içindir.',
    inv.filter(s => isActiveServer(s) && isDR(s) && !s.covered).map(s => row(s)));
  add('highcrit-notape', 'serious', 'Yüksek kritik sunucu kasete çıkmıyor',
    'Yedeği olan fakat aktif SLP (kaset) schedule\'ı bulunmayan 3-Yüksek kritik sunucular.',
    list.filter(s => s.covered && isHighCrit(s) && s.tape_status !== 'EVET').map(s => row(s, s.tape_status)));
  add('highcrit-weekly', 'serious', 'Yüksek kritik sunucuda RPO 1 günden uzun',
    'Disk yedek aralığı (tahmini RPO) 24 saatten uzun olan 3-Yüksek kritik sunucular.',
    list.filter(s => s.covered && isHighCrit(s) && (s.rpo_hours ?? 0) > 24).map(s => row(s, `RPO ≈ ${Math.round(s.rpo_hours / 24)} gün`)));
  add('decom-active', 'warning', 'İşletimden çıkarılmış sunucu hâlâ yedekleniyor',
    'Envanterde Aktif olmayan (ör. İşletimden Çıkarıldı) fakat aktif policy\'si devam eden sunucular — lisans/kapasite tasarrufu fırsatı.',
    list.filter(s => s.status && s.status !== 'Aktif' && s.covered).map(s => row(s, s.status)));
  add('not-in-inventory', 'warning', 'Policy\'de var, envanterde yok',
    'NetBackup policy\'lerinde istemci olarak geçen ama envanter (CMDB) kaydı bulunmayan sunucular.',
    list.filter(s => !s.in_inventory).map(s => row(s, s.covered ? 'aktif policy var' : 'yalnızca pasif policy')));
  add('passive-only', 'warning', 'Yalnızca pasif policy\'de tanımlı',
    'Aktif policy\'si olmayan, sadece Active=no policy\'lerde geçen sunucular.',
    list.filter(s => !s.covered && s.passive_count > 0).map(s => row(s, s.passive_names.join(', '))));
  add('short-retention-prod', 'warning', 'PROD sunucuda Full saklama 1 aydan kısa',
    'PROD ortamındaki sunucularda en uzun disk Full saklaması 31 günden kısa.',
    list.filter(s => s.covered && isProd(s) && s.full_retention_days !== null && s.full_retention_days < 31)
      .map(s => row(s, `${s.full_retention_days} gün`)));
  const empty = data.policies.filter(p => p.active && !p.clients.length);
  add('empty-policy', 'info', 'İstemcisi olmayan aktif policy',
    'Aktif durumda olup hiçbir sunucuya bağlı olmayan policy\'ler.',
    empty.map(p => ({ id: p.id, hostname: p.name, description: p.policy_type, policy: true, detail: '' })));
  add('mig-overdue', 'serious', 'Taşıma hedef tarihi geçmiş',
    'Taşıma hedef tarihi bugünden önce olup durumu Taşındı/Doğrulandı/Kapsam dışı olmayan sunucular.',
    list.filter(s => s.mig_target_date && s.mig_target_date < isoDate(new Date()) &&
      !['Taşındı', 'Doğrulandı', 'Kapsam dışı'].includes(s.mig_status)).map(s => row(s, `${s.mig_target_date} · ${s.mig_status}`)));
  return rules;
}

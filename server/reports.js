// Rapor tanımları + Excel / PDF üretimi
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import { createRequire } from 'node:module';
import { db, getSetting } from './db.js';
import { serverSummaries, loadAll, stats, findings, coverageState } from './analytics.js';
import { typeLabel, retentionText, rpoText, describeWhen, describeWindows } from '../public/js/lib/schedule.js';

const require = createRequire(import.meta.url);
const vfs = require('pdfmake/build/vfs_fonts.js');
const fontBuf = n => Buffer.from((vfs.pdfMake ? vfs.pdfMake.vfs : vfs)[n], 'base64');
const printer = new PdfPrinter({
  Roboto: {
    normal: fontBuf('Roboto-Regular.ttf'),
    bold: fontBuf('Roboto-Medium.ttf'),
    italics: fontBuf('Roboto-Italic.ttf'),
    bolditalics: fontBuf('Roboto-MediumItalic.ttf'),
  },
});

const yesNo = v => (v ? 'EVET' : 'HAYIR');
const lines = arr => (arr && arr.length ? arr.join('\n') : '—');
const match = (q, ...vals) => !q || vals.some(v => String(v ?? '').toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')));

function serverFilter(f) {
  return s =>
    (!f.environment || (s.environment || 'Belirtilmemiş') === f.environment) &&
    (!f.criticality || (s.criticality || 'Belirtilmemiş') === f.criticality) &&
    (!f.tape || s.tape_status === f.tape) &&
    (!f.covered || (f.covered === 'yes' ? s.covered : f.covered === 'any' ? !s.covered : coverageState(s) === (f.covered === 'no' ? 'uncovered' : f.covered))) &&
    (!f.policy_type || s.types.includes(f.policy_type)) &&
    (!f.mig_status || s.mig_status === f.mig_status) &&
    match(f.q, s.hostname, s.description, s.policy_names.join(' '));
}

function policyFilter(f) {
  return p =>
    (!f.policy_type || p.policy_type === f.policy_type) &&
    (!f.active || (f.active === 'yes' ? p.active : !p.active)) &&
    (!f.tape || (f.tape === 'EVET') === p.schedules.some(s => s.tape === 'SLP')) &&
    match(f.q, p.name, p.method, p.clients.map(c => c.client_name).join(' '));
}

export const REPORTS = [
  { id: 'sunucu', title: 'Sunucu Bazlı Politika', description: 'Her sunucu için hangi yöntemle, hangi sıklıkta, ne kadar saklamayla yedeklendiği.' },
  { id: 'kaset', title: 'Kasete Çıkan Sunucular', description: 'SLP (kaset) schedule\'ı olan sunucular ve kasete çıkış takvimi.' },
  { id: 'detay', title: 'Detay (Sunucu-Policy-Schedule)', description: 'Sunucu × policy × schedule kırılımında tam liste.' },
  { id: 'policy', title: 'Policy Listesi', description: 'Tüm policy\'ler, istemcileri, içerikleri ve schedule\'ları.' },
  { id: 'istisna', title: 'İstisnalar ve Notlar', description: 'Sunucu ve genel bazlı istisna/not kayıtları.' },
  { id: 'ozet', title: 'Özet Sayılar', description: 'Gösterge sayıları (kapsam, kaset, policy adetleri).' },
  { id: 'envanter', title: 'Envanter', description: 'Sunucu envanteri ve yedek kapsam durumu.' },
  { id: 'kapsam-disi', title: 'Envanter – Politikada Yok', description: 'Envanterde olup hiçbir aktif policy\'de yer almayan sunucular.' },
  { id: 'risk', title: 'Uyum & Risk Bulguları', description: 'Otomatik kurallarla tespit edilen riskler ve boşluklar.' },
  { id: 'tasima', title: 'Taşıma Durumu', description: 'Taşıma projesi: dalga, durum, hedef tarih, doğrulama bilgileri.' },
];

const SERVER_COLS = [
  { key: 'no', label: '#', width: 5 },
  { key: 'hostname', label: 'Sunucu', width: 18, pdf: true },
  { key: 'description', label: 'Sunucu Görevi', width: 26, pdf: true },
  { key: 'environment', label: 'Ortam', width: 10, pdf: true },
  { key: 'criticality', label: 'Kritiklik', width: 10, pdf: true },
  { key: 'active_count', label: 'Aktif policy', width: 8 },
  { key: 'passive_count', label: 'Pasif policy', width: 8 },
  { key: 'methods', label: 'Yedekleme yöntemi (aktif)', width: 28, pdf: true },
  { key: 'policies', label: 'Aktif policy adları', width: 34 },
  { key: 'full', label: 'DİSK – Full: sıklık | pencere | saklama', width: 60, pdf: true },
  { key: 'incr', label: 'DİSK – Incremental / Log', width: 60, pdf: true },
  { key: 'tape', label: 'Kasete çıkıyor mu?', width: 12, pdf: true },
  { key: 'tape_lines', label: 'Kaset (SLP) schedule', width: 50, pdf: true },
  { key: 'tape_ret', label: 'Kaset saklama (retention)', width: 18 },
  { key: 'other', label: 'Diğer schedule\'lar (App/Vault)', width: 40 },
  { key: 'rpo', label: 'Tahmini RPO', width: 10, pdf: true },
  { key: 'passive', label: 'Pasif policy\'ler', width: 40 },
  { key: 'notes', label: 'İstisna / Not', width: 40 },
];

function buildReport(id, f = {}) {
  const sys = f.system ? { system: f.system } : {};
  switch (id) {
    case 'sunucu': {
      const { list } = serverSummaries(sys);
      const rows = list.filter(s => s.covered || s.passive_count).filter(serverFilter(f)).map((s, i) => ({
        no: i + 1, hostname: s.hostname, description: s.description, environment: s.environment, criticality: s.criticality,
        active_count: s.active_count, passive_count: s.passive_count, methods: lines(s.methods), policies: lines(s.policy_names),
        full: lines(s.full_lines), incr: lines(s.incr_lines), tape: s.tape_status, tape_lines: lines(s.tape_lines),
        tape_ret: lines(s.tape_retention), other: lines(s.other_lines), rpo: rpoText(s.rpo_hours),
        passive: lines(s.passive_lines), notes: lines(s.notes),
      }));
      return { columns: SERVER_COLS, rows, pdfSize: 'A3' };
    }
    case 'kaset': {
      const data = loadAll(sys);
      const host = new Map(data.servers.map(s => [s.id, s]));
      const rows = [];
      for (const p of data.policies.filter(policyFilter({ ...f, tape: '' }))) {
        for (const s of p.schedules.filter(x => x.tape === 'SLP')) {
          for (const c of p.clients) {
            const sv = host.get(c.server_id);
            if (!sv || !match(f.q, sv.hostname, p.name)) continue;
            if (f.environment && (sv.environment || 'Belirtilmemiş') !== f.environment) continue;
            rows.push({
              hostname: sv.hostname, environment: sv.environment, policy: p.name, policy_type: p.policy_type,
              active: p.active ? 'EVET' : 'HAYIR (pasif)', method: p.method, schedule: s.name, type: typeLabel(s.backup_type),
              when: describeWhen(s), window: describeWindows(s.windows), retention: retentionText(s.retention_level, data.levels),
            });
          }
        }
      }
      rows.sort((a, b) => a.hostname.localeCompare(b.hostname));
      return {
        columns: [
          { key: 'hostname', label: 'Sunucu', width: 18, pdf: true }, { key: 'environment', label: 'Ortam', width: 10, pdf: true },
          { key: 'policy', label: 'Policy', width: 36, pdf: true }, { key: 'policy_type', label: 'Policy Type', width: 16, pdf: true },
          { key: 'active', label: 'Policy aktif mi', width: 12, pdf: true }, { key: 'method', label: 'Yöntem', width: 28 },
          { key: 'schedule', label: 'SLP schedule', width: 14, pdf: true }, { key: 'type', label: 'Schedule tipi', width: 14 },
          { key: 'when', label: 'Ne zaman', width: 36, pdf: true }, { key: 'window', label: 'Pencere', width: 26, pdf: true },
          { key: 'retention', label: 'Saklama (retention)', width: 16, pdf: true },
        ], rows,
      };
    }
    case 'detay': {
      const data = loadAll(sys);
      const host = new Map(data.servers.map(s => [s.id, s]));
      const rows = [];
      for (const p of data.policies.filter(policyFilter(f))) {
        for (const c of p.clients) {
          const sv = host.get(c.server_id);
          if (!sv) continue;
          if (f.environment && (sv.environment || 'Belirtilmemiş') !== f.environment) continue;
          for (const s of p.schedules) {
            rows.push({
              hostname: sv.hostname, client: c.client_name, policy: p.name, policy_type: p.policy_type,
              active: p.active ? 'yes' : 'no', method: p.method, include: p.include_list, schedule: s.name,
              type: typeLabel(s.backup_type), when: describeWhen(s), window: describeWindows(s.windows),
              retention: retentionText(s.retention_level, data.levels), tape: s.tape || '',
            });
          }
        }
      }
      rows.sort((a, b) => a.hostname.localeCompare(b.hostname) || a.policy.localeCompare(b.policy));
      return {
        columns: [
          { key: 'hostname', label: 'Sunucu', width: 18, pdf: true }, { key: 'client', label: 'İstemci adı', width: 28 },
          { key: 'policy', label: 'Policy Name', width: 34, pdf: true }, { key: 'policy_type', label: 'Policy Type', width: 14, pdf: true },
          { key: 'active', label: 'Active', width: 7, pdf: true }, { key: 'method', label: 'Yöntem', width: 28 },
          { key: 'include', label: 'Include', width: 24 }, { key: 'schedule', label: 'Schedule', width: 12, pdf: true },
          { key: 'type', label: 'Tip', width: 20, pdf: true }, { key: 'when', label: 'Ne zaman', width: 40, pdf: true },
          { key: 'window', label: 'Pencere', width: 30, pdf: true }, { key: 'retention', label: 'Saklama', width: 16, pdf: true },
          { key: 'tape', label: 'Kaset', width: 7, pdf: true },
        ], rows, pdfSize: 'A3',
      };
    }
    case 'policy': {
      const data = loadAll(sys);
      const host = new Map(data.servers.map(s => [s.id, s.hostname]));
      const rows = data.policies.filter(policyFilter(f)).map(p => ({
        name: p.name, system: p.backup_system, policy_type: p.policy_type, active: p.active ? 'yes' : 'no', method: p.method,
        clients_count: p.clients.length, clients: p.clients.map(c => host.get(c.server_id)).sort().join('\n'),
        include: p.include_list, schedules: p.schedules.map(s => `${s.name} → ${s.description}`).join('\n'),
        tape: yesNo(p.schedules.some(s => s.tape === 'SLP')),
      }));
      return {
        columns: [
          { key: 'name', label: 'Policy Name', width: 36, pdf: true }, { key: 'system', label: 'Yedekleme sistemi', width: 18 },
          { key: 'policy_type', label: 'Policy Type', width: 14, pdf: true }, { key: 'active', label: 'Active', width: 7, pdf: true },
          { key: 'method', label: 'Yöntem', width: 28, pdf: true }, { key: 'clients_count', label: 'İstemci sayısı', width: 9, pdf: true },
          { key: 'clients', label: 'İstemciler', width: 30 }, { key: 'include', label: 'Include', width: 24, pdf: true },
          { key: 'schedules', label: 'Schedule\'lar', width: 80, pdf: true }, { key: 'tape', label: 'Kaset (SLP) var mı', width: 10, pdf: true },
        ], rows, pdfSize: 'A3',
      };
    }
    case 'istisna': {
      const rows = db.prepare(`SELECT e.*, s.hostname FROM exceptions e LEFT JOIN servers s ON s.id = e.server_id
        ORDER BY s.hostname IS NOT NULL, s.hostname, e.id`).all()
        .filter(e => match(f.q, e.hostname, e.text))
        .map(e => ({ hostname: e.hostname || 'GENEL', text: e.text, resolved: e.resolved ? 'Çözüldü' : 'Açık', created: e.created_at }));
      return {
        columns: [
          { key: 'hostname', label: 'Sunucu', width: 20, pdf: true }, { key: 'text', label: 'İstisna / Not', width: 110, pdf: true },
          { key: 'resolved', label: 'Durum', width: 10, pdf: true }, { key: 'created', label: 'Kayıt', width: 18 },
        ], rows,
      };
    }
    case 'ozet': {
      const k = stats(sys).kpi;
      const rows = [
        ['Toplam sunucu (envanter + policy)', k.servers_total],
        ['Değerlendirilen sunucu (aktif veya yedekli)', k.servers_considered],
        ['Aktif policy ile yedeklenen sunucu', k.covered],
        ['Aktif yedeği olmayan sunucu', k.uncovered],
        ['  – DR hariç yedeksiz sunucu', k.uncovered_non_dr],
        ['Yüksek kritik ve yedeksiz sunucu (DR hariç)', k.high_crit_uncovered],
        ['Kasete çıkan sunucu (aktif SLP)', k.tape_yes],
        ["Sadece pasif policy'de olan sunucu", k.passive_only],
        ["Policy'de olup envanterde olmayan sunucu", k.not_in_inventory],
        ['Aktif policy', k.policies_active],
        ['Pasif policy', k.policies_passive],
        ["Aktif schedule", k.schedules],
        ['Açık istisna / not', k.open_notes],
      ].map(([label, value]) => ({ label, value }));
      return { columns: [{ key: 'label', label: 'Gösterge', width: 50, pdf: true }, { key: 'value', label: 'Değer', width: 12, pdf: true }], rows };
    }
    case 'envanter':
    case 'kapsam-disi': {
      const { list, data } = serverSummaries(sys);
      const byId = new Map(data.servers.map(s => [s.id, s]));
      let src = list;
      if (id === 'kapsam-disi') src = list.filter(s => s.in_inventory && !s.covered);
      const rows = src.filter(serverFilter(f)).map(s => {
        const r = byId.get(s.id);
        return {
          hostname: r.hostname, domain: r.domain, ip: r.ip, environment: r.environment, platform: r.platform, os: r.os,
          vcpu: r.vcpu, ram: r.ram_gb, disk: r.disk_gb, status: r.status, description: r.description, criticality: r.criticality,
          owner: r.owner_team, source: r.source === 'envanter' ? 'Envanter' : r.source === 'policy' ? 'Sadece policy' : 'Manuel',
          covered: s.covered ? 'EVET' : 'HAYIR', tape: s.tape_status, rpo: rpoText(s.rpo_hours),
        };
      });
      return {
        columns: [
          { key: 'hostname', label: 'Hostname', width: 18, pdf: true }, { key: 'domain', label: 'Domain', width: 16 },
          { key: 'ip', label: 'IP Adresi', width: 15, pdf: true }, { key: 'environment', label: 'Ortam', width: 10, pdf: true },
          { key: 'platform', label: 'Platform', width: 10, pdf: true }, { key: 'os', label: 'OS', width: 24 },
          { key: 'vcpu', label: 'vCPU', width: 6 }, { key: 'ram', label: 'RAM (GB)', width: 8 }, { key: 'disk', label: 'Disk (GB)', width: 9 },
          { key: 'status', label: 'Durum', width: 12, pdf: true }, { key: 'description', label: 'Açıklama', width: 34, pdf: true },
          { key: 'criticality', label: 'Kritiklik', width: 10, pdf: true }, { key: 'owner', label: 'Sahip ekip', width: 14 },
          { key: 'source', label: 'Kaynak', width: 12 }, { key: 'covered', label: 'Yedek var mı', width: 10, pdf: true },
          { key: 'tape', label: 'Kaset', width: 12, pdf: true }, { key: 'rpo', label: 'Tahmini RPO', width: 10, pdf: true },
        ], rows,
      };
    }
    case 'risk': {
      const rows = [];
      for (const r of findings(sys)) {
        for (const it of r.items) {
          if (!match(f.q, it.hostname, r.title)) continue;
          rows.push({ severity: SEV[r.severity], rule: r.title, hostname: it.hostname, description: it.description, environment: it.environment, criticality: it.criticality, detail: it.detail });
        }
      }
      return {
        columns: [
          { key: 'severity', label: 'Önem', width: 10, pdf: true }, { key: 'rule', label: 'Bulgu', width: 40, pdf: true },
          { key: 'hostname', label: 'Sunucu / Policy', width: 22, pdf: true }, { key: 'description', label: 'Açıklama', width: 34, pdf: true },
          { key: 'environment', label: 'Ortam', width: 10, pdf: true }, { key: 'criticality', label: 'Kritiklik', width: 10, pdf: true },
          { key: 'detail', label: 'Detay', width: 30, pdf: true },
        ], rows,
      };
    }
    case 'tasima': {
      const all = db.prepare('SELECT * FROM servers ORDER BY mig_wave IS NULL, mig_wave, hostname').all();
      const { list } = serverSummaries(sys);
      const sum = new Map(list.map(s => [s.id, s]));
      const rows = all.filter(r => {
        const s = sum.get(r.id);
        return s && (s.covered || r.mig_wave || (r.mig_status && r.mig_status !== 'Planlanmadı')) && serverFilter(f)(s);
      }).map(r => ({
        hostname: r.hostname, description: r.description, environment: r.environment, criticality: r.criticality,
        methods: lines(sum.get(r.id).methods), wave: r.mig_wave, status: r.mig_status, target_date: r.mig_target_date,
        owner: r.mig_owner, target: r.mig_target, first_backup: r.mig_first_backup, restore: r.mig_restore_test, notes: r.mig_notes,
      }));
      return {
        columns: [
          { key: 'hostname', label: 'Sunucu', width: 18, pdf: true }, { key: 'description', label: 'Görev', width: 28, pdf: true },
          { key: 'environment', label: 'Ortam', width: 10, pdf: true }, { key: 'criticality', label: 'Kritiklik', width: 10, pdf: true },
          { key: 'methods', label: 'Mevcut yöntem', width: 28 }, { key: 'wave', label: 'Dalga', width: 10, pdf: true },
          { key: 'status', label: 'Durum', width: 14, pdf: true }, { key: 'target_date', label: 'Hedef tarih', width: 12, pdf: true },
          { key: 'owner', label: 'Sorumlu', width: 14, pdf: true }, { key: 'target', label: 'Hedef policy / çözüm', width: 24, pdf: true },
          { key: 'first_backup', label: 'İlk başarılı yedek', width: 14, pdf: true }, { key: 'restore', label: 'Test restore', width: 12, pdf: true },
          { key: 'notes', label: 'Notlar', width: 30, pdf: true },
        ], rows,
      };
    }
    default:
      throw Object.assign(new Error('Bilinmeyen rapor'), { status: 404 });
  }
}

const SEV = { critical: 'Kritik', serious: 'Yüksek', warning: 'Uyarı', info: 'Bilgi' };

export function reportData(id, filters) {
  const def = REPORTS.find(r => r.id === id);
  if (!def) throw Object.assign(new Error('Bilinmeyen rapor'), { status: 404 });
  return { ...def, ...buildReport(id, filters) };
}

function filterText(f) {
  const labels = { system: 'Sistem', environment: 'Ortam', criticality: 'Kritiklik', policy_type: 'Policy tipi', tape: 'Kaset', covered: 'Yedek', active: 'Aktif', mig_status: 'Taşıma', q: 'Arama' };
  return Object.entries(f).filter(([k, v]) => v && labels[k]).map(([k, v]) => `${labels[k]}: ${v}`).join(' · ');
}

// ---------- Excel ----------
function addSheet(wb, rep) {
  const name = rep.title.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = rep.columns.map(c => ({ header: c.label, key: c.key, width: c.width || 14 }));
  ws.addRows(rep.rows);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5CAB' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.alignment = { wrapText: true, vertical: 'top' };
    if (n % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rep.columns.length } };
  return ws;
}

export async function toXlsx(ids, filters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'vbackup';
  wb.created = new Date();
  for (const id of ids) addSheet(wb, reportData(id, filters));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------
function pdfContent(rep, filters) {
  const content = [
    { text: rep.title, style: 'h1' },
    { text: `${rep.description}\nOluşturma: ${new Date().toLocaleString('tr-TR')}${filterText(filters) ? ' · Filtre: ' + filterText(filters) : ''} · Kayıt: ${rep.rows.length}`, style: 'meta' },
  ];
  const cols = rep.columns.filter(c => c.pdf);
  const total = cols.reduce((a, c) => a + (c.width || 14), 0);
  content.push({
    table: {
      headerRows: 1,
      widths: cols.map(c => `${((c.width || 14) / total * 100).toFixed(2)}%`),
      body: [
        cols.map(c => ({ text: c.label, style: 'th' })),
        ...rep.rows.map(r => cols.map(c => ({ text: pdfText(r[c.key]), style: 'td' }))),
      ],
    },
    layout: {
      fillColor: (i) => (i === 0 ? '#1c5cab' : i % 2 === 0 ? '#f3f6fa' : null),
      hLineColor: () => '#dfe3ea', vLineColor: () => '#dfe3ea', hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    },
  });
  return content;
}

// Roboto'da olmayan karakterler (ör. ok işareti) PDF'te boş kutu olarak çıkmasın
const pdfText = v => (v === null || v === undefined ? '' : String(v).replace(/→/g, '»'));

const kpiCell = (label, value) => ({
  stack: [{ text: String(value), fontSize: 18, bold: true, color: '#1c5cab' }, { text: label, fontSize: 8, color: '#52514e' }],
  fillColor: '#f3f6fa', margin: [8, 6, 8, 6],
});

export function toPdf(ids, filters) {
  const reps = ids.map(id => reportData(id, filters));
  const big = reps.some(r => r.pdfSize === 'A3');
  const content = [];
  reps.forEach((r, i) => {
    const c = pdfContent(r, filters);
    if (i > 0) c[0].pageBreak = 'before';
    content.push(...c);
  });
  const doc = printer.createPdfKitDocument({
    pageSize: big ? 'A3' : 'A4',
    pageOrientation: 'landscape',
    pageMargins: [24, 28, 24, 28],
    defaultStyle: { font: 'Roboto', fontSize: big ? 7 : 7.5 },
    info: { title: reps.map(r => r.title).join(', '), creator: 'vbackup' },
    footer: (page, pages) => ({ text: `vbackup · ${getSetting('company_name', 'Yedekleme Politikası')} · ${page}/${pages}`, alignment: 'right', fontSize: 7, color: '#898781', margin: [0, 8, 24, 0] }),
    content,
    styles: {
      h1: { fontSize: 16, bold: true, color: '#0d366b', margin: [0, 0, 0, 2] },
      h2: { fontSize: 11, bold: true, color: '#1c5cab', margin: [0, 10, 0, 3] },
      p: { fontSize: 9, margin: [0, 1, 0, 1], lineHeight: 1.2 },
      meta: { fontSize: 8, color: '#52514e', margin: [0, 0, 0, 8] },
      th: { bold: true, color: '#ffffff', fontSize: big ? 7 : 7.5 },
      td: { fontSize: big ? 6.5 : 7 },
    },
  });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

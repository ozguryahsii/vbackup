// Grafik / KPI detayı: bir sayıya tıklanınca o sayıyı oluşturan sunucuları listeler
import { api, withSystem } from './api.js';
import { esc, modal, DataTable, coverageBadge, tapeBadge, critBadge, fmtNum, icon, toast, trLower } from './ui.js';
import { rpoText } from './schedule.js';

let cache = null;
async function serverMap() {
  if (!cache || Date.now() - cache.at > 15000) {
    cache = { at: Date.now(), map: new Map((await api.get(withSystem('/api/servers'))).map(s => [s.id, s])) };
  }
  return cache.map;
}
export function resetDrillCache() { cache = null; }

// ids (sunucu id'leri) ya da hostnames verilebilir
export async function showServers({ title, subtitle = '', ids, hostnames }) {
  const map = await serverMap();
  let rows;
  if (hostnames) {
    const byHost = new Map([...map.values()].map(s => [s.hostname, s]));
    rows = [...new Set(hostnames)].map(h => byHost.get(h)).filter(Boolean);
  } else {
    rows = [...new Set(ids)].map(id => map.get(id)).filter(Boolean);
  }
  const { el } = modal({
    title: `${title} · ${fmtNum(rows.length)} sunucu`,
    wide: true,
    body: `${subtitle ? `<p class="small text-2" style="margin-top:0">${esc(subtitle)}</p>` : ''}
      <div class="filters"><input type="search" id="dq" placeholder="Bu listede ara…" style="flex:1"></div><div id="dt"></div>`,
    foot: `<button class="btn" data-copy>${icon('copy', 16)}Hostname'leri kopyala</button><button class="btn" data-csv>${icon('download', 16)}CSV indir</button><span class="spacer"></span><button class="btn primary" data-close>Kapat</button>`,
  });
  const table = new DataTable(el.querySelector('#dt'), {
    rows, pageSize: 15, initialSort: { key: 'hostname', dir: 1 },
    emptyText: 'Bu değerde sunucu yok',
    onRowClick: r => { location.hash = `#/server/${r.id}`; },
    columns: [
      { key: 'hostname', label: 'Sunucu', render: r => `<a href="#/server/${r.id}"><strong>${esc(r.hostname)}</strong></a>` },
      { key: 'description', label: 'Açıklama', render: r => `<span class="text-2 small" data-notr>${esc(r.description || '—')}</span>` },
      { key: 'environment', label: 'Ortam' },
      { key: 'criticality', label: 'Kritiklik', render: r => critBadge(r.criticality) },
      { key: 'covered', label: 'Yedek', render: coverageBadge, sort: r => (r.covered ? 1 : 0) },
      { key: 'methods', label: 'Yöntem', render: r => `<span class="small">${esc(r.methods.map(x => x.replace(/ – instance .*/, '')).join(', ') || '—')}</span>`, sort: r => r.methods.join() },
      { key: 'tape_status', label: 'Kaset', render: r => (r.covered ? tapeBadge(r.tape_status) : '<span class="muted">—</span>') },
      { key: 'rpo_hours', label: 'RPO', num: true, render: r => rpoText(r.rpo_hours) },
    ],
  });
  el.querySelector('#dq').addEventListener('input', e => {
    const q = trLower(e.target.value);
    table.setRows(rows.filter(s => !q || trLower(`${s.hostname} ${s.description} ${s.environment} ${s.methods.join(' ')}`).includes(q)));
  });
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    const text = rows.map(r => r.hostname).sort().join('\n');
    try { await navigator.clipboard.writeText(text); toast(`${rows.length} hostname kopyalandı`); } catch { toast('Kopyalanamadı', 'err'); }
  });
  el.querySelector('[data-csv]').addEventListener('click', () => {
    const cols = ['hostname', 'description', 'environment', 'criticality', 'platform', 'status', 'ip'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => q(r[c])).join(';'))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${title.replace(/[^\wçğıöşüÇĞİÖŞÜ -]/g, '').trim().replace(/\s+/g, '-') || 'sunucular'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

import { api, state, withSystem } from '../lib/api.js';
import { esc, icon, options, fmtNum, debounce } from '../lib/ui.js';

// Hangi rapor hangi filtreleri destekler
const FILTERS = {
  genel: [], ozet: [],
  sunucu: ['q', 'environment', 'criticality', 'policy_type', 'tape', 'mig_status'],
  kaset: ['q', 'environment', 'policy_type', 'active'],
  detay: ['q', 'environment', 'policy_type', 'active', 'tape'],
  policy: ['q', 'policy_type', 'active', 'tape'],
  istisna: ['q'],
  envanter: ['q', 'environment', 'criticality', 'covered', 'tape'],
  'kapsam-disi': ['q', 'environment', 'criticality'],
  risk: ['q'],
  tasima: ['q', 'environment', 'criticality', 'mig_status'],
};

export async function render(view, { match }) {
  const meta = state.meta;
  let current = meta.reports.find(r => r.id === match[1]) ? match[1] : 'sunucu';
  const f = {};

  view.innerHTML = `<div class="page-head"><div><h1>Raporlar</h1>
    <p>Mevcut politikayı Excel veya PDF olarak dışa aktarın. Raporlar Excel'deki sayfa yapısını izler; “Tüm raporlar” tek dosyada her raporu ayrı sayfa olarak üretir.
    ${state.system ? `Üst menüdeki sistem filtresi uygulanır: <strong>${esc(state.system)}</strong>.` : ''}</p></div>
    <div class="actions"><a class="btn" id="all-x" href="#">${icon('download', 16)}Tüm raporlar (Excel)</a><a class="btn" id="all-p" href="#">${icon('download', 16)}Tüm raporlar (PDF)</a></div></div>
  <div class="grid" style="grid-template-columns:280px minmax(0,1fr)" id="rg">
    <section class="card card-pad report-list" style="align-self:start">${meta.reports.map(r => `<button data-r="${r.id}">${esc(r.title)}<small>${esc(r.description)}</small></button>`).join('')}</section>
    <section class="card"><div class="card-head"><div><h3 id="rt"></h3><p id="rd"></p></div>
      <div class="actions"><a class="btn" id="dx" href="#">${icon('download', 16)}Excel</a><a class="btn primary" id="dp" href="#">${icon('download', 16)}PDF</a></div></div>
      <div class="card-body"><div class="filters" id="rf"></div><div id="prev"></div></div></section>
  </div>`;
  if (window.innerWidth < 900) view.querySelector('#rg').style.gridTemplateColumns = 'minmax(0,1fr)';
  const allUrl = fmt => withSystem('/api/reports/all', { format: fmt });
  view.querySelector('#all-x').href = allUrl('xlsx');
  view.querySelector('#all-p').href = allUrl('pdf');

  const filterHTML = id => (FILTERS[id] || []).map(k => {
    switch (k) {
      case 'q': return `<input type="search" data-k="q" placeholder="Ara…" value="${esc(f.q || '')}">`;
      case 'environment': return `<select data-k="environment">${options([...meta.environments, 'Belirtilmemiş'], f.environment, { empty: 'Tüm ortamlar' })}</select>`;
      case 'criticality': return `<select data-k="criticality">${options([...meta.criticalities, 'Belirtilmemiş'], f.criticality, { empty: 'Tüm kritiklikler' })}</select>`;
      case 'policy_type': return `<select data-k="policy_type">${options(meta.policyTypes, f.policy_type, { empty: 'Tüm policy tipleri' })}</select>`;
      case 'tape': return `<select data-k="tape">${options([{ value: 'EVET', label: 'Kasete çıkan' }, { value: 'HAYIR', label: 'Kasete çıkmayan' }], f.tape, { empty: 'Kaset: hepsi' })}</select>`;
      case 'active': return `<select data-k="active">${options([{ value: 'yes', label: 'Aktif policy' }, { value: 'no', label: 'Pasif policy' }], f.active, { empty: 'Aktif + pasif' })}</select>`;
      case 'covered': return `<select data-k="covered">${options([{ value: 'yes', label: 'Yedeği var' }, { value: 'no', label: 'Yedeği yok' }], f.covered, { empty: 'Yedek: hepsi' })}</select>`;
      case 'mig_status': return `<select data-k="mig_status">${options(meta.migStatuses, f.mig_status, { empty: 'Taşıma: hepsi' })}</select>`;
      default: return '';
    }
  }).join('');

  const params = () => {
    const p = {};
    for (const k of FILTERS[current] || []) if (f[k]) p[k] = f[k];
    return p;
  };

  async function load() {
    const rep = await api.get(withSystem(`/api/reports/${current}`, { ...params(), limit: 300 }));
    view.querySelector('#rt').textContent = rep.title;
    view.querySelector('#rd').textContent = `${rep.description} · ${fmtNum(rep.total)} kayıt${rep.total > rep.rows.length ? ` (önizlemede ilk ${rep.rows.length})` : ''}`;
    view.querySelector('#dx').href = withSystem(`/api/reports/${current}`, { ...params(), format: 'xlsx' });
    view.querySelector('#dp').href = withSystem(`/api/reports/${current}`, { ...params(), format: 'pdf' });
    if (current === 'genel') {
      view.querySelector('#prev').innerHTML = `<div style="max-width:900px">${rep.rows.map((r, i) => i === 0 ? `<h2>${esc(r.line)}</h2>` : /^\d+\.\s/.test(r.line) ? `<h3 style="margin:16px 0 6px;color:var(--accent)">${esc(r.line)}</h3>` : `<p style="margin:4px 0">${esc(r.line)}</p>`).join('')}
        <p class="small muted mt"><a href="#/policies/general">Metni düzenle →</a></p></div>`;
      return;
    }
    view.querySelector('#prev').innerHTML = `<div class="table-wrap" style="max-height:62vh"><table class="data"><thead><tr>${rep.columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rep.rows.map(r => `<tr>${rep.columns.map(c => `<td class="${String(r[c.key] ?? '').includes('\n') || String(r[c.key] ?? '').length > 60 ? 'cell-lines' : ''}">${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${rep.columns.length}"><div class="empty">Kayıt yok</div></td></tr>`}</tbody></table></div>
      <p class="small muted">PDF'de okunabilirlik için yalnızca ana kolonlar yer alır; Excel çıktısı tüm kolonları içerir.</p>`;
  }

  function select(id) {
    current = id;
    history.replaceState(null, '', `#/reports/${id}`);
    view.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === id));
    view.querySelector('#rf').innerHTML = filterHTML(id);
    view.querySelector('#rf').hidden = !(FILTERS[id] || []).length;
    load();
  }
  view.querySelector('.report-list').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) select(b.dataset.r); });
  const rf = view.querySelector('#rf');
  rf.addEventListener('change', e => { if (e.target.dataset.k && e.target.dataset.k !== 'q') { f[e.target.dataset.k] = e.target.value; load(); } });
  rf.addEventListener('input', debounce(e => { if (e.target.dataset.k === 'q') { f.q = e.target.value; load(); } }, 250));
  select(current);
}

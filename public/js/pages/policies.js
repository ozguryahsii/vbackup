import { api, state, withSystem } from '../lib/api.js';
import { esc, DataTable, options, icon, toast, trLower, debounce } from '../lib/ui.js';
import { catColor } from '../lib/charts.js';
import { CATEGORY_LABELS } from '../lib/schedule.js';
import { navigate } from '../app.js';

export async function render(view, { match, params }) {
  const tab = match[1] === 'general' ? 'general' : 'list';
  view.innerHTML = `<div class="page-head"><div><h1>Politikalar</h1>
    <p>Backup policy tanımları: hangi sunucular, hangi yöntemle, hangi schedule'larla (sıklık, pencere, saklama, kaset) yedekleniyor. Yeni policy'lerde istemciler Envanter'den seçilir.</p></div>
    <div class="actions"><a class="btn" href="#/reports/policy">${icon('download', 16)}Dışa aktar</a><a class="btn primary" href="#/policy/new">${icon('plus', 16)}Yeni policy</a></div></div>
    <div class="tabs"><button data-tab="list" class="${tab === 'list' ? 'on' : ''}">Policy Listesi</button><button data-tab="general" class="${tab === 'general' ? 'on' : ''}">Genel Politika Metni</button></div>
    <div id="tab"></div>`;
  view.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) navigate(b.dataset.tab === 'general' ? '#/policies/general' : '#/policies');
  });
  const el = view.querySelector('#tab');
  if (tab === 'general') return general(el);
  return list(el, params);
}

async function list(el, params) {
  const m = state.meta;
  const f = { q: params.get('q') || '', type: params.get('type') || '', active: params.get('active') || '', tape: '', system: '' };
  el.innerHTML = `<div class="card card-pad"><div class="filters">
      <input type="search" name="q" placeholder="Policy adı, yöntem…" value="${esc(f.q)}">
      <select name="type">${options(m.policyTypes, f.type, { empty: 'Tüm tipler' })}</select>
      <select name="active">${options([{ value: '1', label: 'Aktif' }, { value: '0', label: 'Pasif' }], f.active, { empty: 'Aktif + pasif' })}</select>
      <select name="tape">${options([{ value: '1', label: 'Kaset (SLP) var' }, { value: '0', label: 'Kaset yok' }], '', { empty: 'Kaset: hepsi' })}</select>
    </div><div id="tbl"></div></div>`;
  const all = await api.get(withSystem('/api/policies'));
  const table = new DataTable(el.querySelector('#tbl'), {
    initialSort: { key: 'name', dir: 1 },
    onRowClick: r => navigate(`#/policy/${r.id}`),
    columns: [
      { key: 'name', label: 'Policy', render: r => `<a href="#/policy/${r.id}"><strong>${esc(r.name)}</strong></a><div class="small muted">${esc(r.backup_system || '')}</div>` },
      { key: 'policy_type', label: 'Tip' },
      { key: 'active', label: 'Durum', render: r => (r.active ? '<span class="badge good">Aktif</span>' : '<span class="badge warn">Pasif</span>'), sort: r => r.active },
      { key: 'method', label: 'Yöntem', render: r => `<span class="small">${esc(r.method || '—')}</span>` },
      { key: 'categories', label: 'Schedule türleri', sortable: false, render: r => r.categories.filter(c => c !== 'app').map(c => `<span class="badge"><span class="dot" style="background:${catColor(c)}"></span>${CATEGORY_LABELS[c]}</span>`).join(' ') },
      { key: 'summary', label: 'Özet', sortable: false, cls: 'cell-lines', render: r => esc(r.summary.join('\n')) },
      { key: 'clients', label: 'Sunucu', num: true },
    ],
  });
  const apply = () => {
    const q = trLower(f.q);
    table.setRows(all.filter(p => (!f.type || p.policy_type === f.type) && (f.active === '' || String(p.active) === f.active) &&
      (f.tape === '' || String(Number(p.tape)) === f.tape) && (!q || trLower(`${p.name} ${p.method} ${p.include_list}`).includes(q))));
  };
  apply();
  const fl = el.querySelector('.filters');
  fl.addEventListener('change', e => { if (e.target.name) { f[e.target.name] = e.target.value; apply(); } });
  fl.querySelector('[name=q]').addEventListener('input', debounce(e => { f.q = e.target.value; apply(); }, 150));
}

async function general(el) {
  const { text } = await api.get('/api/settings/general-policy');
  el.innerHTML = `<div class="grid g2">
    <section class="card"><div class="card-head"><div><h3>Düzenle</h3><p>Numaralı satırlar ("1. …") raporlarda başlık olarak biçimlenir. Madde işaretleri için "•" kullanın.</p></div>
      <button class="btn primary sm" data-save>${icon('check', 14)}Kaydet</button></div>
      <div class="card-body"><textarea id="gp" rows="30" style="font-size:13px">${esc(text)}</textarea></div></section>
    <section class="card"><div class="card-head"><div><h3>Önizleme</h3><p>Genel Politika raporu (Excel/PDF) bu metinle oluşturulur.</p></div></div>
      <div class="card-body" id="pv" style="max-height:70vh;overflow:auto"></div></section></div>`;
  const pv = el.querySelector('#pv');
  const draw = () => {
    pv.innerHTML = el.querySelector('#gp').value.split('\n').filter(Boolean).map((l, i) => {
      if (i === 0) return `<h2 style="margin-bottom:8px">${esc(l)}</h2>`;
      if (/^\d+\.\s/.test(l)) return `<h3 style="margin:16px 0 6px;color:var(--accent)">${esc(l)}</h3>`;
      return `<p style="margin:4px 0" class="${l.startsWith('•') ? '' : 'text-2'}">${esc(l)}</p>`;
    }).join('');
  };
  draw();
  el.querySelector('#gp').addEventListener('input', debounce(draw, 150));
  el.querySelector('[data-save]').addEventListener('click', async () => {
    await api.put('/api/settings/general-policy', { text: el.querySelector('#gp').value });
    toast('Genel politika metni kaydedildi');
  });
}

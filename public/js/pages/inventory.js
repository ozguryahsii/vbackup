import { api, state, withSystem } from '../lib/api.js';
import { esc, DataTable, options, coverageBadge, tapeBadge, critBadge, icon, toast, pickFile, trLower, debounce } from '../lib/ui.js';
import { serverFormModal } from '../lib/forms.js';
import { RPO_BUCKETS, rpoText } from '../lib/schedule.js';
import { navigate, reloadMeta, invalidateSearch } from '../app.js';

const FILTER_KEYS = ['q', 'environment', 'criticality', 'platform', 'status', 'covered', 'tape', 'rpo', 'source'];

export async function render(view, { params }) {
  const m = state.meta;
  const f = Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) || '']));
  view.innerHTML = `<div class="page-head"><div><h1>Envanter</h1>
    <p>Tüm sunucular (CMDB export'u + policy'lerde geçen sunucular). Politika ekranında istemci seçerken bu liste kullanılır. Satıra tıklayınca sunucunun yedek kartı açılır.</p></div>
    <div class="actions">
      <button class="btn" data-import>${icon('upload', 16)}Envanter içe aktar</button>
      <a class="btn" href="#/reports/envanter">${icon('download', 16)}Dışa aktar</a>
      <button class="btn primary" data-add>${icon('plus', 16)}Sunucu ekle</button></div></div>
    <div class="card card-pad">
      <div class="filters">
        <input type="search" name="q" placeholder="Hostname, IP, açıklama, policy…" value="${esc(f.q)}">
        <select name="environment">${options(m.environments, f.environment, { empty: 'Tüm ortamlar' })}<option value="Belirtilmemiş" ${f.environment === 'Belirtilmemiş' ? 'selected' : ''}>Belirtilmemiş</option></select>
        <select name="criticality">${options(m.criticalities, f.criticality, { empty: 'Tüm kritiklikler' })}<option value="Belirtilmemiş" ${f.criticality === 'Belirtilmemiş' ? 'selected' : ''}>Belirtilmemiş</option></select>
        <select name="platform">${options(m.platforms, f.platform, { empty: 'Tüm platformlar' })}<option value="Belirtilmemiş" ${f.platform === 'Belirtilmemiş' ? 'selected' : ''}>Belirtilmemiş</option></select>
        <select name="status">${options(m.statuses, f.status, { empty: 'Tüm durumlar' })}</select>
        <select name="covered">${options([{ value: 'yes', label: 'Yedeği var' }, { value: 'no', label: 'Yedeği yok' }], f.covered, { empty: 'Yedek: hepsi' })}</select>
        <select name="tape">${options([{ value: 'EVET', label: 'Kasete çıkıyor' }, { value: 'HAYIR', label: 'Kasete çıkmıyor' }, { value: "Sadece pasif policy'de", label: 'Sadece pasif policy\'de' }], f.tape, { empty: 'Kaset: hepsi' })}</select>
        <select name="rpo">${options(RPO_BUCKETS, f.rpo, { empty: 'RPO: hepsi' })}</select>
        <select name="source">${options([{ value: 'envanter', label: 'Envanterde' }, { value: 'policy', label: 'Sadece policy\'de' }, { value: 'manual', label: 'Manuel eklenen' }], f.source, { empty: 'Kaynak: hepsi' })}</select>
        <button class="btn ghost sm" data-clear>Temizle</button>
      </div>
      <div id="tbl"></div></div>`;

  let all = await api.get(withSystem('/api/servers'));
  const table = new DataTable(view.querySelector('#tbl'), {
    pageSize: 50,
    initialSort: { key: 'hostname', dir: 1 },
    onRowClick: r => navigate(`#/server/${r.id}`),
    columns: [
      { key: 'hostname', label: 'Sunucu', render: r => `<a href="#/server/${r.id}"><strong>${esc(r.hostname)}</strong></a>${r.source === 'policy' ? ' <span class="badge warn" title="Envanterde kaydı yok">CMDB yok</span>' : ''}<div class="small muted">${esc(r.ip || '')}</div>` },
      { key: 'description', label: 'Açıklama', render: r => `<span class="text-2">${esc(r.description || '—')}</span>` },
      { key: 'environment', label: 'Ortam' },
      { key: 'platform', label: 'Platform' },
      { key: 'criticality', label: 'Kritiklik', render: r => critBadge(r.criticality) },
      { key: 'status', label: 'Durum', render: r => r.status && r.status !== 'Aktif' ? `<span class="badge warn">${esc(r.status)}</span>` : esc(r.status || '—') },
      { key: 'covered', label: 'Yedek', render: coverageBadge, sort: r => (r.covered ? 2 : r.passive_count ? 1 : 0) },
      { key: 'methods', label: 'Yöntem', render: r => `<span class="small">${esc(r.methods.map(x => x.replace(/ – instance .*/, '')).join(', ') || '—')}</span>`, sort: r => r.methods.join() },
      { key: 'tape_status', label: 'Kaset', render: r => (r.covered || r.passive_count ? tapeBadge(r.tape_status) : '<span class="muted">—</span>') },
      { key: 'rpo_hours', label: 'RPO', num: true, render: r => rpoText(r.rpo_hours) },
      { key: 'active_count', label: 'Policy', num: true },
    ],
  });

  const apply = () => {
    const q = trLower(f.q);
    table.setRows(all.filter(s =>
      (!f.environment || (s.environment || 'Belirtilmemiş') === f.environment) &&
      (!f.criticality || (s.criticality || 'Belirtilmemiş') === f.criticality) &&
      (!f.platform || (s.platform || 'Belirtilmemiş') === f.platform) &&
      (!f.status || s.status === f.status) &&
      (!f.covered || (f.covered === 'yes' ? s.covered : !s.covered)) &&
      (!f.tape || s.tape_status === f.tape) &&
      (!f.rpo || s.rpo_bucket === f.rpo) &&
      (!f.source || s.source === f.source) &&
      (!q || trLower(`${s.hostname} ${s.ip} ${s.description} ${s.policy_names.join(' ')} ${s.os}`).includes(q))));
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/inventory${qs ? '?' + qs : ''}`);
  };
  apply();

  const filters = view.querySelector('.filters');
  filters.addEventListener('change', e => { if (e.target.name) { f[e.target.name] = e.target.value; apply(); } });
  filters.querySelector('[name=q]').addEventListener('input', debounce(e => { f.q = e.target.value; apply(); }, 150));
  view.querySelector('[data-clear]').addEventListener('click', () => navigate('#/inventory'));
  view.querySelector('[data-add]').addEventListener('click', () => serverFormModal({}, id => { invalidateSearch(); reloadMeta(); navigate(`#/server/${id}`); }));
  view.querySelector('[data-import]').addEventListener('click', async () => {
    const file = await pickFile('.xlsx');
    if (!file) return;
    const r = await api.upload('/api/import/inventory', file);
    toast(`Envanter güncellendi: ${r.inserted} yeni, ${r.updated} güncellenen sunucu`);
    await reloadMeta();
    invalidateSearch();
    all = await api.get(withSystem('/api/servers'));
    apply();
  });
}

import { api, state, withSystem } from '../lib/api.js';
import { esc, DataTable, options, migBadge, critBadge, icon, toast, modal, formData, trLower, debounce, pct, fmtNum } from '../lib/ui.js';
import { migrationFormModal } from '../lib/forms.js';
import { refresh, reloadMeta } from '../app.js';

const MIG_COLORS = { 'Planlanmadı': '--axis', 'Planlandı': '--s1', 'Devam ediyor': '--s4', 'Taşındı': '--s3', 'Doğrulandı': '--s6', 'Kapsam dışı': '--muted' };

export async function render(view, { params }) {
  const meta = state.meta;
  const f = { q: '', status: params.get('status') || '', wave: params.get('wave') || '', environment: '', criticality: '', scope: 'scope' };
  const all = await api.get(withSystem('/api/servers'));
  const inScope = s => s.covered || s.mig_wave || (s.mig_status && s.mig_status !== 'Planlanmadı');
  const scope = all.filter(inScope);
  const counts = meta.migStatuses.map(st => ({ st, n: scope.filter(s => (s.mig_status || 'Planlanmadı') === st).length }));
  const done = scope.filter(s => ['Taşındı', 'Doğrulandı'].includes(s.mig_status)).length;
  const overdue = scope.filter(s => s.mig_target_date && s.mig_target_date < new Date().toISOString().slice(0, 10) && !['Taşındı', 'Doğrulandı', 'Kapsam dışı'].includes(s.mig_status)).length;
  const noRestore = scope.filter(s => s.mig_status === 'Taşındı' && !s.mig_restore_test).length;

  view.innerHTML = `<div class="page-head"><div><h1>Taşıma Takibi</h1>
    <p>Kısa dönemli taşıma projesi için sunucu bazlı ilerleme: dalga, hedef tarih, sorumlu, hedef çözüm, ilk başarılı yedek ve test restore. Toplu güncelleme için satırları seçin.</p></div>
    <div class="actions"><a class="btn" href="#/stats/tasima">${icon('chart', 16)}Grafikler</a><a class="btn" href="#/reports/tasima">${icon('download', 16)}Rapor</a></div></div>
  <div class="card card-pad mb">
    <div class="row"><strong>Genel ilerleme</strong><span class="muted small">${fmtNum(done)} / ${fmtNum(scope.length)} sunucu taşındı veya doğrulandı (%${pct(done, scope.length)})</span><span class="spacer"></span>
      ${overdue ? `<span class="badge crit">${icon('alert', 12)}${overdue} gecikmiş</span>` : ''}${noRestore ? `<span class="badge warn" title="Taşındı ama test restore tarihi girilmemiş">${noRestore} restore testi bekliyor</span>` : ''}</div>
    <div class="progress-big mt" style="margin-top:10px">${counts.filter(c => c.n).map(c => `<span style="width:${pct(c.n, scope.length)}%;background:var(${MIG_COLORS[c.st]})" title="${esc(c.st)}: ${c.n}"></span>`).join('')}</div>
    <div class="legend">${counts.map(c => `<span><i class="sw" style="background:var(${MIG_COLORS[c.st]})"></i>${esc(c.st)} <strong class="tnum">${c.n}</strong></span>`).join('')}</div>
  </div>
  <div class="card card-pad">
    <div class="filters">
      <input type="search" name="q" placeholder="Sunucu, sorumlu, not…">
      <select name="scope">${options([{ value: 'scope', label: 'Taşıma kapsamı (yedeği olan + atanmış)' }, { value: 'all', label: 'Tüm sunucular' }], f.scope)}</select>
      <select name="status">${options(meta.migStatuses, f.status, { empty: 'Tüm durumlar' })}</select>
      <select name="wave">${options(meta.waves, f.wave, { empty: 'Tüm dalgalar' })}<option value="-" ${f.wave === '-' ? 'selected' : ''}>Dalga atanmamış</option></select>
      <select name="environment">${options(meta.environments, '', { empty: 'Tüm ortamlar' })}</select>
      <select name="criticality">${options(meta.criticalities, '', { empty: 'Tüm kritiklikler' })}</select>
      <span class="spacer"></span>
      <button class="btn primary" data-bulk disabled>${icon('edit', 16)}Seçilenleri güncelle</button>
    </div>
    <div id="tbl"></div></div>`;

  const table = new DataTable(view.querySelector('#tbl'), {
    selectable: true, pageSize: 100,
    initialSort: { key: 'mig_wave', dir: 1 },
    columns: [
      { key: 'hostname', label: 'Sunucu', render: r => `<a href="#/server/${r.id}"><strong>${esc(r.hostname)}</strong></a><div class="small muted">${esc(r.description || '')}</div>` },
      { key: 'environment', label: 'Ortam' },
      { key: 'criticality', label: 'Kritiklik', render: r => critBadge(r.criticality) },
      { key: 'methods', label: 'Mevcut yöntem', render: r => `<span class="small">${esc(r.methods.map(x => x.replace(/ – instance .*/, '')).join(', ') || '—')}</span>`, sort: r => r.methods.join() },
      { key: 'mig_wave', label: 'Dalga', render: r => esc(r.mig_wave || '—') },
      { key: 'mig_status', label: 'Durum', render: r => `<select data-st="${r.id}" style="min-height:28px;padding:2px 6px">${options(meta.migStatuses, r.mig_status || 'Planlanmadı')}</select>`, sort: r => meta.migStatuses.indexOf(r.mig_status || 'Planlanmadı') },
      { key: 'mig_target_date', label: 'Hedef tarih', render: r => { const late = r.mig_target_date && r.mig_target_date < new Date().toISOString().slice(0, 10) && !['Taşındı', 'Doğrulandı', 'Kapsam dışı'].includes(r.mig_status); return `<span class="nowrap" style="${late ? 'color:var(--critical);font-weight:600' : ''}">${esc(r.mig_target_date || '—')}</span>`; } },
      { key: 'mig_owner', label: 'Sorumlu', render: r => esc(r.mig_owner || '—') },
      { key: 'mig_target', label: 'Hedef çözüm', render: r => `<span class="small">${esc(r.mig_target || '—')}</span>` },
      { key: 'mig_restore_test', label: 'Restore testi', render: r => (r.mig_restore_test ? `<span class="badge good">${icon('check', 12)}${esc(r.mig_restore_test)}</span>` : '<span class="muted">—</span>') },
      { key: 'edit', label: '', sortable: false, render: r => `<button class="btn sm ghost" data-edit="${r.id}">${icon('edit', 14)}</button>` },
    ],
  });
  table.onSelect = sel => { view.querySelector('[data-bulk]').disabled = !sel.size; };

  const apply = () => {
    const q = trLower(f.q);
    table.setRows((f.scope === 'all' ? all : scope).filter(s =>
      (!f.status || (s.mig_status || 'Planlanmadı') === f.status) &&
      (!f.wave || (f.wave === '-' ? !s.mig_wave : s.mig_wave === f.wave)) &&
      (!f.environment || s.environment === f.environment) && (!f.criticality || s.criticality === f.criticality) &&
      (!q || trLower(`${s.hostname} ${s.description} ${s.mig_owner} ${s.mig_notes} ${s.mig_target}`).includes(q))));
  };
  apply();
  const fl = view.querySelector('.filters');
  fl.addEventListener('change', e => { if (e.target.name) { f[e.target.name] = e.target.value; apply(); } });
  fl.querySelector('[name=q]').addEventListener('input', debounce(e => { f.q = e.target.value; apply(); }, 150));

  view.querySelector('#tbl').addEventListener('change', async e => {
    const sel = e.target.closest('[data-st]');
    if (!sel) return;
    const id = Number(sel.dataset.st);
    await api.put(`/api/servers/${id}`, { mig_status: sel.value });
    const s = all.find(x => x.id === id);
    s.mig_status = sel.value;
    toast(`${s.hostname}: ${sel.value}`);
  });
  view.querySelector('#tbl').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]');
    if (b) migrationFormModal(all.find(x => x.id === Number(b.dataset.edit)), refresh);
  });
  view.querySelector('[data-bulk]').addEventListener('click', () => {
    const ids = [...table.selected];
    modal({
      title: `${ids.length} sunucuyu güncelle`,
      body: `<p class="small muted" style="margin-top:0">Yalnızca doldurduğunuz alanlar güncellenir.</p><form class="form-grid" id="bf">
        <label class="field">Durum<select name="mig_status">${options(meta.migStatuses, '', { empty: '— değiştirme —' })}</select></label>
        <label class="field">Dalga<input name="mig_wave" list="dl-w"><datalist id="dl-w">${meta.waves.map(w => `<option value="${esc(w)}">`).join('')}</datalist></label>
        <label class="field">Hedef tarih<input type="date" name="mig_target_date"></label>
        <label class="field">Sorumlu<input name="mig_owner" list="dl-o"><datalist id="dl-o">${meta.owners.map(w => `<option value="${esc(w)}">`).join('')}</datalist></label>
        <label class="field wide">Hedef policy / çözüm<input name="mig_target"></label></form>`,
      foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-ok>Uygula</button>',
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', async () => {
        const fields = Object.fromEntries(Object.entries(formData(el.querySelector('#bf'))).filter(([, v]) => v));
        if (!Object.keys(fields).length) return toast('En az bir alan doldurun', 'err');
        const r = await api.post('/api/servers/bulk', { ids, fields });
        toast(`${r.updated} sunucu güncellendi`);
        close(); await reloadMeta(); refresh();
      }),
    });
  });
}

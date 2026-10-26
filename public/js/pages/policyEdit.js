import { api, state } from '../lib/api.js';
import { esc, icon, options, toast, confirmDialog, modal, trLower, critBadge, relTime } from '../lib/ui.js';
import { catColor, bindTips } from '../lib/charts.js';
import {
  BACKUP_TYPES, FREQ_UNITS, DAYS_SHORT, DAYS_TR, CATEGORY_LABELS, describeSchedule, describeWhen, category, detectTape,
  runBitmap, hhmm, parseHHMM, hasCalendar, rpoText, serverRpoHours,
} from '../lib/schedule.js';
import { setCrumbs, navigate, reloadMeta, invalidateSearch } from '../app.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const ALL_WEEKS = [1, 2, 3, 4, 5];
const SYSTEM_SUGGESTIONS = ['NetBackup (Mevcut)', 'Yeni Sistem (Hedef)'];

const win = (d, s, e, ed) => ({ d, s: parseHHMM(s), e: parseHHMM(e), ed: ed ?? (parseHHMM(e) <= parseHHMM(s) ? (d + 1) % 7 : d) });
const cal = (days, weeks = ALL_WEEKS) => Object.fromEntries(days.map(d => [d, [...weeks]]));
const blank = () => ({ name: '', backup_type: 'Full Backup', tape: null, freq_every: null, freq_unit: null, calendar: {}, dates: [], excluded: [], windows: [], retention_level: 3 });
const nextYears = n => Array.from({ length: n }, (_, i) => `${new Date().getFullYear() + i + 1}-01-01`);

const TEMPLATES = [
  { id: 'vm-daily', label: 'VM günlük: haftalık Full + günlük Incr', make: () => [
    { ...blank(), name: 'Full', calendar: cal([5]), windows: [win(5, '22:00', '07:00')], retention_level: 4 },
    { ...blank(), name: 'Incr', backup_type: 'Differential Incremental Backup', calendar: cal([0, 1, 2, 3, 4, 6]), windows: [0, 1, 2, 3, 4, 6].map(d => win(d, '22:00', '07:00')), retention_level: 3 },
  ] },
  { id: 'daily-slp', label: 'Full (2. hafta hariç) + Incr + aylık kaset (SLP)', make: () => [
    { ...blank(), name: 'Full', calendar: cal([0], [1, 3, 4, 5]), windows: [win(0, '00:00', '08:59')], retention_level: 4 },
    { ...blank(), name: 'Incr', backup_type: 'Differential Incremental Backup', calendar: cal([1, 2, 3, 4, 5, 6]), windows: [1, 2, 3, 4, 5, 6].map(d => win(d, '00:00', '08:59')), retention_level: 3 },
    { ...blank(), name: 'SLP', tape: 'SLP', calendar: cal([0], [2]), windows: [win(0, '00:00', '08:59')], retention_level: 0 },
  ] },
  { id: 'weekly', label: 'Haftalık: ayda 1 Full + diğer haftalar Incr', make: () => [
    { ...blank(), name: 'Full', calendar: cal([5], [2]), windows: [win(5, '22:30', '07:00')], retention_level: 4 },
    { ...blank(), name: 'Incr', backup_type: 'Differential Incremental Backup', calendar: cal([5], [1, 3, 4, 5]), windows: [win(5, '22:30', '07:00')], retention_level: 3 },
  ] },
  { id: 'rman', label: 'Oracle RMAN: haftalık Full + günlük kümülatif', make: () => [
    { ...blank(), name: 'Auto', freq_every: 7, freq_unit: 'day', windows: [win(0, '04:00', '15:00')], retention_level: 10 },
    { ...blank(), name: 'Auto_Cum', backup_type: 'Cumulative Incremental Backup', freq_every: 1, freq_unit: 'day', windows: [1, 2, 3, 4, 5, 6].map(d => win(d, '06:00', '17:00')), retention_level: 10 },
    { ...blank(), name: 'App', backup_type: 'Application Backup', windows: [0, 1, 2, 3, 4, 5, 6].map(d => win(d, '00:00', '24:00', d)), retention_level: 10 },
  ] },
  { id: 'arch', label: 'Oracle ARCH: arşiv log (6 saatte bir)', make: () => [
    { ...blank(), name: 'Auto', freq_every: 6, freq_unit: 'hour', windows: [win(0, '00:00', '23:59', 6)], retention_level: 10 },
    { ...blank(), name: 'App', backup_type: 'Application Backup', windows: [0, 1, 2, 3, 4, 5, 6].map(d => win(d, '00:00', '24:00', d)), retention_level: 10 },
  ] },
  { id: 'mssql', label: 'MS-SQL: günlük Full + saatlik Log + aylık/yıllık kaset', make: () => [
    { ...blank(), name: 'Full', freq_every: 1, freq_unit: 'day', windows: [0, 1, 2, 3, 4, 5, 6].map(d => win(d, '00:00', '18:00')), retention_level: 3 },
    { ...blank(), name: 'LOG', backup_type: 'Transaction Log Backup', freq_every: 1, freq_unit: 'hour', windows: [win(0, '00:05', '23:57', 6)], retention_level: 3 },
    { ...blank(), name: 'SLP_Aylik', tape: 'SLP', calendar: cal([6], [5]), windows: [win(6, '06:00', '23:59')], retention_level: 0 },
    { ...blank(), name: 'SLP_Yillik', tape: 'SLP', dates: nextYears(5), windows: [win(0, '06:00', '17:00')], retention_level: 0 },
  ] },
  { id: 'slp', label: 'Tek schedule: aylık kaset (SLP)', make: () => [{ ...blank(), name: 'SLP', tape: 'SLP', calendar: cal([0], [2]), windows: [win(0, '00:00', '09:00')], retention_level: 0 }] },
  { id: 'blank', label: 'Boş schedule', make: () => [{ ...blank(), name: `Schedule` }] },
];

export async function render(view, { match, params }) {
  const isNew = match[1] === 'new';
  const meta = state.meta;
  const servers = await api.get('/api/servers');
  const serverMap = new Map(servers.map(s => [s.id, s]));
  let p;
  if (isNew) {
    p = { name: '', backup_system: state.system || 'NetBackup (Mevcut)', policy_type: '', active: 1, method: '', include_list: '', description: '', clients: [], schedules: [] };
    const sid = Number(params.get('server'));
    if (sid && serverMap.get(sid)) p.clients = [{ id: sid }];
  } else {
    p = await api.get(`/api/policies/${match[1]}`);
  }
  const selected = new Set(p.clients.map(c => c.id));
  const scheds = p.schedules.map(s => ({ ...s, calendar: s.calendar || {}, dates: s.dates || [], excluded: s.excluded || [], windows: s.windows || [] }));
  let dirty = false;
  const markDirty = () => { dirty = true; view.querySelector('[data-save]').classList.add('primary'); };
  setCrumbs([{ label: 'Politikalar', href: '#/policies' }, { label: isNew ? 'Yeni policy' : p.name }]);

  view.innerHTML = `<div class="page-head"><div><h1>${isNew ? 'Yeni policy' : esc(p.name)}</h1>
      <p>${isNew ? 'Policy bilgilerini, kapsadığı sunucuları ve schedule\'larını tanımlayın. Her schedule için Türkçe özet otomatik oluşur.' : `Son güncelleme: ${esc(p.updated_at || '—')}`}</p></div>
    <div class="actions">${isNew ? '' : `<button class="btn" data-clone>${icon('copy', 16)}Kopyala</button><button class="btn danger" data-delete>${icon('trash', 16)}Sil</button>`}
      <button class="btn primary" data-save>${icon('check', 16)}Kaydet</button></div></div>

  <div class="stack">
    <section class="card"><div class="card-head"><h3>Genel bilgiler</h3></div><div class="card-body">
      <form class="form-grid" id="pf">
        <label class="field" style="grid-column:span 2">Policy adı *<input name="name" value="${esc(p.name)}" placeholder="ör. AGO_sunucu01.domain.localFS"></label>
        <label class="field">Yedekleme sistemi<input name="backup_system" value="${esc(p.backup_system || '')}" list="dl-sys"><datalist id="dl-sys">${[...new Set([...SYSTEM_SUGGESTIONS, ...meta.systems])].map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field">Policy tipi<input name="policy_type" value="${esc(p.policy_type || '')}" list="dl-type" placeholder="Standard, VMware, Oracle…"><datalist id="dl-type">${meta.policyTypes.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field">Yöntem<input name="method" value="${esc(p.method || '')}" list="dl-method"><datalist id="dl-method">${meta.methods.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field">Durum<span class="check" style="min-height:34px"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Aktif (Active=yes)</span></label>
        <label class="field" style="grid-column:span 2">İçerik / include (her satıra bir yol)<textarea name="include_list" rows="3" placeholder="ALL_LOCAL_DRIVES">${esc(p.include_list || '')}</textarea></label>
        <label class="field" style="grid-column:span 2">Açıklama / not<textarea name="description" rows="3">${esc(p.description || '')}</textarea></label>
      </form></div></section>

    <section class="card"><div class="card-head"><div><h3>Sunucular (istemciler) <span class="badge blue" id="selcount"></span></h3><p>Envanterdeki sunuculardan seçin. Yeni sunucu için önce Envanter'e ekleyin.</p></div></div>
      <div class="card-body"><div class="client-picker">
        <div><div class="filters" style="margin-bottom:8px"><input type="search" id="cq" placeholder="Sunucu ara…" style="flex:1">
          <select id="cenv">${options(meta.environments, '', { empty: 'Tüm ortamlar' })}</select>
          <label class="check small"><input type="checkbox" id="cunc"> Sadece yedeksiz</label></div>
          <div class="client-list" id="avail"></div></div>
        <div><div class="row" style="margin-bottom:8px;min-height:34px"><strong>Seçili sunucular</strong><span class="spacer"></span><button class="btn sm ghost" id="clrsel">Tümünü kaldır</button></div>
          <div class="client-list" id="chosen"></div></div>
      </div></div></section>

    <section class="card"><div class="card-head"><div><h3>Schedule'lar</h3><p>Sıklık (takvim veya frekans), yedek penceresi, saklama süresi ve kasete çıkış.</p></div>
      <div class="actions"><select id="tpl">${options(TEMPLATES.map(t => ({ value: t.id, label: t.label })), '', { empty: '+ Şablondan / boş ekle…' })}</select></div></div>
      <div class="card-body"><div id="scheds"></div>
        <div class="grid g2 mt"><div><h3 class="mb">Aylık desen önizleme</h3><div id="pmonth"></div></div>
          <div><h3 class="mb">Özet</h3><div id="psum" class="small text-2"></div></div></div></div></section>

    ${isNew ? '' : `<section class="card"><div class="card-head"><h3>Değişiklik geçmişi</h3></div><div class="card-body"><ul class="list-plain">
      ${(p.audit || []).map(a => `<li><span class="small">${esc(a.summary)}</span> <span class="small muted">· ${relTime(a.ts)}</span></li>`).join('') || '<li class="muted">Kayıt yok</li>'}</ul></div></section>`}
  </div>`;
  bindTips(view);

  // ---------- İstemci seçici ----------
  const drawClients = () => {
    const q = trLower(view.querySelector('#cq').value);
    const env = view.querySelector('#cenv').value;
    const unc = view.querySelector('#cunc').checked;
    const avail = servers.filter(s => !selected.has(s.id) && (!env || s.environment === env) && (!unc || !s.covered) &&
      (!q || trLower(`${s.hostname} ${s.description} ${s.ip}`).includes(q)));
    view.querySelector('#avail').innerHTML = avail.slice(0, 300).map(s => `<label data-add="${s.id}"><span style="color:var(--accent)">${icon('plus', 15)}</span><div style="flex:1"><strong>${esc(s.hostname)}</strong> ${critBadge(s.criticality)}
      <div class="meta">${esc([s.environment, s.description].filter(Boolean).join(' · '))}${s.covered ? ` · ${s.active_count} aktif policy` : ' · yedeksiz'}</div></div></label>`).join('') +
      (avail.length > 300 ? `<div class="empty small">+${avail.length - 300} sunucu daha — aramayı daraltın</div>` : '') || '<div class="empty">Eşleşen sunucu yok</div>';
    const chosen = [...selected].map(id => serverMap.get(id)).filter(Boolean).sort((a, b) => a.hostname.localeCompare(b.hostname));
    view.querySelector('#chosen').innerHTML = chosen.map(s => `<label data-rm="${s.id}"><span style="color:var(--critical)">${icon('x', 15)}</span><div style="flex:1"><strong>${esc(s.hostname)}</strong>
      <div class="meta">${esc([s.environment, s.description].filter(Boolean).join(' · '))}</div></div></label>`).join('') || '<div class="empty">Henüz sunucu seçilmedi</div>';
    view.querySelector('#selcount').textContent = `${selected.size}`;
    drawSummary();
  };
  view.querySelector('#cq').addEventListener('input', drawClients);
  view.querySelector('#cenv').addEventListener('change', drawClients);
  view.querySelector('#cunc').addEventListener('change', drawClients);
  view.querySelector('#avail').addEventListener('click', e => { const l = e.target.closest('[data-add]'); if (l) { e.preventDefault(); selected.add(Number(l.dataset.add)); markDirty(); drawClients(); } });
  view.querySelector('#chosen').addEventListener('click', e => { const l = e.target.closest('[data-rm]'); if (l) { e.preventDefault(); selected.delete(Number(l.dataset.rm)); markDirty(); drawClients(); } });
  view.querySelector('#clrsel').addEventListener('click', () => { selected.clear(); markDirty(); drawClients(); });

  // ---------- Schedule editörü ----------
  const box = view.querySelector('#scheds');
  const mode = s => (s.backup_type === 'Application Backup' ? 'app' : s.freq_every ? 'freq' : 'calendar');

  function schedHTML(s, i) {
    const m = mode(s);
    const isEx = (d, w) => s.excluded.some(x => x.day === d && x.week === w);
    return `<div class="sched" data-i="${i}">
      <div class="sched-head">
        <span class="dot" style="background:${catColor(category(s))}"></span>
        <input data-f="name" value="${esc(s.name)}" placeholder="Schedule adı (ör. Full, Incr, SLP)" style="width:180px">
        <select data-f="backup_type">${options(BACKUP_TYPES.map(b => ({ value: b.value, label: b.label })), s.backup_type)}</select>
        <select data-f="tape" title="Kasete çıkış">${options([{ value: '', label: 'Disk (kaset yok)' }, { value: 'SLP', label: 'Kaset – SLP' }, { value: 'Vault', label: 'Vault' }], s.tape || '')}</select>
        <select data-f="retention_level" title="Saklama">${options(state.meta.levels.map(l => ({ value: l.level, label: `Saklama: ${l.label} (L${l.level})` })), s.retention_level)}</select>
        <span class="spacer"></span>
        <button class="icon-btn" data-up title="Yukarı">↑</button><button class="icon-btn" data-dup title="Çoğalt">${icon('copy', 15)}</button><button class="icon-btn" data-del title="Sil">${icon('trash', 15)}</button>
      </div>
      <div class="sched-body">
        <div class="sched-desc" data-desc>${esc(describeSchedule(s, state.meta.levels))}</div>
        ${m === 'app' ? '<div class="small muted">Uygulama tetikli schedule: takvim yerine aşağıdaki pencere içinde uygulama (ör. RMAN/SQL agent) tarafından tetiklenir.</div>' : `
        <div class="row"><span class="small muted">Sıklık türü</span><div class="seg" data-mode>
          <button data-m="calendar" class="${m === 'calendar' ? 'on' : ''}">Takvim (gün × ayın haftası)</button>
          <button data-m="freq" class="${m === 'freq' ? 'on' : ''}">Frekans (her N saat/gün)</button></div></div>
        ${m === 'calendar' ? `<div class="row" style="align-items:flex-start;gap:24px">
          <div><div class="wk-grid" data-grid><div></div>${ORDER.map(d => `<div class="h"><button data-col="${d}" style="border:0;background:none;color:inherit;cursor:pointer;height:auto">${DAYS_SHORT[d]}</button></div>`).join('')}
            ${ALL_WEEKS.map(w => `<div class="l"><button data-row="${w}" style="border:0;background:none;color:inherit;cursor:pointer;height:auto;padding:0">${w}. hafta</button></div>${ORDER.map(d => `<button data-cell="${d}-${w}" class="${(s.calendar[d] || []).includes(w) ? 'on' : isEx(d, w) ? 'ex' : ''}" title="${DAYS_TR[d]}, ayın ${w}. haftası">${(s.calendar[d] || []).includes(w) ? '✓' : isEx(d, w) ? '✕' : ''}</button>`).join('')}`).join('')}
          </div><div class="small muted mt">Tıkla: seç / kaldır · Shift+tık: hariç tut (Excluded) · gün/hafta başlığına tıkla: tüm kolon/satır</div></div>
          <div class="stack" style="gap:8px"><span class="small muted">Hızlı seçim</span>
            <div class="row" style="gap:6px"><button class="btn sm" data-q="all">Her gün</button><button class="btn sm" data-q="wd">Hafta içi</button><button class="btn sm" data-q="we">Hafta sonu</button><button class="btn sm" data-q="none">Temizle</button></div>
            <label class="field">Belirli tarihler (opsiyonel)<input data-f="dates" value="${esc(s.dates.join(', '))}" placeholder="YYYY-AA-GG, virgülle ayırın"></label></div></div>` : `
          <div class="row"><span>Her</span><input type="number" min="1" data-f="freq_every" value="${s.freq_every || 1}" style="width:80px">
            <select data-f="freq_unit">${options(FREQ_UNITS, s.freq_unit || 'day')}</select><span class="small muted">— pencere açık olduğu sürece bu aralıkla çalışır</span></div>`}`}
        <div>
          <div class="row mb" style="margin-bottom:8px"><strong class="small">Yedek penceresi</strong><span class="spacer"></span>
            <button class="btn sm" data-addwin>${icon('plus', 13)}Pencere</button><button class="btn sm" data-wincal ${m === 'calendar' && hasCalendar(s) ? '' : 'disabled'} title="Takvimde seçili günler için ilk pencereyi çoğalt">Seçili günlere uygula</button><button class="btn sm" data-winall>Tüm günlere uygula</button></div>
          ${s.windows.length ? s.windows.map((w, wi) => `<div class="win-row" data-wi="${wi}" style="margin-bottom:6px">
            <select data-w="d">${options(ORDER.map(d => ({ value: d, label: DAYS_TR[d] })), w.d)}</select>
            <input type="time" data-w="s" value="${hhmm(w.s)}">
            <input type="time" data-w="e" value="${w.e >= 1440 ? '23:59' : hhmm(w.e)}">
            <select data-w="ed">${options(ORDER.map(d => ({ value: d, label: `bitiş: ${DAYS_TR[d]}` })), w.ed)}</select>
            <button class="icon-btn" data-rmwin title="Kaldır">${icon('x', 14)}</button></div>`).join('') : '<div class="small muted">Pencere tanımlı değil.</div>'}
        </div>
      </div></div>`;
  }

  const drawScheds = () => {
    box.innerHTML = scheds.length ? scheds.map(schedHTML).join('') : '<div class="empty">Henüz schedule yok. Sağ üstten şablon seçerek hızlıca başlayabilirsiniz.</div>';
    drawSummary();
  };
  const redrawOne = i => {
    const el = box.querySelector(`.sched[data-i="${i}"]`);
    el.outerHTML = schedHTML(scheds[i], i);
    drawSummary();
  };
  const updateDesc = i => {
    box.querySelector(`.sched[data-i="${i}"] [data-desc]`).textContent = describeSchedule(scheds[i], state.meta.levels);
    drawSummary();
  };

  function drawSummary() {
    const fake = scheds.map(s => ({ ...s, category: category(s) }));
    const cells = Array.from({ length: 35 }, () => new Set());
    for (const s of fake) if (s.category !== 'app') runBitmap(s).forEach((v, i) => { if (v) cells[i].add(s.category); });
    const lab = { full: 'F', incr: 'I', log: 'L', tape: 'K' };
    let html = `<div class="month-matrix"><div></div>${ORDER.map(d => `<div class="mh">${DAYS_SHORT[d]}</div>`).join('')}`;
    for (let w = 0; w < 5; w++) {
      html += `<div class="ml">${w + 1}. hafta</div>`;
      for (const d of ORDER) html += `<div class="mc">${['full', 'incr', 'log', 'tape'].filter(k => cells[w * 7 + d].has(k)).map(k => `<span class="chip ${k}" title="${CATEGORY_LABELS[k]}">${lab[k]}</span>`).join('')}</div>`;
    }
    view.querySelector('#pmonth').innerHTML = html + '</div>';
    const rpo = serverRpoHours(fake);
    view.querySelector('#psum').innerHTML = `<ul class="list-plain">
      <li><strong>${selected.size}</strong> sunucu · <strong>${scheds.length}</strong> schedule</li>
      <li>Tahmini RPO: <strong>${rpoText(rpo)}</strong></li>
      <li>Kasete çıkış: <strong>${fake.some(s => s.tape === 'SLP') ? 'Evet' : 'Hayır'}</strong></li>
      ${fake.map(s => `<li><span class="dot" style="background:${catColor(s.category)}"></span> <strong>${esc(s.name || '(adsız)')}</strong> — ${esc(describeWhen(s))}</li>`).join('')}</ul>`;
  }

  box.addEventListener('input', e => {
    const card = e.target.closest('.sched');
    if (!card) return;
    const i = Number(card.dataset.i), s = scheds[i];
    markDirty();
    if (e.target.dataset.f === 'name') { s.name = e.target.value; if (s.tape === null || s.tape === undefined) s.tape = detectTape(s.name); updateDesc(i); }
    if (e.target.dataset.f === 'freq_every') { s.freq_every = Math.max(1, Number(e.target.value) || 1); updateDesc(i); }
    if (e.target.dataset.f === 'dates') { s.dates = e.target.value.split(/[,\s]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)); updateDesc(i); }
  });
  box.addEventListener('change', e => {
    const card = e.target.closest('.sched');
    if (!card) return;
    const i = Number(card.dataset.i), s = scheds[i];
    markDirty();
    const f = e.target.dataset.f;
    if (f === 'backup_type') { s.backup_type = e.target.value; if (s.backup_type === 'Application Backup') { s.freq_every = null; s.freq_unit = null; s.calendar = {}; } return redrawOne(i); }
    if (f === 'tape') { s.tape = e.target.value || null; return redrawOne(i); }
    if (f === 'retention_level') { s.retention_level = Number(e.target.value); return updateDesc(i); }
    if (f === 'freq_unit') { s.freq_unit = e.target.value; return updateDesc(i); }
    const wr = e.target.closest('[data-wi]');
    if (wr && e.target.dataset.w) {
      const w = s.windows[Number(wr.dataset.wi)];
      const k = e.target.dataset.w;
      if (k === 'd') { const delta = (w.ed - w.d + 7) % 7; w.d = Number(e.target.value); w.ed = (w.d + delta) % 7; return redrawOne(i); }
      if (k === 'ed') w.ed = Number(e.target.value);
      if (k === 's' || k === 'e') {
        w[k] = parseHHMM(e.target.value) ?? 0;
        if (k === 'e' && w.e === 23 * 60 + 59 && w.s === 0 && w.ed === w.d) w.e = 1440;
        // bitiş başlangıçtan önceyse ertesi güne taşı
        if (w.ed === w.d && w.e <= w.s) { w.ed = (w.d + 1) % 7; return redrawOne(i); }
        if ((w.d + 1) % 7 === w.ed && w.e > w.s) { w.ed = w.d; return redrawOne(i); }
      }
      updateDesc(i);
    }
  });
  box.addEventListener('click', async e => {
    const card = e.target.closest('.sched');
    if (!card) return;
    const i = Number(card.dataset.i), s = scheds[i];
    const t = e.target.closest('button');
    if (!t) return;
    e.preventDefault();
    markDirty();
    if (t.dataset.m) {
      if (t.dataset.m === 'freq') { s.freq_every = s.freq_every || 1; s.freq_unit = s.freq_unit || 'day'; s.calendar = {}; }
      else { s.freq_every = null; s.freq_unit = null; }
      return redrawOne(i);
    }
    if (t.dataset.cell) {
      const [d, w] = t.dataset.cell.split('-').map(Number);
      const on = (s.calendar[d] || []).includes(w);
      const exIdx = s.excluded.findIndex(x => x.day === d && x.week === w);
      if (e.shiftKey) {
        if (exIdx >= 0) s.excluded.splice(exIdx, 1); else { s.excluded.push({ day: d, week: w }); if (on) s.calendar[d] = s.calendar[d].filter(x => x !== w); }
      } else if (on) {
        s.calendar[d] = s.calendar[d].filter(x => x !== w);
      } else {
        (s.calendar[d] ||= []).push(w); s.calendar[d].sort();
        if (exIdx >= 0) s.excluded.splice(exIdx, 1);
      }
      return redrawOne(i);
    }
    if (t.dataset.col !== undefined) {
      const d = Number(t.dataset.col);
      s.calendar[d] = (s.calendar[d] || []).length === 5 ? [] : [...ALL_WEEKS];
      return redrawOne(i);
    }
    if (t.dataset.row) {
      const w = Number(t.dataset.row);
      const allOn = ORDER.every(d => (s.calendar[d] || []).includes(w));
      for (const d of ORDER) {
        const cur = new Set(s.calendar[d] || []);
        allOn ? cur.delete(w) : cur.add(w);
        s.calendar[d] = [...cur].sort();
      }
      return redrawOne(i);
    }
    if (t.dataset.q) {
      const days = { all: [0, 1, 2, 3, 4, 5, 6], wd: [1, 2, 3, 4, 5], we: [0, 6], none: [] }[t.dataset.q];
      s.calendar = cal(days);
      s.excluded = [];
      return redrawOne(i);
    }
    if (t.hasAttribute('data-addwin')) {
      const last = s.windows[s.windows.length - 1];
      s.windows.push(last ? { ...last, d: (last.d + 1) % 7, ed: (last.ed + 1) % 7 } : win(0, '22:00', '07:00'));
      return redrawOne(i);
    }
    if (t.hasAttribute('data-winall') || t.hasAttribute('data-wincal')) {
      const base = s.windows[0] || win(0, '22:00', '07:00');
      const delta = (base.ed - base.d + 7) % 7;
      const days = t.hasAttribute('data-winall') ? [0, 1, 2, 3, 4, 5, 6] : ORDER.filter(d => (s.calendar[d] || []).length);
      s.windows = days.map(d => ({ d, s: base.s, e: base.e, ed: (d + delta) % 7 }));
      return redrawOne(i);
    }
    if (t.hasAttribute('data-rmwin')) { s.windows.splice(Number(t.closest('[data-wi]').dataset.wi), 1); return redrawOne(i); }
    if (t.hasAttribute('data-del')) { if (await confirmDialog(`“${s.name || 'Schedule'}” silinsin mi?`, { ok: 'Sil', danger: true })) { scheds.splice(i, 1); drawScheds(); } return; }
    if (t.hasAttribute('data-dup')) { scheds.splice(i + 1, 0, structuredClone({ ...s, id: undefined, name: `${s.name}_kopya` })); return drawScheds(); }
    if (t.hasAttribute('data-up') && i > 0) { [scheds[i - 1], scheds[i]] = [scheds[i], scheds[i - 1]]; return drawScheds(); }
  });
  view.querySelector('#tpl').addEventListener('change', e => {
    const t = TEMPLATES.find(x => x.id === e.target.value);
    e.target.value = '';
    if (!t) return;
    scheds.push(...t.make());
    markDirty();
    drawScheds();
  });
  view.querySelector('#pf').addEventListener('input', markDirty);

  // ---------- Kaydet / kopyala / sil ----------
  const collect = () => {
    const f = view.querySelector('#pf');
    return {
      name: f.name.value.trim(), backup_system: f.backup_system.value.trim(), policy_type: f.policy_type.value.trim(), active: f.active.checked,
      method: f.method.value.trim(), include_list: f.include_list.value, description: f.description.value,
      client_ids: [...selected],
      schedules: scheds.map(s => ({ ...s, tape: s.tape || null, source_text: undefined })),
    };
  };
  view.querySelector('[data-save]').addEventListener('click', async () => {
    const body = collect();
    if (!body.name) return toast('Policy adı zorunludur', 'err');
    const unnamed = body.schedules.findIndex(s => !s.name.trim());
    if (unnamed >= 0) return toast(`${unnamed + 1}. schedule için ad girin`, 'err');
    const r = isNew ? await api.post('/api/policies', body) : await api.put(`/api/policies/${p.id}`, body);
    dirty = false;
    toast('Policy kaydedildi');
    invalidateSearch();
    await reloadMeta();
    navigate(`#/policy/${r.id}`);
  });
  view.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!await confirmDialog(`“${p.name}” policy'si silinsin mi? Sunucular envanterde kalır, yalnızca bu policy ile ilişkileri kaldırılır.`, { ok: 'Sil', danger: true })) return;
    await api.del(`/api/policies/${p.id}`);
    dirty = false;
    toast('Policy silindi');
    navigate('#/policies');
  });
  view.querySelector('[data-clone]')?.addEventListener('click', () => {
    modal({
      title: 'Policy kopyala',
      body: `<div class="form-grid"><label class="field wide">Yeni ad<input id="cn" value="${esc(p.name)} (kopya)"></label>
        <label class="field">Yedekleme sistemi<input id="cs" value="${esc(p.backup_system === 'NetBackup (Mevcut)' ? 'Yeni Sistem (Hedef)' : p.backup_system || '')}" list="dl-sys2"><datalist id="dl-sys2">${SYSTEM_SUGGESTIONS.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field" style="justify-content:flex-end"><span class="check"><input type="checkbox" id="cc" checked> Sunucuları da kopyala</span></label></div>
        <p class="small muted">İpucu: Taşıma projesinde mevcut policy'yi “Yeni Sistem (Hedef)” olarak kopyalayıp hedef politikayı burada tasarlayabilir, üst menüden sisteme göre filtreleyerek karşılaştırabilirsiniz.</p>`,
      foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-ok>Kopyala</button>',
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', async () => {
        const r = await api.post(`/api/policies/${p.id}/clone`, { name: el.querySelector('#cn').value, backup_system: el.querySelector('#cs').value, with_clients: el.querySelector('#cc').checked });
        close(); toast('Kopya oluşturuldu'); await reloadMeta(); navigate(`#/policy/${r.id}`);
      }),
    });
  });

  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  drawClients();
  drawScheds();
  view.querySelector('[data-save]').classList.toggle('primary', isNew);
  return { destroy: () => window.removeEventListener('beforeunload', beforeUnload) };
}

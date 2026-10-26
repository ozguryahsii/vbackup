// Küçük UI yardımcıları: kaçış, ikonlar, toast, modal, veri tablosu

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const fmtNum = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('tr-TR'));
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const trLower = s => String(s ?? '').toLocaleLowerCase('tr');

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  tape: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/><path d="M8 14.5h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
};
export function icon(name, size = 18) {
  return `<i data-icon="${name}" style="width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg></i>`;
}
export function hydrateIcons(root = document) {
  for (const el of $$('i[data-icon]:empty', root)) {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[el.dataset.icon] || ''}</svg>`;
  }
}

// Önem dereceleri — renk tek başına anlam taşımasın diye ikon + etiket ile
export const SEVERITY = {
  critical: { label: 'Kritik', cls: 'crit', icon: 'alert' },
  serious: { label: 'Yüksek', cls: 'serious', icon: 'alert' },
  warning: { label: 'Uyarı', cls: 'warn', icon: 'info' },
  info: { label: 'Bilgi', cls: 'blue', icon: 'info' },
};
export const sevBadge = s => `<span class="badge ${SEVERITY[s].cls}">${icon(SEVERITY[s].icon, 13)}${SEVERITY[s].label}</span>`;

export function coverageBadge(s) {
  if (s.covered) return `<span class="badge good">${icon('check', 12)}Var</span>`;
  if (s.passive_count) return `<span class="badge warn">Sadece pasif</span>`;
  return `<span class="badge crit">${icon('x', 12)}Yok</span>`;
}
export function tapeBadge(status) {
  if (status === 'EVET') return `<span class="badge blue">${icon('tape', 13)}Evet</span>`;
  if (status === 'HAYIR') return '<span class="badge">Hayır</span>';
  return `<span class="badge warn">Pasifte</span>`;
}
export function critBadge(c) {
  if (!c) return '<span class="muted">—</span>';
  const cls = c.startsWith('3') ? 'crit' : c.startsWith('2') ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(c)}</span>`;
}
const MIG_CLS = { 'Planlanmadı': '', 'Planlandı': 'blue', 'Devam ediyor': 'warn', 'Taşındı': 'good', 'Doğrulandı': 'good', 'Kapsam dışı': '' };
export const migBadge = s => `<span class="badge ${MIG_CLS[s] ?? ''}">${s === 'Doğrulandı' ? icon('check', 12) : ''}${esc(s || 'Planlanmadı')}</span>`;

// ---------- Toast ----------
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
}

// ---------- Modal ----------
export function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><span class="spacer"></span><button class="icon-btn" data-close aria-label="Kapat">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(back);
  const m = back.querySelector('.modal');
  onMount?.(m, close);
  m.querySelector('input, select, textarea')?.focus();
  return { el: m, close };
}

export function confirmDialog(message, { ok = 'Onayla', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const { close } = modal({
      title: 'Onay',
      body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Vazgeç</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onMount: (m, c) => m.querySelector('[data-ok]').addEventListener('click', () => { done = true; c(); resolve(true); }),
    });
    const obs = new MutationObserver(() => { if (!document.body.contains($('.modal-back'))) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($('#modal-root'), { childList: true });
    void close;
  });
}

// ---------- Veri tablosu ----------
// columns: [{ key, label, render?(row), sort?(row) => value, num?, cls?, width? }]
export class DataTable {
  constructor(el, { columns, rows = [], pageSize = 50, onRowClick, selectable = false, rowKey = 'id', emptyText = 'Kayıt yok', initialSort }) {
    Object.assign(this, { el, columns, rows, pageSize, onRowClick, selectable, rowKey, emptyText });
    this.page = 0;
    this.sort = initialSort || null;
    this.selected = new Set();
    this.el.addEventListener('click', e => this.onClick(e));
    this.render();
  }
  setRows(rows) { this.rows = rows; this.page = 0; this.render(); }
  sortedRows() {
    if (!this.sort) return this.rows;
    const col = this.columns.find(c => c.key === this.sort.key);
    const get = col?.sort || (r => r[this.sort.key]);
    const dir = this.sort.dir;
    return [...this.rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'tr', { numeric: true })) * dir;
    });
  }
  render() {
    const rows = this.sortedRows();
    const pages = Math.max(1, Math.ceil(rows.length / this.pageSize));
    this.page = Math.min(this.page, pages - 1);
    const slice = rows.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    this.visible = slice;
    const allSel = slice.length && slice.every(r => this.selected.has(r[this.rowKey]));
    const head = `<tr>${this.selectable ? `<th style="width:32px"><input type="checkbox" data-selall ${allSel ? 'checked' : ''} aria-label="Tümünü seç"></th>` : ''}${this.columns.map(c => {
      const arrow = this.sort?.key === c.key ? (this.sort.dir > 0 ? ' ↑' : ' ↓') : '';
      return `<th class="${c.sortable === false ? '' : 'sortable'} ${c.num ? 'num' : ''}" data-sort="${c.key}" ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label)}${arrow}</th>`;
    }).join('')}</tr>`;
    const body = slice.length ? slice.map((r, i) => `<tr class="${this.onRowClick ? 'click' : ''} ${this.selected.has(r[this.rowKey]) ? 'sel' : ''}" data-i="${i}">${this.selectable ? `<td><input type="checkbox" data-sel ${this.selected.has(r[this.rowKey]) ? 'checked' : ''}></td>` : ''}${this.columns.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${this.columns.length + (this.selectable ? 1 : 0)}"><div class="empty">${esc(this.emptyText)}</div></td></tr>`;
    this.el.innerHTML = `<div class="table-wrap"><table class="data"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="table-foot"><span>${fmtNum(rows.length)} kayıt${this.selectable && this.selected.size ? ` · <strong>${this.selected.size} seçili</strong>` : ''}</span><span class="spacer"></span>
      ${pages > 1 ? `<button class="btn sm" data-pg="-1" ${this.page === 0 ? 'disabled' : ''}>‹ Önceki</button><span>${this.page + 1} / ${pages}</span><button class="btn sm" data-pg="1" ${this.page >= pages - 1 ? 'disabled' : ''}>Sonraki ›</button>` : ''}</div>`;
    this.onRender?.();
  }
  onClick(e) {
    const th = e.target.closest('th[data-sort]');
    if (th && th.classList.contains('sortable')) {
      const key = th.dataset.sort;
      this.sort = this.sort?.key === key ? (this.sort.dir > 0 ? { key, dir: -1 } : null) : { key, dir: 1 };
      return this.render();
    }
    const pg = e.target.closest('[data-pg]');
    if (pg) { this.page += Number(pg.dataset.pg); return this.render(); }
    if (e.target.matches('[data-selall]')) {
      for (const r of this.visible) e.target.checked ? this.selected.add(r[this.rowKey]) : this.selected.delete(r[this.rowKey]);
      this.render(); this.onSelect?.(this.selected);
      return;
    }
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const row = this.visible[Number(tr.dataset.i)];
    if (e.target.matches('[data-sel]')) {
      e.target.checked ? this.selected.add(row[this.rowKey]) : this.selected.delete(row[this.rowKey]);
      this.render(); this.onSelect?.(this.selected);
      return;
    }
    if (e.target.closest('a, button, input, select')) return;
    this.onRowClick?.(row, e);
  }
}

export function options(list, selected, { empty } = {}) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    list.map(o => {
      const v = typeof o === 'object' ? o.value : o;
      const l = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');
}

export function formData(form) {
  const o = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value;
  }
  return o;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function relTime(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} gün önce`;
  return d.toLocaleDateString('tr-TR');
}

// Dosya seçtirip ham içerik olarak yükler
export function pickFile(accept = '.xlsx') {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

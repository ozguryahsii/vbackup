import { api, state, loadMeta } from './lib/api.js';
import { $, $$, esc, hydrateIcons, icon, debounce, trLower } from './lib/ui.js';
import { destroyCharts, hideTip } from './lib/charts.js';
import { resetDrillCache } from './lib/drill.js';
import { setLang, getLang, translateText, translateDom, observeDom, missing } from './lib/i18n.js';

const routes = [
  { re: /^\/?$/, name: 'dashboard', title: 'Gösterge Paneli', load: () => import('./pages/dashboard.js') },
  { re: /^\/stats(?:\/(\w+))?$/, name: 'stats', title: 'İstatistikler', load: () => import('./pages/stats.js') },
  { re: /^\/calendar$/, name: 'calendar', title: 'Yedek Takvimi', load: () => import('./pages/calendar.js') },
  { re: /^\/inventory$/, name: 'inventory', title: 'Envanter', load: () => import('./pages/inventory.js') },
  { re: /^\/server\/(\d+)$/, name: 'inventory', title: 'Sunucu', load: () => import('./pages/server.js') },
  { re: /^\/policies$/, name: 'policies', title: 'Politikalar', load: () => import('./pages/policies.js') },
  { re: /^\/policy\/(new|\d+)$/, name: 'policies', title: 'Policy', load: () => import('./pages/policyEdit.js') },
  { re: /^\/migration$/, name: 'migration', title: 'Taşıma Takibi', load: () => import('./pages/migration.js') },
  { re: /^\/risks$/, name: 'risks', title: 'Uyum & Riskler', load: () => import('./pages/risks.js') },
  { re: /^\/reports(?:\/([\w-]+))?$/, name: 'reports', title: 'Raporlar', load: () => import('./pages/reports.js') },
  { re: /^\/settings$/, name: 'settings', title: 'Ayarlar', load: () => import('./pages/settings.js') },
];

export function setCrumbs(parts) {
  $('#crumbs').innerHTML = parts.map((p, i) => (p.href && i < parts.length - 1 ? `<a href="${p.href}">${esc(p.label)}</a>` : `<span>${esc(p.label)}</span>`)).join('<span>/</span>');
  document.title = `${translateText(parts[parts.length - 1].label)} · vbackup`;
}

let current = null;
let navToken = 0;
async function router() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  // Her geçişte boş bir kapsayıcı: önceki sayfanın olay dinleyicileri birikmesin
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  destroyCharts();
  hideTip();
  resetDrillCache();
  current?.destroy?.();
  current = null;
  $('#sidebar').classList.remove('open');

  if (state.meta?.empty && path !== '/settings') {
    const m = await import('./pages/setup.js');
    setCrumbs([{ label: 'İlk kurulum' }]);
    m.render(view);
    return;
  }

  const route = routes.find(r => r.re.test(path)) || routes[0];
  const match = path.match(route.re) || [];
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === route.name));
  setCrumbs([{ label: route.title }]);
  const token = ++navToken;
  view.innerHTML = '<div class="empty">Yükleniyor…</div>';
  try {
    const mod = await route.load();
    if (token !== navToken) return;
    view.innerHTML = '';
    current = (await mod.render(view, { match, params })) || null;
    hydrateIcons(view);
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card card-pad"><h2>Sayfa yüklenemedi</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

export function navigate(hash) {
  if (location.hash === hash) router(); else location.hash = hash;
}
export const refresh = () => router();

// ---------- Tema ----------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#theme-btn').innerHTML = icon(dark ? 'sun' : 'moon');
}
function initTheme() {
  let t = null;
  try { t = localStorage.getItem('vb.theme'); } catch { /* yok */ }
  applyTheme(t);
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    try { localStorage.setItem('vb.theme', next); } catch { /* yok */ }
    applyTheme(next);
    router(); // grafikleri yeni renklerle çiz
  });
}

// ---------- Global arama ----------
let searchIndex = null;
async function initSearch() {
  const inp = $('#global-search');
  const box = $('#search-results');
  let sel = 0;
  const run = debounce(async () => {
    const q = trLower(inp.value.trim());
    if (q.length < 2) { box.hidden = true; return; }
    if (!searchIndex) {
      const [servers, policies] = await Promise.all([api.get('/api/servers'), api.get('/api/policies')]);
      searchIndex = [
        ...servers.map(s => ({ k: 'Sunucu', label: s.hostname, sub: s.description || '', href: `#/server/${s.id}`, t: trLower(`${s.hostname} ${s.description} ${s.ip}`) })),
        ...policies.map(p => ({ k: 'Policy', label: p.name, sub: p.policy_type || '', href: `#/policy/${p.id}`, t: trLower(p.name) })),
      ];
      setTimeout(() => { searchIndex = null; }, 60000);
    }
    const hits = searchIndex.filter(x => x.t.includes(q)).slice(0, 12);
    sel = 0;
    box.innerHTML = hits.length ? hits.map((h, i) => `<a href="${h.href}" class="${i === 0 ? 'sel' : ''}"><div data-notr>${esc(h.label)}</div><div class="k">${h.k}${h.sub ? ` · <span data-notr>${esc(h.sub)}</span>` : ''}</div></a>`).join('') : '<div class="empty">Sonuç yok</div>';
    box.hidden = false;
  }, 150);
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', e => {
    const links = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % Math.max(1, links.length);
      links.forEach((a, i) => a.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter' && links[sel]) {
      location.hash = links[sel].getAttribute('href');
      box.hidden = true; inp.value = ''; inp.blur();
    } else if (e.key === 'Escape') { box.hidden = true; inp.blur(); }
  });
  box.addEventListener('click', () => { box.hidden = true; inp.value = ''; });
  document.addEventListener('click', e => { if (!e.target.closest('.global-search')) box.hidden = true; });
  document.addEventListener('keydown', e => {
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !e.target.closest('input, textarea, select'))) { e.preventDefault(); inp.focus(); }
  });
}
export function invalidateSearch() { searchIndex = null; }

export async function reloadMeta() {
  await loadMeta();
  const sel = $('#system-filter');
  sel.innerHTML = '<option value="">Tüm sistemler</option>' + state.meta.systems.map(s => `<option ${s === state.system ? 'selected' : ''}>${esc(s)}</option>`).join('');
  if (state.system && !state.meta.systems.includes(state.system)) { state.system = ''; sel.value = ''; }
  $('#brand-sub').textContent = state.meta.companyName || 'Yedekleme Politikası';
  $('#sidebar-foot').innerHTML = state.meta.importedAt ? `Son içe aktarım:<br>${new Date(state.meta.importedAt).toLocaleString('tr-TR')}` : 'Henüz veri yok';
  if (!state.meta.empty) {
    api.get('/api/findings', { quiet: true }).then(f => {
      const n = f.filter(x => x.severity === 'critical').reduce((a, x) => a + x.count, 0);
      const b = $('#risk-badge');
      b.hidden = !n; b.textContent = n;
    }).catch(() => {});
  }
}

function initLang() {
  let saved = 'tr';
  try { saved = localStorage.getItem('vb.lang') || 'tr'; } catch { /* yok */ }
  setLang(saved);
  document.documentElement.lang = getLang();
  $$('#lang-btn b').forEach(b => b.classList.toggle('on', b.textContent.toLowerCase() === getLang()));
  $('#lang-btn').title = getLang() === 'en' ? 'Türkçe’ye geç' : 'Switch to English';
  $('#lang-btn').addEventListener('click', () => {
    try { localStorage.setItem('vb.lang', getLang() === 'en' ? 'tr' : 'en'); } catch { /* yok */ }
    location.reload(); // tüm ekran, grafikler ve sunucudan gelen metinler yeni dille yeniden çizilir
  });
  if (getLang() === 'en') {
    translateDom(document.body);
    observeDom([document.body]);
  }
}

async function boot() {
  initLang();
  hydrateIcons();
  initTheme();
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#system-filter').addEventListener('change', e => {
    state.system = e.target.value;
    try { localStorage.setItem('vb.system', state.system); } catch { /* yok */ }
    router();
  });
  await reloadMeta();
  initSearch();
  window.addEventListener('hashchange', router);
  // Başka bir sekmede/pencerede değişiklik yapılıp geri dönülünce salt-okunur ekranları tazele
  const READ_ONLY = /^#\/(stats|calendar|risks|reports)?(\/|\?|$)/;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || document.querySelector('.modal-back')) return;
    if (READ_ONLY.test(location.hash || '#/')) router();
  });
  router();
}
window.__i18nMissing = missing;
boot();

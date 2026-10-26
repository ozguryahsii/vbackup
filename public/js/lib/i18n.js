// Dil desteği (TR / EN). Sunucu ve tarayıcı ortak kullanır.
// Uygulama metinleri Türkçe yazılır; Türkçe metnin kendisi sözlük anahtarıdır.
// EN seçiliyken translateText() sözlükteki karşılığı, yoksa kalıp (pattern) çevirisini döndürür.
import { EN, PATTERNS } from './dictionary.js';

export const LANGS = ['tr', 'en'];
let current = 'tr';
export const getLang = () => current;
export function setLang(l) { current = LANGS.includes(l) ? l : 'tr'; }

// Çevirisi bulunamayan metinler (geliştirme ve test için toplanır)
export const missing = new Set();

const SKIP = [
  /^[\s\d.,:;%+\-–—/()|·→×≤≥<>#'"!?…]*$/, // yalnızca sayı / noktalama
  /^[A-Z0-9_.\-/:() ]+$/, // HOSTNAME, PROD, SLP, IP, dosya yolu gibi büyük harfli değerler
  /^[\w.-]+@[\w.-]+$/, // e-posta
  /^\/[\w/.*-]*$/, // dizin yolu
  /^\d{4}-\d{2}-\d{2}/, // tarih
];

export function translateText(text, lang = current) {
  if (lang !== 'en' || text === null || text === undefined) return text;
  const s = String(text);
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const core = m[2];
  if (!core) return s;
  const out = translateCore(core);
  return m[1] + out + m[3];
}

// Zaten çevrilmiş (İngilizce) metinler tekrar çevrilmeye çalışılmasın
const produced = new Set(Object.values(EN));
function done(out) { produced.add(out); return out; }

function translateCore(core) {
  if (Object.prototype.hasOwnProperty.call(EN, core)) return done(EN[core]);
  if (produced.has(core)) return core;
  for (const [re, to] of PATTERNS) {
    const mm = re.exec(core);
    if (mm) return done(typeof to === 'function' ? to(mm, translateCore) : core.replace(re, to));
  }
  // "A · B" gibi birleşik metinleri parça parça çevir
  for (const sep of ['\n', ' · ', ' | ', ' / ']) {
    if (core.includes(sep)) return done(core.split(sep).map(x => (x.trim() ? translateText(x, 'en') : x)).join(sep));
  }
  // Baştaki/sondaki ayraç ve noktalama: "· yedeksiz", "TERMİNAL ·", "[Oracle – …", "Kasete çıkış:"
  const pm = /^([·•[(]\s*)?([\s\S]*?)(\s*[·:,;)\]])?$/.exec(core);
  if (pm && (pm[1] || pm[3]) && pm[2]) {
    const inner = translateCore(pm[2]);
    if (inner !== pm[2]) return done((pm[1] || '') + inner + (pm[3] || ''));
  }
  // Virgülle ayrılmış değer listesi (ör. yöntemler): her parça çevrilebiliyorsa çevir
  if (core.includes(', ')) {
    const parts = core.split(', ');
    const tr = parts.map(x => (Object.prototype.hasOwnProperty.call(EN, x) ? EN[x] : null));
    if (tr.every(x => x !== null)) return done(tr.join(', '));
  }
  if (!SKIP.some(re => re.test(core)) && /[a-zçğıöşü]/i.test(core)) missing.add(core);
  return core;
}

// Kısa kullanım: t('Kaydet'), t('{n} sunucu', { n: 5 })
export function t(text, vars, lang = current) {
  let s = lang === 'en' ? (EN[text] ?? translateCore(text)) : text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

// ---------- Tarayıcı: DOM çevirisi ----------
// data-notr taşıyan öğelerin içi (kullanıcı verisi: açıklama, not, policy adı…) çevrilmez.
const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip'];
const ORIGINAL = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function skipNode(el) {
  return !el || el.closest?.('[data-notr], script, style, textarea, code, .mono');
}

export function translateDom(root) {
  if (typeof document === 'undefined' || current !== 'en' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (skipNode(n.parentElement)) continue;
    const v = n.nodeValue;
    if (!v || !v.trim()) continue;
    const tr = translateText(v, 'en');
    if (tr !== v) { ORIGINAL?.set(n, v); n.nodeValue = tr; }
  }
  const els = root.nodeType === 1 ? [root, ...root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','))] : [];
  for (const el of els) {
    if (skipNode(el)) continue;
    for (const a of ATTRS) {
      const v = el.getAttribute?.(a);
      if (!v) continue;
      const tr = translateText(v, 'en');
      if (tr !== v) el.setAttribute(a, tr);
    }
  }
}

let observer = null;
export function observeDom(roots) {
  if (typeof MutationObserver === 'undefined') return;
  observer?.disconnect();
  observer = new MutationObserver(muts => {
    if (current !== 'en') return;
    for (const m of muts) {
      if (m.type === 'characterData') {
        const p = m.target.parentElement;
        if (!skipNode(p)) {
          const tr = translateText(m.target.nodeValue, 'en');
          if (tr !== m.target.nodeValue) m.target.nodeValue = tr;
        }
      } else if (m.type === 'attributes') {
        if (!skipNode(m.target)) {
          const v = m.target.getAttribute(m.attributeName);
          const tr = v && translateText(v, 'en');
          if (tr && tr !== v) m.target.setAttribute(m.attributeName, tr);
        }
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) translateDom(n);
          else if (n.nodeType === 3 && !skipNode(n.parentElement)) {
            const tr = translateText(n.nodeValue, 'en');
            if (tr !== n.nodeValue) n.nodeValue = tr;
          }
        }
      }
    }
  });
  for (const r of roots) observer.observe(r, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

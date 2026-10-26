// Ortak (sunucu + tarayıcı) schedule yardımcıları.
// Bir schedule şu yapıdadır:
// {
//   name, backup_type, tape: 'SLP' | 'Vault' | null,
//   freq_every, freq_unit: 'minute'|'hour'|'day'|null,
//   calendar: { "0": [1,2,3,4,5], ... }   // gün (0=Pazar) -> ayın kaçıncı haftaları
//   dates: ['2026-04-12'], excluded: [{ day: 0, week: 1 }],
//   windows: [{ d: 0, s: 1320, ed: 1, e: 420 }],  // dakika cinsinden başlangıç/bitiş
//   retention_level
// }

import { getLang, translateText } from './i18n.js';

export const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const DAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export const BACKUP_TYPES = [
  { value: 'Full Backup', label: 'Full', kind: 'full' },
  { value: 'Differential Incremental Backup', label: 'Diferansiyel Incremental', kind: 'incr' },
  { value: 'Cumulative Incremental Backup', label: 'Kümülatif Incremental', kind: 'incr' },
  { value: 'Transaction Log Backup', label: 'Transaction Log', kind: 'log' },
  { value: 'Automatic Backup', label: 'Automatic Backup', kind: 'full' },
  { value: 'Application Backup', label: 'Application Backup (uygulama tetikli pencere)', kind: 'app' },
];

export const FREQ_UNITS = [
  { value: 'minute', label: 'dakika' },
  { value: 'hour', label: 'saat' },
  { value: 'day', label: 'gün' },
];

export function typeLabel(t, lang = getLang()) {
  return translateText(BACKUP_TYPES.find(b => b.value === t)?.label || t || '—', lang);
}

// Raporlama kategorisi: full | incr | log | app | tape
export function category(s) {
  if (s.tape) return 'tape';
  return BACKUP_TYPES.find(b => b.value === s.backup_type)?.kind || 'full';
}

export const CATEGORY_LABELS = {
  full: 'Full', incr: 'Incremental', log: 'Transaction Log', app: 'Uygulama tetikli', tape: 'Kaset (SLP)',
};

export function detectTape(name) {
  if (!name) return null;
  if (/slp/i.test(name)) return 'SLP';
  if (/vault/i.test(name)) return 'Vault';
  return null;
}

// ---------- Zaman yardımcıları ----------
export const pad = n => String(n).padStart(2, '0');
export const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export function parseHHMM(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}

// ---------- NetBackup döküm metinlerini ayrıştırma ----------
export function parseFrequency(text) {
  const m = /every\s+(\d+)\s+(minute|hour|day|week)s?/i.exec(text || '');
  if (!m) return { freq_every: null, freq_unit: null };
  let every = Number(m[1]);
  let unit = m[2].toLowerCase();
  if (unit === 'week') { every *= 7; unit = 'day'; }
  return { freq_every: every, freq_unit: unit };
}

export function parseIncluded(text) {
  const calendar = {};
  const dates = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    let m = /^(\w+),\s*Week\s*(\d)/i.exec(line);
    if (m) {
      const d = DAYS_EN.indexOf(m[1].toLowerCase());
      if (d >= 0) {
        (calendar[d] ||= []).push(Number(m[2]));
      }
      continue;
    }
    m = /SPECIFIC DATE\s*\d+\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(line);
    if (m) dates.push(`${m[3]}-${m[1]}-${m[2]}`); // döküm MM/DD/YYYY
  }
  for (const d of Object.keys(calendar)) calendar[d] = [...new Set(calendar[d])].sort();
  return { calendar, dates };
}

export function parseExcluded(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = /^(\w+),\s*Week\s*(\d)/i.exec(raw.trim());
    if (m) {
      const d = DAYS_EN.indexOf(m[1].toLowerCase());
      if (d >= 0) out.push({ day: d, week: Number(m[2]) });
    }
  }
  return out;
}

export function parseWindows(text) {
  const out = [];
  const re = /(\w+)\s+(\d{2}):(\d{2})(?::\d{2})?\s*-->\s*(\w+)\s+(\d{2}):(\d{2})/;
  for (const raw of String(text || '').split('\n')) {
    const m = re.exec(raw);
    if (!m) continue;
    const d = DAYS_EN.indexOf(m[1].toLowerCase());
    const ed = DAYS_EN.indexOf(m[4].toLowerCase());
    if (d < 0 || ed < 0) continue;
    out.push({ d, s: Number(m[2]) * 60 + Number(m[3]), ed, e: Number(m[5]) * 60 + Number(m[6]) });
  }
  return out;
}

// ---------- Açıklamalar (TR / EN) ----------
// Tüm açıklama fonksiyonları son parametre olarak dil alır; verilmezse arayüzün seçili dili kullanılır.
const DAYS_EN_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dayName = (d, lang = getLang()) => (lang === 'en' ? DAYS_EN_FULL : DAYS_TR)[d];
export const dayShort = (d, lang = getLang()) => (lang === 'en' ? DAYS_EN_SHORT : DAYS_SHORT)[d];

function joinList(items, lang) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + (lang === 'en' ? ' and ' : ' ve ') + items[items.length - 1];
}

function weeksText(weeks, lang) {
  const missing = [1, 2, 3, 4, 5].filter(w => !weeks.includes(w));
  if (lang === 'en') {
    if (weeks.length === 1) return `week ${weeks[0]} of the month`;
    if (missing.length === 1) return `weeks ${weeks.join(', ')} of the month (not week ${missing[0]})`;
    return `weeks ${joinList(weeks.map(String), lang)} of the month`;
  }
  if (weeks.length === 1) return `Ayın ${weeks[0]}. haftası`;
  if (missing.length === 1) return `Ayın ${weeks.map(w => `${w}.`).join(', ')} haftaları (${missing[0]}. hafta hariç)`;
  return `Ayın ${joinList(weeks.map(w => `${w}.`), lang)} haftaları`;
}

function daysText(days, lang) {
  if (days.length === 7) return lang === 'en' ? 'every day' : 'her gün';
  if (days.length === 6) {
    const missing = [0, 1, 2, 3, 4, 5, 6].find(d => !days.includes(d));
    return lang === 'en' ? `every day except ${DAYS_EN_FULL[missing]}` : `${DAYS_TR[missing]} hariç her gün`;
  }
  return joinList(days.map(d => dayName(d, lang)), lang);
}

export function hasCalendar(s) {
  return s.calendar && Object.values(s.calendar).some(w => w && w.length);
}

const cap = x => x.charAt(0).toUpperCase() + x.slice(1);

export function describeWhen(s, lang = getLang()) {
  const en = lang === 'en';
  if (s.backup_type === 'Application Backup') return en ? 'Triggered by the application (no calendar)' : 'Uygulama tarafından tetiklenir (takvim yok)';
  const parts = [];
  if (s.freq_every && s.freq_unit) {
    const n = s.freq_every;
    let t;
    if (en) {
      if (s.freq_unit === 'minute') t = `Every ${n} minutes`;
      else if (s.freq_unit === 'hour') t = n === 1 ? 'Every hour' : `Every ${n} hours`;
      else t = n === 1 ? 'Every day' : n === 7 ? 'Once a week' : n === 30 ? 'Once a month' : `Every ${n} days`;
      parts.push(t);
    } else {
      if (s.freq_unit === 'minute') t = `${n} dakikada bir`;
      else if (s.freq_unit === 'hour') t = n === 1 ? 'Saatte bir' : `${n} saatte bir`;
      else t = n === 1 ? 'Her gün' : n === 7 ? 'Haftada bir' : n === 30 ? 'Ayda bir' : `${n} günde bir`;
      parts.push(`${t} (every ${n} ${s.freq_unit}${n > 1 ? 's' : ''})`);
    }
  }
  if (hasCalendar(s)) {
    // aynı hafta kümesine sahip günleri grupla
    const groups = new Map();
    for (let d = 0; d < 7; d++) {
      const w = (s.calendar[d] || []).slice().sort();
      if (!w.length) continue;
      const key = w.join(',');
      if (!groups.has(key)) groups.set(key, { weeks: w, days: [] });
      groups.get(key).days.push(d);
    }
    const texts = [];
    for (const g of groups.values()) {
      const dt = daysText(g.days, lang);
      if (g.weeks.length === 5) {
        if (en) texts.push(dt.startsWith('every') ? cap(dt) : `Every ${dt}`);
        else texts.push(dt === 'her gün' ? 'Her gün' : dt.includes('hariç') ? cap(dt) : `Her ${dt}`);
      } else {
        texts.push(en ? `${cap(dt)} in ${weeksText(g.weeks, lang)}` : `${weeksText(g.weeks, lang)} ${dt}`);
      }
    }
    parts.push(texts.join('; '));
  }
  if (s.dates && s.dates.length) {
    const ds = s.dates.slice().sort();
    const jan1 = ds.every(d => d.endsWith('-01-01'));
    const range = `${ds[0].slice(0, 4)}–${ds[ds.length - 1].slice(0, 4)}`;
    if (jan1 && ds.length > 1) {
      parts.push(en ? `Every year on 1 January (${range} dates defined)` : `Her yıl 1 Ocak (${range} tarihleri tanımlı)`);
    } else {
      parts.push((parts.length ? '; ' : '') + (en ? 'Specific date(s): ' + ds.join(', ') : 'Belirli tarih(ler): ' + ds.map(formatDateTR).join(', ')));
    }
  }
  if (!parts.length) parts.push(en ? 'No days of week entered' : 'Takvimde gün seçilmemiş (No days of week entered)');
  let txt = parts.join(' ').replace(' ; ', '; ');
  if (s.excluded && s.excluded.length) {
    txt += en
      ? ' — EXCEPT: ' + s.excluded.map(x => `${DAYS_EN_FULL[x.day]} in week ${x.week} of the month`).join(', ')
      : ' — HARİÇ: ' + s.excluded.map(x => `ayın ${x.week}. haftası ${DAYS_TR[x.day]}`).join(', ');
  }
  return txt;
}

export function formatDateTR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function formatDateLong(date, lang = getLang()) {
  if (lang === 'en') return `${DAYS_EN_FULL[date.getDay()]}, ${date.getDate()} ${MONTHS_EN[date.getMonth()]} ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS_TR[date.getMonth()]} ${date.getFullYear()} ${DAYS_TR[date.getDay()]}`;
}
export const monthName = (m, lang = getLang()) => (lang === 'en' ? MONTHS_EN : MONTHS_TR)[m];

function windowSpan(w, lang) {
  if (w.ed === w.d) return `${hhmm(w.s)}–${hhmm(w.e)}`;
  if ((w.d + 1) % 7 === w.ed) return `${hhmm(w.s)} → ${lang === 'en' ? 'next day' : 'ertesi gün'} ${hhmm(w.e)}`;
  return null;
}

function dayGroupText(days, lang) {
  if (days.length === 7) return lang === 'en' ? 'every day' : 'her gün';
  if (days.length === 6) return daysText(days, lang);
  // Pazartesi'den başlayan sıralama ile ardışık aralıkları "Pzt–Cum" şeklinde yaz
  const order = d => (d + 6) % 7;
  const sorted = days.slice().sort((a, b) => order(a) - order(b));
  const runs = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && order(d) === order(last[last.length - 1]) + 1) last.push(d); else runs.push([d]);
  }
  const sh = d => dayShort(d, lang);
  return runs.map(r => (r.length >= 3 ? `${sh(r[0])}–${sh(r[r.length - 1])}` : r.map(sh).join(', '))).join(', ');
}

export function describeWindows(windows, lang = getLang()) {
  if (!windows || !windows.length) return '—';
  const spans = windows.map(w => windowSpan(w, lang));
  if (spans.some(x => x === null)) {
    return windows.map(w => `${dayShort(w.d, lang)} ${hhmm(w.s)} → ${dayShort(w.ed, lang)} ${hhmm(w.e)}` +
      (windows.length === 1 ? (lang === 'en' ? ' (continuous)' : ' (kesintisiz)') : '')).join(' | ');
  }
  const groups = new Map();
  windows.forEach((w, i) => {
    if (!groups.has(spans[i])) groups.set(spans[i], []);
    groups.get(spans[i]).push(w.d);
  });
  return [...groups].map(([span, days]) => `${dayGroupText([...new Set(days)], lang)} ${span}`).join(' | ');
}

export function retentionText(level, levels, lang = getLang()) {
  if (level === null || level === undefined || level === '') return '—';
  const l = levels?.find(x => Number(x.level) === Number(level));
  return l ? `${translateText(l.label, lang)} (level ${level})` : `level ${level}`;
}

export function describeSchedule(s, levels, lang = getLang()) {
  const en = lang === 'en';
  const win = s.windows?.length ? ` | ${en ? 'Window' : 'Pencere'}: ${describeWindows(s.windows, lang)}` : '';
  return `${typeLabel(s.backup_type, lang)}: ${describeWhen(s, lang)}${win} | ${en ? 'Retention' : 'Saklama'}: ${retentionText(s.retention_level, levels, lang)}`;
}

// ---------- Takvim hesapları ----------
// NetBackup "Week N": ayın N. haftası = o haftagününün aydaki N. tekrarı (1-7 → 1, 8-14 → 2 ...).
export function weekOfMonth(date) {
  return Math.ceil(date.getDate() / 7);
}

export function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Verilen tarihte schedule'ın çalışıp çalışmadığı (pencere başlangıcı o gün mü)
export function runsOn(s, date) {
  if (s.backup_type === 'Application Backup') return false;
  const d = date.getDay();
  const wk = weekOfMonth(date);
  if (s.excluded?.some(x => x.day === d && x.week === wk)) return false;
  if (s.dates?.includes(isoDate(date))) return true;
  if (hasCalendar(s)) return (s.calendar[d] || []).includes(wk);
  if (s.freq_every && s.freq_unit) {
    const hasWin = !s.windows?.length || s.windows.some(w => w.d === d || spansDay(w, d));
    if (!hasWin) return false;
    if (s.freq_unit !== 'day' || s.freq_every === 1) return true;
    // N günlük frekans: pencerenin açıldığı günlerde çalıştığı varsayılır
    return !s.windows?.length ? d === 0 : s.windows.some(w => w.d === d);
  }
  return false;
}

function spansDay(w, d) {
  // pencere birden çok güne yayılıyorsa (ör. Paz 00:05 → Cmt 23:57) aradaki günler de kapsanır
  const len = ((w.ed - w.d + 7) % 7);
  if (len <= 1) return false;
  for (let i = 1; i <= len; i++) if ((w.d + i) % 7 === d) return true;
  return false;
}

// Gün içinde o tarihte açılan pencere(ler)
export function windowsOn(s, date) {
  const d = date.getDay();
  return (s.windows || []).filter(w => w.d === d || spansDay(w, d));
}

// 35 günlük (5 hafta x 7 gün) çalışma haritası
export function runBitmap(s) {
  const bm = new Array(35).fill(false);
  if (s.backup_type === 'Application Backup') return bm;
  if (hasCalendar(s)) {
    for (let d = 0; d < 7; d++) for (const w of s.calendar[d] || []) bm[(w - 1) * 7 + d] = true;
  } else if (s.freq_every && s.freq_unit) {
    const days = s.windows?.length ? [...new Set(s.windows.flatMap(w => {
      const out = [w.d];
      for (let d = 0; d < 7; d++) if (spansDay(w, d)) out.push(d);
      return out;
    }))] : [0, 1, 2, 3, 4, 5, 6];
    for (let wk = 0; wk < 5; wk++) for (const d of days) bm[wk * 7 + d] = true;
  }
  for (const x of s.excluded || []) bm[(x.week - 1) * 7 + x.day] = false;
  return bm;
}

// Ardışık iki yedek arasındaki en uzun süre (saat) — tahmini RPO
export function maxGapHours(bitmap) {
  const idx = bitmap.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  if (idx.length === 1) return 35 * 24; // ayda ~1
  let gap = 0;
  for (let i = 0; i < idx.length; i++) {
    const next = i === idx.length - 1 ? idx[0] + 35 : idx[i + 1];
    gap = Math.max(gap, next - idx[i]);
  }
  return gap * 24;
}

export function scheduleIntervalHours(s) {
  if (s.backup_type === 'Application Backup') return null;
  if (s.freq_every && s.freq_unit) {
    const base = s.freq_unit === 'minute' ? s.freq_every / 60 : s.freq_unit === 'hour' ? s.freq_every : s.freq_every * 24;
    if (s.freq_unit === 'day') return Math.max(base, maxGapHours(runBitmap(s)) || base);
    return base;
  }
  if (hasCalendar(s)) return maxGapHours(runBitmap(s));
  if (s.dates?.length) return 24 * 365;
  return null;
}

// Disk yedekleri (kaset ve app hariç) birleşiminden sunucu RPO tahmini
export function serverRpoHours(schedules) {
  const disk = schedules.filter(s => !s.tape && s.backup_type !== 'Application Backup');
  if (!disk.length) return null;
  let best = Infinity;
  const union = new Array(35).fill(false);
  for (const s of disk) {
    if (s.freq_every && s.freq_unit && s.freq_unit !== 'day') {
      best = Math.min(best, scheduleIntervalHours(s));
    }
    runBitmap(s).forEach((v, i) => { if (v) union[i] = true; });
  }
  const g = maxGapHours(union);
  if (g !== null) best = Math.min(best, g);
  return best === Infinity ? null : best;
}

export function rpoBucket(h) {
  if (h === null || h === undefined) return 'Yedek yok';
  if (h <= 1) return '≤ 1 saat';
  if (h <= 6) return '≤ 6 saat';
  if (h <= 24) return 'Günlük';
  if (h <= 168) return 'Haftalık';
  return 'Aylık+';
}
export const RPO_BUCKETS = ['≤ 1 saat', '≤ 6 saat', 'Günlük', 'Haftalık', 'Aylık+', 'Yedek yok'];

export function rpoText(h, lang = getLang()) {
  if (h === null || h === undefined) return '—';
  const en = lang === 'en';
  if (h < 1) return `${Math.round(h * 60)} ${en ? 'min' : 'dk'}`;
  if (h < 24) return `${h} ${en ? (h === 1 ? 'hour' : 'hours') : 'saat'}`;
  const d = h % 24 === 0 && h < 24 * 60 ? h / 24 : Math.round(h / 24);
  return `${d} ${en ? (d === 1 ? 'day' : 'days') : 'gün'}`;
}

// Haftalık pencere doluluğu için: pencereyi haftanın dakika aralıklarına çevirir
export function windowRanges(w) {
  const start = w.d * 1440 + w.s;
  let end = w.ed * 1440 + w.e;
  if (end <= start) end += 7 * 1440;
  return [start, end];
}

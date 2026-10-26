import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateText } from '../public/js/lib/i18n.js';
import { describeSchedule } from '../public/js/lib/schedule.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

test('sözlükte tekrarlanan anahtar yok', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/lib/dictionary.js'), 'utf8');
  const body = src.slice(src.indexOf('export const EN = {'), src.indexOf('export const PATTERNS'));
  const keys = [...body.matchAll(/(?:^|[{,]\s*)(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)].map(m => m[2]);
  const seen = new Set();
  const dup = keys.filter(k => (seen.has(k) ? true : (seen.add(k), false)));
  assert.deepEqual(dup, []);
});

// Arayüz kaynaklarındaki düz Türkçe metinler (HTML/şablon parçası olmayanlar) sözlükte karşılık bulmalı
test('arayüzdeki Türkçe metinlerin İngilizce karşılığı var', () => {
  const dirs = ['public/js/pages', 'public/js/lib'];
  const files = dirs.flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js') && !/dictionary|i18n|schedule/.test(f)).map(f => path.join(ROOT, d, f)));
  const missing = new Set();
  // dil adları kendi dilinde gösterilir; tırnak içeren şablon parçaları metin değildir
  const allow = s => s === 'Türkçe' || s.includes('`') || /^(deki|larla|lerde|lerden|si |sinden)\b/.test(s) || s.startsWith('npm ');
  const check = s => {
    const t = s.trim();
    if (!t || !TR_CHARS.test(t) || allow(t) || /[<>{}$=]|\bvar\(|\\n/.test(t)) return;
    if (translateText(t, 'en') === t) missing.add(t);
  };
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/'((?:\\.|[^'\\\n])*)'/g)) check(m[1].replace(/\\'/g, "'"));
    // şablonlarda etiketler arasındaki düz metinler
    for (const m of src.matchAll(/>([^<>`$]{2,})</g)) check(m[1].replace(/\\'/g, "'"));
  }
  assert.deepEqual([...missing].sort(), []);
});

test('schedule açıklaması İngilizce üretilir', () => {
  const s = { backup_type: 'Full Backup', calendar: { 0: [1, 3, 4, 5] }, windows: [{ d: 0, s: 0, ed: 0, e: 539 }], retention_level: 4 };
  assert.equal(describeSchedule(s, [{ level: 4, label: '2 ay', days: 62 }], 'en'),
    'Full: Sunday in weeks 1, 3, 4, 5 of the month (not week 2) | Window: Sun 00:00–08:59 | Retention: 2 months (level 4)');
});

test('kalıplı metinler çevrilir', () => {
  assert.equal(translateText('5 sunucu silindi · yedek: x.db', 'en'), '5 servers deleted · backup: x.db');
  assert.equal(translateText("Değerlendirilen 446 sunucunun %66'i", 'en'), '66% of 446 evaluated servers');
  assert.equal(translateText('Oracle – Arşiv log yedeği (ARCH), Oracle – RMAN veritabanı yedeği', 'en'), 'Oracle – Archive log backup (ARCH), Oracle – RMAN database backup');
  assert.equal(translateText('Kaydet', 'tr'), 'Kaydet');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIncluded, parseWindows, parseFrequency, describeSchedule, runsOn, serverRpoHours, weekOfMonth,
} from '../public/js/lib/schedule.js';

const levels = [{ level: 3, label: '1 ay', days: 31 }, { level: 4, label: '2 ay', days: 62 }];

test('NetBackup takvim ve pencere metinleri ayrıştırılır', () => {
  const { calendar, dates } = parseIncluded('Sunday, Week 1\nSunday, Week 3\nSPECIFIC DATE 0 - 04/12/2026');
  assert.deepEqual(calendar, { 0: [1, 3] });
  assert.deepEqual(dates, ['2026-04-12']);
  assert.deepEqual(parseWindows('Friday     22:00:00  -->  Saturday   07:00:00'), [{ d: 5, s: 1320, ed: 6, e: 420 }]);
  assert.deepEqual(parseFrequency('every 3 hours'), { freq_every: 3, freq_unit: 'hour' });
});

test('Türkçe açıklama Excel ile aynı biçimde üretilir', () => {
  const s = {
    backup_type: 'Full Backup', calendar: { 0: [1, 3, 4, 5] }, dates: [], excluded: [],
    windows: parseWindows('Sunday     00:00:00  -->  Sunday     08:59:59'), retention_level: 4,
  };
  assert.equal(describeSchedule(s, levels), 'Full: Ayın 1., 3., 4., 5. haftaları (2. hafta hariç) Pazar | Pencere: Paz 00:00–08:59 | Saklama: 2 ay (level 4)');
});

test('ayın haftası ve çalışma günü hesabı', () => {
  assert.equal(weekOfMonth(new Date(2026, 9, 11)), 2); // 11 Ekim 2026 → 2. Pazar
  const slp = { backup_type: 'Full Backup', calendar: { 0: [2] }, windows: [] };
  assert.equal(runsOn(slp, new Date(2026, 9, 11)), true);
  assert.equal(runsOn(slp, new Date(2026, 9, 4)), false);
});

test('RPO: haftalık Full + günlük Incr = 1 gün, saatlik log = 1 saat', () => {
  const full = { backup_type: 'Full Backup', calendar: { 5: [1, 2, 3, 4, 5] }, windows: [] };
  const incr = { backup_type: 'Differential Incremental Backup', calendar: { 0: [1, 2, 3, 4, 5], 1: [1, 2, 3, 4, 5], 2: [1, 2, 3, 4, 5], 3: [1, 2, 3, 4, 5], 4: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5] }, windows: [] };
  assert.equal(serverRpoHours([full]), 168);
  assert.equal(serverRpoHours([full, incr]), 24);
  assert.equal(serverRpoHours([full, { backup_type: 'Transaction Log Backup', freq_every: 1, freq_unit: 'hour', windows: [] }]), 1);
});

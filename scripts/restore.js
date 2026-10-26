// Veritabanını bir yedekten ya da eski bir uygulama klasöründen geri yükler.
// Kullanım (uygulama DURDURULMUŞKEN):
//   npm run restore -- ~/Library/Application\ Support/vbackup/backups/vbackup-2026-10-26.db
//   npm run restore -- ~/eski/vbackup          (eski sürümün data/vbackup.db dosyasını alır)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, BACKUP_DIR } from '../server/paths.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Kullanım: npm run restore -- <yedek.db | eski vbackup klasörü>');
  process.exit(1);
}
let src = path.resolve(arg.replace(/^~(?=\/)/, process.env.HOME || '~'));
if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
  const candidates = [path.join(src, 'data', 'vbackup.db'), path.join(src, 'vbackup.db')];
  src = candidates.find(f => fs.existsSync(f));
  if (!src) {
    console.error(`Klasörde vbackup.db bulunamadı: ${candidates.join(' veya ')}`);
    process.exit(1);
  }
}
if (!fs.existsSync(src)) {
  console.error(`Dosya bulunamadı: ${src}`);
  process.exit(1);
}
if (path.resolve(src) === DB_PATH) {
  console.error('Kaynak, zaten kullanılan veritabanı dosyası.');
  process.exit(1);
}

// Uygulama çalışıyorsa dur: açık bir veritabanının üzerine yazmak veri kaybına yol açar
const port = process.env.PORT || 3000;
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/meta`, { signal: AbortSignal.timeout(1500) });
  if (r.ok) {
    console.error(`Uygulama şu anda çalışıyor (port ${port}). Önce durdurun (Terminal'de Ctrl+C ya da ./scripts/macos-autostart.sh uninstall), sonra tekrar deneyin.`);
    process.exit(1);
  }
} catch { /* çalışmıyor */ }

// Kaynağı doğrula
let servers;
try {
  const check = new DatabaseSync(src, { readOnly: true });
  servers = check.prepare('SELECT COUNT(*) c FROM servers').get().c;
  check.close();
} catch (e) {
  console.error(`Geçerli bir vbackup veritabanı değil: ${src}\n${e.message}`);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
if (fs.existsSync(DB_PATH)) {
  const keep = path.join(BACKUP_DIR, `vbackup-geri-yukleme-oncesi-${stamp}.db`);
  const cur = new DatabaseSync(DB_PATH);
  cur.exec(`VACUUM INTO '${keep.replace(/'/g, "''")}'`);
  cur.close();
  console.log(`Mevcut veritabanının kopyası alındı: ${keep}`);
}

const tmp = `${DB_PATH}.yeni`;
fs.rmSync(tmp, { force: true });
const s = new DatabaseSync(src);
s.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
s.close();
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(f, { force: true });
fs.renameSync(tmp, DB_PATH);
console.log(`Geri yüklendi (${servers} sunucu): ${src} → ${DB_PATH}`);
console.log('Uygulamayı yeniden başlatabilirsiniz: npm start');

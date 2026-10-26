// Kullanım: npm run seed -- [excel-dosyası]
// Dosya verilmezse veri klasöründeki seed/ (ya da uygulama klasöründeki data/seed/) altındaki ilk .xlsx kullanılır.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, LEGACY_DATA_DIR } from '../server/db.js';
import { importPolicyWorkbook } from '../server/importer.js';

let file = process.argv[2];
if (!file) {
  const dirs = [path.join(DATA_DIR, 'seed'), path.join(LEGACY_DATA_DIR, 'seed')];
  const dir = dirs.find(d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.xlsx'))) || dirs[0];
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.xlsx')) : [];
  if (!found.length) {
    console.error(`Excel dosyası bulunamadı. Dosyayı ${dir} klasörüne koyun ya da yolunu verin: npm run seed -- dosya.xlsx`);
    process.exit(1);
  }
  file = path.join(dir, found[0]);
}
console.log(`İçe aktarılıyor: ${file}`);
const stats = await importPolicyWorkbook(fs.readFileSync(file));
console.log(JSON.stringify(stats, null, 2));

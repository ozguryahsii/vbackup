// Veri konumları. Veri uygulama klasörünün DIŞINDA tutulur: uygulama silinse, yeniden clone'lansa
// ya da güncellense de veri kalır.
// macOS: ~/Library/Application Support/vbackup · diğer: ~/.vbackup · VBACKUP_DATA_DIR ile değiştirilebilir.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'vbackup');
  return path.join(os.homedir(), '.vbackup');
}

export const DATA_DIR = path.resolve(process.env.VBACKUP_DATA_DIR || defaultDataDir());
export const DB_PATH = path.join(DATA_DIR, 'vbackup.db');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
// Eski sürümlerde veri uygulama klasöründeki data/ altındaydı
export const LEGACY_DATA_DIR = path.join(ROOT, 'data');

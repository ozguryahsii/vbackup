import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.VBACKUP_DATA_DIR || path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'vbackup.db');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT, ip TEXT, environment TEXT, platform TEXT,
  vcpu INTEGER, ram_gb REAL, disk_gb REAL,
  status TEXT, description TEXT, criticality TEXT, os TEXT,
  location TEXT, owner_team TEXT, inventory_key TEXT,
  source TEXT DEFAULT 'manual',          -- envanter | policy | manual
  notes TEXT,
  mig_wave TEXT, mig_status TEXT DEFAULT 'Planlanmadı', mig_target_date TEXT,
  mig_owner TEXT, mig_target TEXT, mig_first_backup TEXT, mig_restore_test TEXT, mig_notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  backup_system TEXT DEFAULT 'NetBackup (Mevcut)',
  policy_type TEXT, active INTEGER DEFAULT 1,
  method TEXT, include_list TEXT, description TEXT,
  source_row INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS policy_clients (
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  client_name TEXT,
  PRIMARY KEY (policy_id, server_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  backup_type TEXT NOT NULL,
  tape TEXT,
  freq_every INTEGER, freq_unit TEXT,
  calendar_json TEXT, dates_json TEXT, excluded_json TEXT, windows_json TEXT,
  retention_level INTEGER,
  source_text TEXT,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS retention_levels (
  level INTEGER PRIMARY KEY, label TEXT NOT NULL, days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT DEFAULT (datetime('now','localtime')),
  entity TEXT, entity_id INTEGER, action TEXT, summary TEXT
);

CREATE INDEX IF NOT EXISTS ix_pc_server ON policy_clients(server_id);
CREATE INDEX IF NOT EXISTS ix_sched_policy ON schedules(policy_id);
CREATE INDEX IF NOT EXISTS ix_exc_server ON exceptions(server_id);
`);

const DEFAULT_LEVELS = [
  [0, '1 hafta', 7], [1, '2 hafta', 14], [2, '3 hafta', 21], [3, '1 ay', 31], [4, '2 ay', 62],
  [5, '3 ay', 92], [6, '6 ay', 183], [7, '9 ay', 274], [8, '1 yıl', 365], [9, 'Süresiz', 36500],
  [10, '5 hafta', 35],
];
if (!db.prepare('SELECT COUNT(*) c FROM retention_levels').get().c) {
  const ins = db.prepare('INSERT INTO retention_levels(level,label,days) VALUES (?,?,?)');
  for (const l of DEFAULT_LEVELS) ins.run(...l);
}

export const MIG_STATUSES = ['Planlanmadı', 'Planlandı', 'Devam ediyor', 'Taşındı', 'Doğrulandı', 'Kapsam dışı'];

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(entity, entityId, action, summary) {
  db.prepare('INSERT INTO audit_log(entity, entity_id, action, summary) VALUES (?,?,?,?)')
    .run(entity, entityId ?? null, action, summary);
}

export function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// Günlük otomatik yedek: data/backups/vbackup-YYYY-MM-DD.db (son 14 gün tutulur)
export function dailyBackup() {
  if (!db.prepare('SELECT COUNT(*) c FROM servers').get().c) return null;
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `vbackup-${day}.db`);
  if (!fs.existsSync(file)) {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }
  const files = fs.readdirSync(BACKUP_DIR).filter(f => /^vbackup-.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return file;
}

export function snapshot(label) {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `vbackup-${label}-${ts}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

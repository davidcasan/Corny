import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Cada migração leva o banco da versão (índice) para a versão (índice + 1).
// O número da versão fica em PRAGMA user_version.
const MIGRATIONS = [
  // v1: schema original do projeto
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS celebrities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    wins INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    winner_id INTEGER NOT NULL,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (winner_id) REFERENCES celebrities(id)
  );
  `,
  // v2: sessões no servidor, partidas validadas e exclusão lógica
  `
  ALTER TABLE celebrities ADD COLUMN created_at TEXT;
  ALTER TABLE celebrities ADD COLUMN deleted_at TEXT;
  ALTER TABLE game_history ADD COLUMN game_id INTEGER;

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    celebrity_ids TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );

  CREATE INDEX idx_celebrities_wins ON celebrities(wins DESC) WHERE deleted_at IS NULL;
  CREATE INDEX idx_history_user ON game_history(user_id, played_at DESC);
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  `,
  // v3: imagens guardadas no servidor e enquadramento (ponto em % da imagem + zoom)
  `
  ALTER TABLE celebrities ADD COLUMN image_base TEXT;
  ALTER TABLE celebrities ADD COLUMN image_widths TEXT;
  ALTER TABLE celebrities ADD COLUMN image_width INTEGER;
  ALTER TABLE celebrities ADD COLUMN image_height INTEGER;
  ALTER TABLE celebrities ADD COLUMN image_status TEXT;
  ALTER TABLE celebrities ADD COLUMN image_error TEXT;
  ALTER TABLE celebrities ADD COLUMN focal_x REAL;
  ALTER TABLE celebrities ADD COLUMN focal_y REAL;
  ALTER TABLE celebrities ADD COLUMN focal_zoom REAL;
  `
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(dbPath) {
  backupBeforeMigrating(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function backupBeforeMigrating(dbPath) {
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) return;

  const probe = new DatabaseSync(dbPath, { readOnly: true });
  const { user_version: version } = probe.prepare('PRAGMA user_version').get();
  const hasTables = probe.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n > 0;
  probe.close();

  if (hasTables && version < SCHEMA_VERSION) {
    const backupPath = `${dbPath}.bak-v${version}`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(dbPath, backupPath);
      console.log(`💾 Backup do banco antes da migração: ${backupPath}`);
    }
  }
}

function migrate(db) {
  let { user_version: version } = db.prepare('PRAGMA user_version').get();

  while (version < SCHEMA_VERSION) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração para v${version + 1}: ${err.message}`);
    }
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

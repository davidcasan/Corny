import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Cada migração leva o banco da versão (índice) para a versão (índice + 1): um bloco de SQL
// ou uma função que recebe o banco (para quando precisa de lógica).
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
  `,
  // v4: um nome de jogador por pessoa, sem diferenciar maiúsculas ("david" e "David" eram duas contas)
  mergeCaseDuplicateUsers
];

// Junta as contas cujo nome só difere em maiúsculas/minúsculas. Fica a com mais letras
// maiúsculas (empate: a mais antiga); a conta "admin" principal sempre fica. As partidas
// das outras passam para ela, e o banco passa a recusar nomes repetidos nesse sentido.
function mergeCaseDuplicateUsers(db) {
  const groups = db.prepare(`
    SELECT lower(username) AS key FROM users GROUP BY lower(username) HAVING COUNT(*) > 1
  `).all();
  const membersOf = db.prepare('SELECT id, username, is_admin FROM users WHERE lower(username) = ? ORDER BY id');
  const uppercaseCount = name => (name.match(/\p{Lu}/gu) || []).length;

  for (const { key } of groups) {
    const members = membersOf.all(key);
    const keep = members.find(m => m.username === 'admin') ??
      [...members].sort((a, b) => uppercaseCount(b.username) - uppercaseCount(a.username) || a.id - b.id)[0];

    for (const other of members.filter(m => m.id !== keep.id)) {
      db.prepare('UPDATE game_history SET user_id = ? WHERE user_id = ?').run(keep.id, other.id);
      db.prepare('UPDATE games SET user_id = ? WHERE user_id = ?').run(keep.id, other.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(other.id);
      if (other.is_admin) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(keep.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(other.id);
      console.log(`👥 Conta "${other.username}" juntada em "${keep.username}"`);
    }
  }

  db.exec('CREATE UNIQUE INDEX idx_users_username_nocase ON users(username COLLATE NOCASE)');
}

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
      const migration = MIGRATIONS[version];
      if (typeof migration === 'function') migration(db);
      else db.exec(migration);
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

import express from 'express';
import { hashPassword, isLegacyPassword, readSessionToken, requireAdmin } from '../auth.js';
import { presentImage } from '../images.js';
import { cleanText } from '../util/text.js';
import { parseId } from '../util/validate.js';

const MAX_USERNAME_LENGTH = 30;
const MAX_PASSWORD_LENGTH = 200;
const HISTORY_LIMIT = 500;
// Conta criada pelo servidor (ensureAdminUser em auth.js): renomear criaria outra "admin" no próximo início
const MAIN_ADMIN = 'admin';

// Gestão de jogadores pelo admin: listar, criar, editar nome/senha/permissão e ver partidas.
// As senhas ficam só como hash: o admin não vê a senha atual, só define uma nova.
export function adminUserRoutes(db) {
  const router = express.Router();
  router.use(requireAdmin);

  const listUsers = db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.password,
      COUNT(gh.id) AS games, MAX(gh.played_at) AS last_played
    FROM users u
    LEFT JOIN game_history gh ON gh.user_id = u.id
    GROUP BY u.id
    ORDER BY u.username COLLATE NOCASE
  `);
  const findUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const findByName = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE');
  const insertUser = db.prepare('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)');
  const updateName = db.prepare('UPDATE users SET username = ? WHERE id = ?');
  const updatePassword = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  const updateAdmin = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?');
  const dropOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?');
  const history = db.prepare(`
    SELECT gh.id AS history_id, gh.played_at, c.*
    FROM game_history gh
    JOIN celebrities c ON c.id = gh.winner_id
    WHERE gh.user_id = ?
    ORDER BY gh.played_at DESC, gh.id DESC
    LIMIT ?
  `);
  const countHistory = db.prepare('SELECT COUNT(*) AS n FROM game_history WHERE user_id = ?');

  const present = row => ({
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin === 1,
    games: row.games ?? 0,
    lastPlayed: row.last_played ?? null,
    // Senha da v1 em texto puro: vira hash no próximo login da pessoa ou se o admin definir outra
    legacyPassword: isLegacyPassword(row.password)
  });

  function readUsername(value) {
    const username = cleanText(value, MAX_USERNAME_LENGTH + 1);
    if (!username) return { error: 'Nome é obrigatório' };
    if (username.length > MAX_USERNAME_LENGTH) return { error: `Nome com até ${MAX_USERNAME_LENGTH} caracteres` };
    return { username };
  }

  function readPassword(value) {
    const password = typeof value === 'string' ? value : '';
    if (!password) return { error: 'Senha é obrigatória' };
    if (password.length > MAX_PASSWORD_LENGTH) return { error: 'Senha longa demais' };
    return { password };
  }

  router.get('/', (req, res) => {
    res.json({ success: true, users: listUsers.all().map(present) });
  });

  router.post('/', (req, res) => {
    const { username, error: nameError } = readUsername(req.body?.username);
    if (nameError) return res.status(400).json({ success: false, message: nameError });
    const { password, error: passwordError } = readPassword(req.body?.password);
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });

    const taken = findByName.get(username);
    if (taken) return res.status(409).json({ success: false, message: `Já existe o jogador "${taken.username}"` });

    const id = Number(insertUser.run(username, hashPassword(password), req.body?.isAdmin ? 1 : 0).lastInsertRowid);
    res.json({ success: true, user: present({ id, username, is_admin: req.body?.isAdmin ? 1 : 0, password: 'scrypt$' }) });
  });

  // Edita só o que vier no corpo: username, password (vazio = mantém) e/ou isAdmin
  router.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const user = id && findUser.get(id);
    if (!user) return res.status(404).json({ success: false, message: 'Jogador não encontrado' });

    const body = req.body ?? {};
    let username = user.username;
    if (body.username !== undefined) {
      const parsed = readUsername(body.username);
      if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
      username = parsed.username;
      if (user.username === MAIN_ADMIN && username !== MAIN_ADMIN) {
        return res.status(400).json({ success: false, message: 'A conta "admin" principal não pode ser renomeada' });
      }
      const taken = findByName.get(username);
      if (taken && taken.id !== id) {
        return res.status(409).json({ success: false, message: `Já existe o jogador "${taken.username}"` });
      }
    }

    let password = null;
    if (typeof body.password === 'string' && body.password !== '') {
      const parsed = readPassword(body.password);
      if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
      password = parsed.password;
    }

    const isAdmin = body.isAdmin === undefined ? user.is_admin === 1 : Boolean(body.isAdmin);
    if (!isAdmin && id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Você não pode tirar o seu próprio acesso de admin' });
    }
    if (!isAdmin && user.username === MAIN_ADMIN) {
      return res.status(400).json({ success: false, message: 'A conta "admin" principal continua sendo admin' });
    }

    db.exec('BEGIN');
    try {
      if (username !== user.username) updateName.run(username, id);
      if (isAdmin !== (user.is_admin === 1)) updateAdmin.run(isAdmin ? 1 : 0, id);
      if (password) {
        updatePassword.run(hashPassword(password), id);
        // Senha nova derruba os outros logins dessa conta (mantém o do próprio admin, se for ele)
        dropOtherSessions.run(id, readSessionToken(req));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const note = password && username === MAIN_ADMIN && process.env.ADMIN_PASSWORD
      ? 'Atenção: ADMIN_PASSWORD está definido no .env e volta a valer quando o servidor reiniciar.'
      : null;
    const updated = listUsers.all().find(u => u.id === id);
    res.json({ success: true, user: present(updated), note });
  });

  router.get('/:id/games', (req, res) => {
    const id = parseId(req.params.id);
    const user = id && findUser.get(id);
    if (!user) return res.status(404).json({ success: false, message: 'Jogador não encontrado' });

    const games = history.all(id, HISTORY_LIMIT).map(row => ({
      id: row.history_id,
      played_at: row.played_at,
      celebrity_id: row.id,
      name: row.name,
      deleted: Boolean(row.deleted_at),
      ...presentImage(row)
    }));
    res.json({ success: true, username: user.username, total: countHistory.get(id).n, games });
  });

  return router;
}

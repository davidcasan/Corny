import express from 'express';
import {
  clearSessionCookie, clientIp, createRateLimiter, createSession, deleteSession,
  hashPassword, isLegacyPassword, readSessionToken, setSessionCookie, verifyPassword
} from '../auth.js';
import { cleanText } from '../util/text.js';

const MAX_USERNAME_LENGTH = 30;
const MAX_PASSWORD_LENGTH = 200;

export function authRoutes(db) {
  const router = express.Router();
  const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 10 * 60 * 1000 });

  // "david" entra na conta "David": o nome não diferencia maiúsculas (e o banco não aceita os dois)
  const findUser = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
  const insertUser = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  const updatePassword = db.prepare('UPDATE users SET password = ? WHERE id = ?');

  // Login. Se o usuário não existe, a conta é criada na hora.
  router.post('/login', (req, res) => {
    const username = cleanText(req.body?.username, MAX_USERNAME_LENGTH + 1);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuário e senha são obrigatórios' });
    }
    if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ success: false, message: `Usuário com até ${MAX_USERNAME_LENGTH} caracteres` });
    }

    const limitKey = `${clientIp(req)}|${username.toLowerCase()}`;
    if (limiter.isBlocked(limitKey)) {
      return res.status(429).json({ success: false, message: 'Muitas tentativas. Aguarde alguns minutos.' });
    }

    const user = findUser.get(username);
    let userId;
    let newUser = false;

    if (user) {
      if (!verifyPassword(password, user.password)) {
        limiter.fail(limitKey);
        return res.status(401).json({ success: false, message: 'Senha incorreta' });
      }
      if (isLegacyPassword(user.password)) {
        updatePassword.run(hashPassword(password), user.id);
      }
      userId = user.id;
    } else {
      userId = Number(insertUser.run(username, hashPassword(password)).lastInsertRowid);
      newUser = true;
    }

    limiter.reset(limitKey);
    setSessionCookie(req, res, createSession(db, userId));

    res.json({
      success: true,
      user: { id: userId, username: user?.username ?? username, isAdmin: user?.is_admin === 1 },
      newUser
    });
  });

  router.post('/logout', (req, res) => {
    deleteSession(db, readSessionToken(req));
    clearSessionCookie(res);
    res.json({ success: true });
  });

  // Sem login responde user: null (e não 401), para a tela de login não registrar erro no console
  router.get('/me', (req, res) => {
    res.json({ success: true, user: req.user });
  });

  return router;
}

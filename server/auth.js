import crypto from 'node:crypto';

const SESSION_COOKIE = 'c2k_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180; // 180 dias: login persistente
const HASH_PREFIX = 'scrypt$';

// ==================== SENHAS ====================

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${HASH_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored.startsWith(HASH_PREFIX)) {
    // Senha legada em texto puro (v1). É convertida para hash no próximo login.
    return safeEqual(Buffer.from(password), Buffer.from(stored));
  }
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return safeEqual(actual, expected);
}

export function isLegacyPassword(stored) {
  return !stored.startsWith(HASH_PREFIX);
}

function safeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ensureAdminUser(db, configuredPassword) {
  const admin = db.prepare("SELECT id, password FROM users WHERE username = 'admin'").get();

  if (!admin) {
    db.prepare("INSERT INTO users (username, password, is_admin) VALUES ('admin', ?, 1)")
      .run(hashPassword(configuredPassword || 'admin'));
  } else if (configuredPassword && !verifyPassword(configuredPassword, admin.password)) {
    db.prepare('UPDATE users SET password = ?, is_admin = 1 WHERE id = ?').run(hashPassword(configuredPassword), admin.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
  }

  const current = db.prepare("SELECT password FROM users WHERE username = 'admin'").get();
  return { usingDefaultPassword: verifyPassword('admin', current.password) };
}

// ==================== SESSÕES ====================

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
  return token;
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_MAX_AGE_MS);
}

export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(req),
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// Pelo túnel da Cloudflare a conexão chega como HTTP local, mas o jogador está em HTTPS
function isHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

// ==================== MIDDLEWARES ====================

export function loadUser(db) {
  const findSession = db.prepare(`
    SELECT u.id, u.username, u.is_admin, s.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `);

  return (req, res, next) => {
    req.user = null;
    const token = readSessionToken(req);
    if (token) {
      const row = findSession.get(token);
      if (row && Date.now() - row.created_at < SESSION_MAX_AGE_MS) {
        req.user = { id: row.id, username: row.username, isAdmin: row.is_admin === 1 };
      }
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Faça login para continuar' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Faça login para continuar' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Acesso restrito ao admin' });
  }
  next();
}

// ==================== LIMITE DE TENTATIVAS ====================

// IP real do jogador. Atrás do cloudflared toda conexão vem de 127.0.0.1.
export function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return (isLocal && req.headers['cf-connecting-ip']) || remote;
}

export function createRateLimiter({ maxAttempts, windowMs }) {
  const attempts = new Map();

  return {
    isBlocked(key) {
      const entry = attempts.get(key);
      if (!entry) return false;
      if (Date.now() - entry.firstAt > windowMs) {
        attempts.delete(key);
        return false;
      }
      return entry.count >= maxAttempts;
    },
    fail(key) {
      const entry = attempts.get(key);
      if (!entry || Date.now() - entry.firstAt > windowMs) {
        attempts.set(key, { count: 1, firstAt: Date.now() });
      } else {
        entry.count++;
      }
    },
    reset(key) {
      attempts.delete(key);
    }
  };
}

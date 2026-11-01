import path from 'node:path';
import express from 'express';
import { loadUser } from './auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/game.js';
import { rankingRoutes } from './routes/ranking.js';

const PAGES = { '/': 'login.html', '/game': 'game.html', '/admin': 'admin.html', '/ranking': 'ranking.html' };

export function createApp({ db, publicDir, imagesDir, celebrityImages, searchImages }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(jsonExceptUploads);
  app.use(loadUser(db));

  app.use('/api', authRoutes(db));
  app.use('/api/admin', adminRoutes(db, { searchImages, celebrityImages }));
  app.use('/api/game', gameRoutes(db));
  app.use('/api/ranking', rankingRoutes(db));
  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'Rota não encontrada' });
  });

  // O nome do arquivo muda quando a imagem muda, então o cache pode ser eterno
  app.use('/images', express.static(imagesDir, { maxAge: '365d', immutable: true, fallthrough: false }));

  for (const [route, file] of Object.entries(PAGES)) {
    app.get(route, (req, res) => res.sendFile(path.join(publicDir, file)));
  }
  app.use(express.static(publicDir, { index: false }));

  app.use(errorHandler);
  return app;
}

// A rota de upload tem um parser próprio com limite maior (ver routes/admin.js)
const UPLOAD_ROUTES = new Set(['/api/admin/add-celebrity']);
const defaultJson = express.json();

function jsonExceptUploads(req, res, next) {
  if (UPLOAD_ROUTES.has(req.path)) return next();
  defaultJson(req, res, next);
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Sem referer: evita bloqueio de hotlink em sites que checam a origem
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      'img-src * data: blob:',
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  });
  next();
}

function errorHandler(err, req, res, next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Arquivo grande demais' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'JSON inválido' });
  }
  if (err.status === 404 || err.statusCode === 404) {
    return res.status(404).end();
  }
  console.error('❌ Erro inesperado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: 'Erro interno do servidor' });
}

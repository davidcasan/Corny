import express from 'express';
import { requireAdmin } from '../auth.js';
import { DEFAULT_FOCAL, MAX_ZOOM, MIN_RECOMMENDED_SIDE, presentImage } from '../images.js';
import { searchImages as defaultSearch } from '../search/index.js';
import { cleanText, normalizeName } from '../util/text.js';
import { MAX_NAME_LENGTH, MAX_UPLOAD_BYTES, isValidImageUrl, parseId } from '../util/validate.js';

export function adminRoutes(db, { searchImages = defaultSearch, celebrityImages = null } = {}) {
  const router = express.Router();
  router.use(requireAdmin);

  const listActive = db.prepare(`
    SELECT * FROM celebrities
    WHERE deleted_at IS NULL
    ORDER BY name COLLATE NOCASE
  `);
  const insertCelebrity = db.prepare(`
    INSERT INTO celebrities (name, image_url, created_at) VALUES (?, ?, datetime('now'))
  `);
  // Exclusão lógica: mantém o histórico de partidas de quem já venceu
  const softDelete = db.prepare(`
    UPDATE celebrities SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
  `);
  const updateFocal = db.prepare(`
    UPDATE celebrities SET focal_x = ?, focal_y = ?, focal_zoom = ? WHERE id = ? AND deleted_at IS NULL
  `);

  const present = row => ({
    id: row.id,
    name: row.name,
    wins: row.wins,
    image_status: row.image_status,
    image_error: row.image_error,
    ...presentImage(row)
  });

  router.get('/search-image', async (req, res, next) => {
    const name = cleanText(req.query.name, MAX_NAME_LENGTH);
    if (!name) {
      return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
    }

    try {
      const { images, stats } = await searchImages(name);
      if (images.length === 0) {
        return res.status(404).json({ success: false, message: `Nenhuma imagem encontrada para "${name}"`, stats });
      }
      res.json({ success: true, name, images, stats });
    } catch (err) {
      next(err);
    }
  });

  // Limite maior só aqui, para aceitar upload manual em base64
  router.post('/add-celebrity', express.json({ limit: Math.ceil(MAX_UPLOAD_BYTES * 1.4) }), async (req, res, next) => {
    const name = cleanText(req.body?.name, MAX_NAME_LENGTH);
    const imageUrl = req.body?.imageUrl;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
    }
    if (!isValidImageUrl(imageUrl)) {
      return res.status(400).json({ success: false, message: 'Imagem inválida: use uma URL http(s) ou um arquivo PNG/JPEG/WEBP/GIF de até 8 MB' });
    }

    const key = normalizeName(name);
    const duplicate = listActive.all().find(c => normalizeName(c.name) === key);
    if (duplicate) {
      return res.status(409).json({ success: false, message: `${duplicate.name} já está cadastrado(a)` });
    }

    try {
      const id = Number(insertCelebrity.run(name, imageUrl).lastInsertRowid);
      const image = celebrityImages ? await celebrityImages.store(id) : { stored: false };
      res.json({ success: true, id, warning: imageWarning(image) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/celebrities', (req, res) => {
    res.json({ success: true, celebrities: listActive.all().map(present) });
  });

  // Enquadramento: ponto em % da imagem (0,0 = canto superior esquerdo) e zoom de 1 a 3
  router.put('/celebrity/:id/focal', (req, res) => {
    const id = parseId(req.params.id);
    const x = Number(req.body?.x);
    const y = Number(req.body?.y);
    const zoom = req.body?.zoom === undefined ? DEFAULT_FOCAL.zoom : Number(req.body.zoom);
    if (!id || ![x, y, zoom].every(Number.isFinite)) {
      return res.status(400).json({ success: false, message: 'Informe x e y entre 0 e 100 e zoom entre 1 e 3' });
    }

    const clamp = (v, min, max) => Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
    const focal = { focal_x: clamp(x, 0, 100), focal_y: clamp(y, 0, 100), focal_zoom: clamp(zoom, 1, MAX_ZOOM) };
    const { changes } = updateFocal.run(focal.focal_x, focal.focal_y, focal.focal_zoom, id);
    if (changes === 0) {
      return res.status(404).json({ success: false, message: 'Celebridade não encontrada' });
    }
    res.json({ success: true, ...focal });
  });

  router.delete('/celebrity/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const { changes } = softDelete.run(id);
    if (changes === 0) {
      return res.status(404).json({ success: false, message: 'Celebridade não encontrada' });
    }
    res.json({ success: true });
  });

  return router;
}

function imageWarning(image) {
  if (image.error) {
    return `A imagem não pôde ser guardada no servidor (${image.error}). O jogo vai usar o link original, que pode parar de funcionar.`;
  }
  if (image.stored && Math.min(image.width, image.height) < MIN_RECOMMENDED_SIDE) {
    return `Imagem pequena (${image.width}×${image.height}): pode ficar borrada no jogo.`;
  }
  return null;
}

import {
  TransientDownloadError, decodeDataUrl, downloadImage, imageProcessingAvailable,
  presentImage, removeStoredImage, storeImage
} from './images.js';

// Pausa entre downloads em lote: os sites (principalmente a Wikimedia) limitam rajadas
const BATCH_DELAY_MS = 700;

// Liga o processamento de imagens às linhas da tabela `celebrities`.
export function createCelebrityImages({ db, dir, allowPrivateHosts = false, batchDelayMs = BATCH_DELAY_MS }) {
  const findById = db.prepare('SELECT * FROM celebrities WHERE id = ?');
  const markStored = db.prepare(`
    UPDATE celebrities
    SET image_base = ?, image_widths = ?, image_width = ?, image_height = ?,
        image_status = 'stored', image_error = NULL, image_url = ?
    WHERE id = ?
  `);
  // status NULL = pendente: será tentada de novo no próximo início do servidor
  const markResult = db.prepare('UPDATE celebrities SET image_status = ?, image_error = ? WHERE id = ?');
  const listPending = db.prepare('SELECT id FROM celebrities WHERE image_status IS NULL ORDER BY deleted_at IS NOT NULL, id');

  // Baixa (ou decodifica) a imagem da celebridade e grava os tamanhos no disco.
  // Nunca lança: em caso de falha marca o erro e o jogo segue usando o link original.
  async function store(id) {
    const row = findById.get(id);
    if (!row) return { stored: false, error: 'celebridade não encontrada' };
    // Sem sharp a imagem fica pendente (não "falha") para ser guardada quando ele existir
    if (!(await imageProcessingAvailable())) return { stored: false, error: 'processamento de imagem indisponível' };

    try {
      const buffer = row.image_url.startsWith('data:')
        ? decodeDataUrl(row.image_url)
        : await downloadImage(row.image_url, { allowPrivateHosts });

      const result = await storeImage(buffer, { dir, prefix: `c${id}` });
      if (row.image_base && row.image_base !== result.base) {
        removeStoredImage(dir, row.image_base, JSON.parse(row.image_widths));
      }

      // Upload em base64 não precisa ficar no banco depois de virar arquivo
      const keptUrl = row.image_url.startsWith('data:') ? presentImage({ image_base: result.base, image_widths: JSON.stringify(result.widths) }).image_url : row.image_url;
      markStored.run(result.base, JSON.stringify(result.widths), result.width, result.height, keptUrl, id);
      return { stored: true, width: result.width, height: result.height };
    } catch (err) {
      const transient = err instanceof TransientDownloadError;
      markResult.run(transient ? null : 'failed', err.message, id);
      return { stored: false, transient, error: err.message };
    }
  }

  // Processa, uma por vez, as celebridades que ainda não têm imagem guardada
  async function processPending({ onProgress } = {}) {
    const ids = listPending.all().map(r => r.id);
    let failed = 0;

    for (const [index, id] of ids.entries()) {
      if (index > 0) await sleep(batchDelayMs);
      const result = await store(id);
      if (!result.stored) failed++;
      onProgress?.({ id, done: index + 1, failed, result });
    }

    return { total: ids.length, failed };
  }

  return { store, processPending };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

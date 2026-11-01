import { getJson } from '../http.js';

// Openverse: fotos com licença livre (Flickr, Wikimedia e outros). Sem chave, cada
// consulta traz no máximo 20 resultados e há limite de uso, então as consultas são
// feitas uma por vez e, se o Openverse falhar ou limitar, a fonte fica pausada um
// tempo em vez de atrasar as buscas seguintes.
const TIMEOUT_MS = 8000;
const PAUSE_AFTER_FAILURE_MS = 2 * 60 * 1000;

let queue = Promise.resolve();
let pausedUntil = 0;

export function openverse(name) {
  const run = queue.then(() => searchOnce(name));
  queue = run.catch(() => {});
  return run;
}

async function searchOnce(name) {
  const remaining = pausedUntil - Date.now();
  if (remaining > 0) {
    throw new Error(`pausada após falha, volta em ${Math.ceil(remaining / 60000)} min`);
  }

  try {
    const data = await getJson(`https://api.openverse.org/v1/images/?${new URLSearchParams({ q: name, page_size: '20' })}`, {
      timeoutMs: TIMEOUT_MS,
      retries: 0
    });
    return (data.results ?? []).map(item => ({
      url: item.url,
      thumb: item.thumbnail || item.url,
      width: item.width,
      height: item.height
    }));
  } catch (err) {
    pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
    throw err;
  }
}

export function resetOpenversePause() {
  pausedUntil = 0;
}

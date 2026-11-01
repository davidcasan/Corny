import { normalizeName } from '../util/text.js';
import { dedupeKey, rejectReason } from './filter.js';
import { brave, braveEnabled } from './sources/brave.js';
import { openverse } from './sources/openverse.js';
import { commons, wikidata, wikipedia } from './sources/wikimedia.js';

// Fontes consultadas em paralelo. A ordem aqui é a ordem dos resultados:
// primeiro as fotos principais dos artigos (quase sempre a pessoa certa), depois o volume.
// Fonte com `enabled` só entra quando a função devolve true (ex.: precisa de chave).
export const DEFAULT_SOURCES = [
  { id: 'wikipedia-pt', label: 'Wikipedia PT', search: wikipedia('pt') },
  { id: 'wikipedia-en', label: 'Wikipedia EN', search: wikipedia('en') },
  { id: 'wikidata', label: 'Wikidata', search: wikidata },
  { id: 'brave', label: 'Brave', search: brave, enabled: braveEnabled },
  { id: 'commons', label: 'Commons', search: commons },
  { id: 'openverse', label: 'Openverse', search: openverse }
];

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const MAX_RESULTS = 150;

export function createImageSearch(sources = DEFAULT_SOURCES) {
  const cache = new Map();

  return async function searchImages(name) {
    const cacheKey = normalizeName(name);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

    const active = sources.filter(s => !s.enabled || s.enabled());
    const settled = await Promise.allSettled(active.map(s => s.search(name)));

    const seen = new Set();
    const images = [];
    const stats = [];

    active.forEach((source, i) => {
      const outcome = settled[i];
      const stat = { id: source.id, label: source.label, found: 0, kept: 0, discarded: {} };
      stats.push(stat);

      if (outcome.status === 'rejected') {
        stat.error = outcome.reason?.message || String(outcome.reason);
        return;
      }

      for (const image of outcome.value) {
        stat.found++;
        const key = dedupeKey(image.url);
        const reason = seen.has(key) ? 'duplicada' : rejectReason(image);
        if (reason) {
          stat.discarded[reason] = (stat.discarded[reason] || 0) + 1;
          continue;
        }
        seen.add(key);
        stat.kept++;
        images.push({
          url: image.url,
          thumb: image.thumb || image.url,
          source: source.label,
          width: image.width ?? null,
          height: image.height ?? null
        });
      }
    });

    logStats(name, stats);
    const result = { images: images.slice(0, MAX_RESULTS), stats };

    // Não guarda resultado vazio: pode ter sido falha temporária
    if (images.length > 0) {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { at: Date.now(), result });
    }
    return result;
  };
}

function logStats(name, stats) {
  const parts = stats.map(s => {
    if (s.error) return `${s.label}: ERRO (${s.error})`;
    const discarded = Object.entries(s.discarded).map(([why, n]) => `${n} ${why}`).join(', ');
    return `${s.label}: ${s.kept}/${s.found}${discarded ? ` [descartadas: ${discarded}]` : ''}`;
  });
  console.log(`🔍 "${name}" → ${parts.join(' | ')}`);
}

export const searchImages = createImageSearch();

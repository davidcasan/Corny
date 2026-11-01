import { getJson } from '../http.js';

// Fontes da Wikimedia: Wikipedia (PT/EN), Wikidata e Commons.
// Todas devolvem imagens no formato { url, thumb, width, height, fileName }.

const FULL_WIDTH = 800;
const THUMB_WIDTH = 250;

// .../thumb/a/ab/Foto.jpg/960px-Foto.jpg?utm_source=... -> .../250px-Foto.jpg
function smallThumb(thumbUrl) {
  try {
    const url = new URL(thumbUrl);
    url.pathname = url.pathname.replace(/\/\d+px-([^/]+)$/, `/${THUMB_WIDTH}px-$1`);
    url.search = '';
    return url.toString();
  } catch {
    return thumbUrl;
  }
}

function filePath(fileName, width) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName.replace(/ /g, '_'))}?width=${width}`;
}

// Foto principal dos artigos que mais batem com o nome
export function wikipedia(lang) {
  return async (name) => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      generator: 'search', gsrsearch: name, gsrlimit: '3',
      prop: 'pageimages', piprop: 'thumbnail|name|original', pithumbsize: String(FULL_WIDTH)
    });
    const data = await getJson(`https://${lang}.wikipedia.org/w/api.php?${params}`);
    const pages = (data.query?.pages ?? []).sort((a, b) => a.index - b.index);

    return pages
      .filter(page => page.thumbnail)
      .map(page => ({
        url: page.thumbnail.source,
        thumb: smallThumb(page.thumbnail.source),
        width: page.original?.width,
        height: page.original?.height,
        fileName: page.pageimage
      }));
  };
}

// Foto oficial (P18) das entidades. A busca do Wikidata entende apelidos e nomes alternativos.
export async function wikidata(name) {
  const search = await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({
    action: 'wbsearchentities', format: 'json', search: name, language: 'pt', uselang: 'pt', type: 'item', limit: '5'
  })}`);
  const ids = (search.search ?? []).map(e => e.id);
  if (ids.length === 0) return [];

  const entities = await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({
    action: 'wbgetentities', format: 'json', ids: ids.join('|'), props: 'claims'
  })}`);

  return ids
    .flatMap(id => entities.entities?.[id]?.claims?.P18 ?? [])
    .map(claim => claim.mainsnak?.datavalue?.value)
    .filter(Boolean)
    .map(fileName => ({ url: filePath(fileName, FULL_WIDTH), thumb: filePath(fileName, THUMB_WIDTH), fileName }));
}

// Busca direta por arquivos de foto no Commons
export async function commons(name) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2',
    generator: 'search', gsrsearch: `${name} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '50',
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: String(FULL_WIDTH)
  });
  const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
  const pages = (data.query?.pages ?? []).sort((a, b) => a.index - b.index);

  return pages
    .filter(page => page.imageinfo?.[0]?.thumburl)
    .map(page => {
      const info = page.imageinfo[0];
      return {
        url: info.thumburl,
        thumb: smallThumb(info.thumburl),
        width: info.width,
        height: info.height,
        fileName: page.title.replace(/^File:/, '')
      };
    });
}

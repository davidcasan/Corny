const MIN_SIDE = 250;
const MAX_ASPECT = 3;
const BITMAP_EXT = /\.(jpe?g|png|webp)$/i;
// Arquivos que quase nunca são foto de pessoa
const JUNK_NAME = /(logo|icon|ícone|flag|bandeira|signature|assinatura|coat[_ ]of[_ ]arms|bras[aã]o|\bmap\b|mapa|chart|gr[aá]fico|diagram|banner|emblem|seal|escudo)/i;

// Chave para eliminar duplicatas: o mesmo arquivo da Wikimedia aparece em vários
// tamanhos (/thumb/a/ab/Foto.jpg/800px-Foto.jpg) e em várias fontes.
export function dedupeKey(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'upload.wikimedia.org') {
      const parts = u.pathname.split('/');
      const thumbIndex = parts.indexOf('thumb');
      const file = thumbIndex >= 0 ? parts[thumbIndex + 3] : parts.at(-1);
      return `wm:${decodeURIComponent(file).toLowerCase()}`;
    }
    if (u.hostname === 'commons.wikimedia.org' && u.pathname.includes('Special:FilePath/')) {
      const file = u.pathname.split('Special:FilePath/')[1];
      return `wm:${decodeURIComponent(file).replace(/ /g, '_').toLowerCase()}`;
    }
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return url;
  }
}

// Motivo do descarte, ou null se a imagem serve
export function rejectReason(image) {
  if (!image.url || !/^https?:\/\//.test(image.url)) return 'url inválida';
  if (image.fileName) {
    if (!BITMAP_EXT.test(image.fileName)) return 'não é foto (svg/gif/pdf...)';
    if (JUNK_NAME.test(image.fileName)) return 'logo/ícone/bandeira';
  }
  if (image.width && image.height) {
    if (Math.min(image.width, image.height) < MIN_SIDE) return 'muito pequena';
    const aspect = Math.max(image.width, image.height) / Math.min(image.width, image.height);
    if (aspect > MAX_ASPECT) return 'proporção de banner';
  }
  return null;
}

export const MAX_NAME_LENGTH = 80;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

// Aceita URL http(s) ou imagem enviada pelo admin como data URL (png/jpeg/webp/gif).
export function isValidImageUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;

  if (value.startsWith('data:')) {
    return value.length <= MAX_UPLOAD_BYTES * 1.4 && DATA_IMAGE.test(value);
  }

  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && value.length <= 2048;
  } catch {
    return false;
  }
}

export function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

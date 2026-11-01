import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { BOT_USER_AGENT } from './search/http.js';

// Guarda as imagens das celebridades no servidor em vez de depender do link original:
// corrige a rotação EXIF, gera tamanhos responsivos em WebP e nunca amplia.

export const IMAGE_WIDTHS = [320, 640, 960];
export const DEFAULT_FOCAL = { x: 50, y: 25, zoom: 1 };
export const MAX_ZOOM = 3;
export const MIN_RECOMMENDED_SIDE = 400;

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15000;
const WEBP_QUALITY = 80;

let sharpModule;
async function loadSharp() {
  sharpModule ??= import('sharp').then(m => m.default).catch(() => null);
  return sharpModule;
}

export async function imageProcessingAvailable() {
  return Boolean(await loadSharp());
}

// ==================== OBTER OS BYTES ====================

export function decodeDataUrl(dataUrl) {
  const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('data URL inválida');
  return Buffer.from(match[1], 'base64');
}

// Erro que pode sumir sozinho (limite de uso, servidor fora, rede): vale tentar depois
export class TransientDownloadError extends Error {}

export async function downloadImage(url, { allowPrivateHosts = false, maxRetries = 3 } = {}) {
  const parsed = new URL(url);
  if (!allowPrivateHosts) await assertPublicHost(parsed.hostname);

  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': BOT_USER_AGENT, Accept: 'image/*' },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'follow'
      });
    } catch (err) {
      throw new TransientDownloadError(err.name === 'TimeoutError' ? 'tempo esgotado ao baixar' : `falha ao baixar: ${err.message}`);
    }

    // 429 = "vá mais devagar": espera o tempo pedido pelo site e tenta de novo
    if (res.status === 429 && attempt < maxRetries) {
      await sleep(retryAfterMs(res.headers.get('retry-after'), attempt));
      continue;
    }
    break;
  }

  if (res.status === 429 || res.status >= 500) throw new TransientDownloadError(`o site respondeu HTTP ${res.status}`);
  if (!res.ok) throw new Error(`o site respondeu HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`o link não é uma imagem (${type || 'sem tipo'})`);
  if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) throw new Error('imagem maior que 15 MB');

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new Error('imagem maior que 15 MB');
  return buffer;
}

const MAX_RETRY_WAIT_MS = 30000;

function retryAfterMs(header, attempt) {
  const seconds = Number(header);
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000 * 2 ** attempt;
  return Math.min(wait, MAX_RETRY_WAIT_MS);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// O servidor não deve buscar endereços da rede interna (roteador, outros serviços do PC)
async function assertPublicHost(hostname) {
  const addresses = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true })).map(a => a.address);
  if (addresses.some(isPrivateAddress)) throw new Error('endereço de rede interna não permitido');
}

export function isPrivateAddress(address) {
  const ip = address.replace(/^::ffff:/, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

// ==================== PROCESSAR E GRAVAR ====================

// Gera <prefixo>-<largura>.webp para cada largura (sem ampliar) e devolve as dimensões
// da imagem já na orientação correta.
export async function storeImage(buffer, { dir, prefix }) {
  const sharp = await loadSharp();
  if (!sharp) throw new Error('processamento de imagem indisponível (sharp não instalado)');

  let meta;
  try {
    const raw = await sharp(buffer).metadata();
    // Orientações EXIF 5 a 8 giram a foto 90°: largura e altura trocam
    const rotated = (raw.orientation ?? 1) >= 5;
    meta = { width: rotated ? raw.height : raw.width, height: rotated ? raw.width : raw.height };
  } catch {
    throw new Error('arquivo de imagem inválido ou corrompido');
  }
  if (!meta.width || !meta.height) throw new Error('arquivo de imagem inválido ou corrompido');

  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
  const base = `${prefix}-${hash}`;

  const widths = IMAGE_WIDTHS.filter(w => w < meta.width);
  widths.push(Math.min(meta.width, IMAGE_WIDTHS.at(-1)));
  const unique = [...new Set(widths)].sort((a, b) => a - b);

  for (const width of unique) {
    await sharp(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(dir, `${base}-${width}.webp`));
  }

  return { base, widths: unique, width: meta.width, height: meta.height };
}

export function removeStoredImage(dir, base, widths) {
  for (const width of widths) {
    fs.rmSync(path.join(dir, `${base}-${width}.webp`), { force: true });
  }
}

// ==================== APRESENTAÇÃO ====================

// Campos de imagem que o front-end usa, a partir de uma linha de `celebrities`
export function presentImage(row, imagesUrlPrefix = '/images') {
  const focal = {
    focal_x: row.focal_x ?? DEFAULT_FOCAL.x,
    focal_y: row.focal_y ?? DEFAULT_FOCAL.y,
    focal_zoom: row.focal_zoom ?? DEFAULT_FOCAL.zoom
  };

  if (row.image_base) {
    const widths = JSON.parse(row.image_widths);
    const largest = widths.at(-1);
    return {
      image_url: `${imagesUrlPrefix}/${row.image_base}-${largest}.webp`,
      image_srcset: widths.map(w => `${imagesUrlPrefix}/${row.image_base}-${w}.webp ${w}w`).join(', '),
      image_width: row.image_width,
      image_height: row.image_height,
      image_stored: true,
      ...focal
    };
  }

  return { image_url: row.image_url, image_srcset: null, image_width: null, image_height: null, image_stored: false, ...focal };
}

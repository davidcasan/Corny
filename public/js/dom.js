const PLACEHOLDER_IMAGE = '/img/placeholder.svg';

// Cria elementos sem innerHTML: texto vindo do banco nunca vira HTML.
// el('div', { className: 'x', onClick: fn }, 'texto', outroEl)
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }

  node.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS_URL = '/img/icons.svg';

// Ícone do sprite /img/icons.svg (decorativo: o texto do botão ou o aria-label descreve a ação)
export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${ICONS_URL}#${name}`);
  svg.append(use);
  return svg;
}

export function setIcon(svg, name) {
  svg.querySelector('use').setAttribute('href', `${ICONS_URL}#${name}`);
}

export const DEFAULT_FOCAL = { x: 50, y: 25, zoom: 1 };

export function focalOf(celeb) {
  return {
    x: celeb.focal_x ?? DEFAULT_FOCAL.x,
    y: celeb.focal_y ?? DEFAULT_FOCAL.y,
    zoom: celeb.focal_zoom ?? DEFAULT_FOCAL.zoom
  };
}

// Enquadra a imagem no ponto escolhido e aproxima em volta dele.
// O zoom usa transform (barato para o navegador); a moldura (.img-frame) corta o excesso.
export function applyFraming(img, { x, y, zoom }) {
  img.style.objectPosition = `${x}% ${y}%`;
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.transform = zoom > 1 ? `scale(${zoom})` : '';
}

// Com zoom, a imagem é exibida maior que a moldura: pede um arquivo proporcionalmente maior
function zoomSizes(sizes, zoom) {
  if (zoom <= 1) return sizes;
  return sizes.split(',').map(part => {
    const tokens = part.trim().split(/\s+(?=[^\s]+$)/);
    const length = tokens.pop();
    return [...tokens, `calc(${length} * ${zoom})`].join(' ');
  }).join(', ');
}

// Imagem de celebridade dentro de uma moldura: tamanho certo para a tela (srcset),
// enquadramento do admin e fallback quando o link quebra. O tamanho e a forma vêm da
// classe da moldura no CSS. `sizes` é a largura exibida, ex.: '(max-width: 768px) 45vw, 380px'.
export function celebImage(celeb, { className = '', sizes = '100vw', ...props } = {}) {
  const focal = focalOf(celeb);
  const img = el('img', { alt: celeb.name, decoding: 'async', ...props });
  applyFraming(img, focal);

  img.addEventListener('error', () => {
    if (!img.src.endsWith(PLACEHOLDER_IMAGE)) {
      img.removeAttribute('srcset');
      img.style.transform = '';
      img.src = PLACEHOLDER_IMAGE;
      img.classList.add('img-broken');
    }
  }, { once: true });

  if (celeb.image_srcset) {
    img.sizes = zoomSizes(sizes, focal.zoom);
    img.srcset = celeb.image_srcset;
  }
  img.src = celeb.image_url;

  return el('div', { className: `img-frame ${className}`.trim() }, img);
}

// Resolve quando a imagem está baixada e decodificada (pronta para aparecer sem piscar),
// quando ela falha (o fallback assume) ou quando o tempo acaba. Nunca rejeita.
export function whenDecoded(img, timeoutMs) {
  const decoded = img.decode().catch(() => new Promise(resolve => {
    // decode() falha se o src mudar para o placeholder no meio: espera o novo carregar
    if (img.complete) resolve();
    else img.addEventListener('load', resolve, { once: true });
  }));
  return Promise.race([decoded, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
}

export function showMessage(target, text, type = 'success') {
  target.textContent = text;
  target.className = `message ${type}`;
  target.style.display = 'block';
}

export function hideMessage(target) {
  target.style.display = 'none';
}

export function show(node, display = 'block') {
  node.style.display = display;
}

export function hide(node) {
  node.style.display = 'none';
}

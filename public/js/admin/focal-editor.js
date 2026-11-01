import { DEFAULT_FOCAL, applyFraming, el, focalOf } from '../dom.js';

const KEY_STEP = 2;
const MAX_ZOOM = 3;

// Abre o editor de enquadramento: o admin clica no rosto, ajusta o zoom e vê na hora
// como fica no card do duelo e no círculo do ranking.
// Resolve com { x, y, zoom } ou null (cancelado).
export function openFocalEditor(celeb) {
  let { x, y, zoom } = focalOf(celeb);

  const source = el('img', { className: 'focal-source-image', src: celeb.image_url, alt: celeb.name, draggable: false });
  const marker = el('span', { className: 'focal-marker', 'aria-hidden': 'true' });
  const sourceBox = el('div', {
    className: 'focal-source',
    tabIndex: 0,
    role: 'application',
    'aria-label': 'Clique no rosto ou use as setas para mover o ponto de enquadramento'
  }, source, marker);

  const previewCardImg = el('img', { src: celeb.image_url, alt: '' });
  const previewCircleImg = el('img', { src: celeb.image_url, alt: '' });
  const zoomInput = el('input', { type: 'range', min: '1', max: String(MAX_ZOOM), step: '0.1', className: 'focal-zoom', 'aria-label': 'Zoom' });
  const zoomLabel = el('span', { className: 'focal-coords' });

  function update() {
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    applyFraming(previewCardImg, { x, y, zoom });
    applyFraming(previewCircleImg, { x, y, zoom });
    zoomInput.value = String(zoom);
    zoomLabel.textContent = `Zoom ${zoom.toFixed(1)}×`;
  }

  function setPoint(nx, ny) {
    x = Math.round(Math.min(100, Math.max(0, nx)) * 10) / 10;
    y = Math.round(Math.min(100, Math.max(0, ny)) * 10) / 10;
    update();
  }

  sourceBox.addEventListener('click', (e) => {
    const rect = source.getBoundingClientRect();
    setPoint(((e.clientX - rect.left) / rect.width) * 100, ((e.clientY - rect.top) / rect.height) * 100);
  });
  sourceBox.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
    if (!moves[e.key]) return;
    e.preventDefault();
    setPoint(x + moves[e.key][0], y + moves[e.key][1]);
  });
  zoomInput.addEventListener('input', () => {
    zoom = Number(zoomInput.value);
    update();
  });

  return new Promise((resolve) => {
    let result = null;

    const reset = () => {
      zoom = DEFAULT_FOCAL.zoom;
      setPoint(DEFAULT_FOCAL.x, DEFAULT_FOCAL.y);
    };

    const dialog = el('dialog', { className: 'focal-dialog' },
      el('h3', {}, `Enquadrar: ${celeb.name}`),
      el('p', { className: 'focal-hint' }, 'Clique no rosto e aumente o zoom se a pessoa estiver pequena na foto.'),
      el('div', { className: 'focal-body' },
        sourceBox,
        el('div', { className: 'focal-previews' },
          el('span', {}, 'Duelo'), el('div', { className: 'img-frame focal-preview-card' }, previewCardImg),
          el('span', {}, 'Ranking'), el('div', { className: 'img-frame focal-preview-circle' }, previewCircleImg),
          zoomLabel, zoomInput
        )
      ),
      el('div', { className: 'focal-actions' },
        el('button', { type: 'button', className: 'btn-secondary', onClick: reset }, 'Padrão'),
        el('button', { type: 'button', className: 'btn-secondary', onClick: () => dialog.close() }, 'Cancelar'),
        el('button', { type: 'button', className: 'btn-primary btn-success', onClick: () => { result = { x, y, zoom }; dialog.close(); } }, 'Salvar')
      )
    );

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    update();
    document.body.append(dialog);
    dialog.showModal();
    sourceBox.focus();
  });
}

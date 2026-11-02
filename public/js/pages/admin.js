import { api } from '../api.js';
import { applyFraming, celebImage, el, focalOf, hide, show, showMessage } from '../dom.js';
import { openFormDialog } from '../admin/dialog.js';
import { openFocalEditor } from '../admin/focal-editor.js';
import { initUsersTab } from '../admin/users.js';
import { searchKey } from '../format.js';
import { plural } from '../game/state.js';
import { logout, requireLogin } from '../session.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_NAME_LENGTH = 80;

await requireLogin({ admin: true });

// ==================== ABAS ====================

const TABS = {
  personalidades: { button: document.getElementById('celebsTabBtn'), panel: document.getElementById('celebsTab') },
  jogadores: { button: document.getElementById('usersTabBtn'), panel: document.getElementById('usersTab') }
};

function showTab(name) {
  for (const [key, tab] of Object.entries(TABS)) {
    const active = key === name;
    tab.button.classList.toggle('active', active);
    tab.button.setAttribute('aria-selected', String(active));
    tab.panel.style.display = active ? '' : 'none';
  }
  if (name === 'jogadores') initUsersTab();
  history.replaceState(null, '', `#${name}`);
}

for (const [name, tab] of Object.entries(TABS)) {
  tab.button.addEventListener('click', () => showTab(name));
}
showTab(location.hash === '#jogadores' ? 'jogadores' : 'personalidades');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const messageDiv = document.getElementById('message');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreviewGrid = document.getElementById('imagePreviewGrid');
const celebritiesGrid = document.getElementById('celebritiesGrid');
const totalCount = document.getElementById('totalCount');

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('rankingBtn').addEventListener('click', () => { window.location.href = '/ranking'; });

// Devolve o aviso do servidor (ex.: imagem não pôde ser guardada), ou null
async function addCelebrity(name, imageUrl) {
  const { warning } = await api('/api/admin/add-celebrity', { method: 'POST', body: { name, imageUrl } });
  loadCelebrities();
  return warning;
}

// ==================== ADIÇÃO MANUAL ====================

const manualName = document.getElementById('manualName');
const manualImageUrl = document.getElementById('manualImageUrl');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const manualPreview = document.getElementById('manualPreview');
const manualPreviewImg = document.getElementById('manualPreviewImg');
const manualMessage = document.getElementById('manualMessage');
const addManualBtn = document.getElementById('addManualBtn');

let manualImageData = null; // URL ou data URL (base64)
let manualMessageTimer = null;

function showManualMessage(text, type) {
  showMessage(manualMessage, text, type);
  clearTimeout(manualMessageTimer);
  manualMessageTimer = setTimeout(() => hide(manualMessage), type === 'warning' ? 10000 : 3000);
}

function setDropZoneActive(active) {
  dropZone.classList.toggle('drag-over', active);
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  setDropZoneActive(true);
});
dropZone.addEventListener('dragleave', () => setDropZoneActive(false));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  setDropZoneActive(false);
  handleImageFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => handleImageFile(e.target.files[0]));

manualImageUrl.addEventListener('input', () => {
  const url = manualImageUrl.value.trim();
  if (!url) return;
  manualImageData = url;
  manualPreviewImg.src = url;
  show(manualPreview);
  fileInput.value = '';
});

manualPreviewImg.addEventListener('error', () => {
  if (manualImageData) showManualMessage('⚠️ Não foi possível carregar essa imagem', 'error');
});

function handleImageFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    showManualMessage('❌ Use uma imagem PNG, JPEG, WEBP ou GIF', 'error');
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showManualMessage('❌ Imagem maior que 8 MB', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    manualImageData = reader.result;
    manualPreviewImg.src = reader.result;
    show(manualPreview);
    manualImageUrl.value = '';
    showManualMessage('✅ Imagem carregada', 'success');
  };
  reader.onerror = () => showManualMessage('❌ Não foi possível ler o arquivo', 'error');
  reader.readAsDataURL(file);
}

addManualBtn.addEventListener('click', async () => {
  const name = manualName.value.trim();
  if (!name) {
    showManualMessage('❌ Digite o nome da celebridade', 'error');
    return;
  }
  if (!manualImageData) {
    showManualMessage('❌ Adicione uma imagem (URL ou upload)', 'error');
    return;
  }

  addManualBtn.disabled = true;
  showManualMessage('Adicionando...', 'success');
  try {
    const warning = await addCelebrity(name, manualImageData);
    showManualMessage(warning ? `⚠️ ${name} adicionado. ${warning}` : `✅ ${name} adicionado com sucesso!`, warning ? 'warning' : 'success');
    manualName.value = '';
    manualImageUrl.value = '';
    fileInput.value = '';
    hide(manualPreview);
    manualImageData = null;
  } catch (err) {
    showManualMessage(`❌ ${err.message}`, 'error');
  } finally {
    addManualBtn.disabled = false;
  }
});

// ==================== BUSCA ====================

let searchResults = [];

searchBtn.addEventListener('click', searchAll);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchAll();
});

async function searchAll() {
  // Vários nomes separados por ponto e vírgula
  const names = searchInput.value.split(';').map(n => n.trim()).filter(Boolean);
  if (names.length === 0) {
    showMessage(messageDiv, 'Digite um ou mais nomes para buscar', 'error');
    return;
  }

  showMessage(messageDiv, `Buscando ${plural(names.length, 'celebridade', 'celebridades')}...`);
  searchBtn.disabled = true;
  hide(imagePreviewContainer);

  const settled = await Promise.allSettled(names.map(name =>
    api(`/api/admin/search-image?name=${encodeURIComponent(name)}`)
  ));
  searchBtn.disabled = false;

  searchResults = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => ({ name: r.value.name, images: r.value.images, stats: r.value.stats, index: 0 }));

  const notFound = names.filter((_, i) => settled[i].status === 'rejected');
  if (searchResults.length === 0) {
    showMessage(messageDiv, '❌ Nenhuma imagem encontrada. Tente outros nomes.', 'error');
    return;
  }

  if (notFound.length > 0) {
    showMessage(messageDiv, `⚠️ Sem resultado para: ${notFound.join(', ')}`, 'error');
  } else {
    hide(messageDiv);
  }
  renderSearchResults();
}

function renderSearchResults() {
  if (searchResults.length === 0) {
    hide(imagePreviewContainer);
    searchInput.value = '';
    return;
  }

  imagePreviewGrid.replaceChildren(...searchResults.map(searchResultCard));
  show(imagePreviewContainer);
}

// Card de um nome buscado: foto escolhida em destaque + grade com todas as opções.
// A seleção é atualizada no lugar, sem recriar a grade.
function searchResultCard(result) {
  const preview = el('img', { className: 'search-result-image', alt: result.name, decoding: 'async' });
  const caption = el('p', { className: 'search-result-caption' });
  const addBtn = el('button', { className: 'btn-primary btn-success', onClick: () => addFromSearch(result, addBtn) }, '✅ Adicionar');
  const options = new Map(); // imagem -> botão da miniatura

  function select(image) {
    options.get(result.images[result.index])?.classList.remove('selected');
    result.index = result.images.indexOf(image);
    options.get(image)?.classList.add('selected');
    preview.classList.remove('img-broken');
    preview.src = image.url;
    addBtn.disabled = false;
    const size = image.width && image.height ? ` · ${image.width}×${image.height}` : '';
    caption.textContent = `Opção ${result.index + 1} de ${result.images.length} · ${image.source}${size}`;
  }

  // Link que não abre: sai da lista (os jogadores também não veriam a foto)
  function discard(image) {
    if (!options.has(image)) return;
    const selected = result.images[result.index];
    options.get(image).remove();
    options.delete(image);
    result.images = result.images.filter(i => i !== image);

    if (result.images.length === 0) {
      removeResult(result);
      return;
    }
    // Se a descartada era a escolhida, passa para a próxima; senão só corrige o contador
    select(selected === image ? result.images[Math.min(result.index, result.images.length - 1)] : selected);
  }

  preview.addEventListener('error', () => {
    const image = result.images[result.index];
    if (image && preview.src === image.url) discard(image);
  });

  const grid = el('div', { className: 'thumb-grid' }, result.images.map(image => {
    const thumb = el('img', { src: image.thumb, alt: '', loading: 'lazy', decoding: 'async' });
    thumb.addEventListener('error', () => discard(image), { once: true });
    const button = el('button', { type: 'button', className: 'thumb-option', title: image.source, onClick: () => select(image) }, thumb);
    options.set(image, button);
    return button;
  }));

  select(result.images[0]);

  return el('div', { className: 'image-preview-card' },
    preview,
    el('h3', {}, result.name),
    caption,
    el('p', { className: 'search-result-stats' }, describeStats(result.stats)),
    grid,
    el('div', { className: 'search-result-actions' },
      addBtn,
      el('button', { className: 'btn-secondary', onClick: () => removeResult(result) }, '❌ Ignorar')
    )
  );
}

// "Wikipedia PT 1 · DuckDuckGo 87 · Openverse falhou"
function describeStats(stats = []) {
  return stats
    .map(s => (s.error ? `${s.label} falhou` : `${s.label} ${s.kept}`))
    .join(' · ');
}

function removeResult(result) {
  searchResults = searchResults.filter(r => r !== result);
  renderSearchResults();
}

async function addFromSearch(result, button) {
  button.disabled = true;
  try {
    const warning = await addCelebrity(result.name, result.images[result.index].url);
    if (warning) {
      showMessage(messageDiv, `⚠️ ${result.name} adicionado. ${warning}`, 'warning');
    } else {
      showMessage(messageDiv, `✅ ${result.name} adicionado com sucesso!`);
    }
    removeResult(result);
  } catch (err) {
    showMessage(messageDiv, `❌ ${err.message}`, 'error');
    button.disabled = false;
  }
}

// ==================== CADASTRADAS ====================

const celebsFilter = document.getElementById('celebsFilter');
const celebsFilterInfo = document.getElementById('celebsFilterInfo');
const noMatch = el('p', { className: 'empty-ranking' }, 'Nenhuma personalidade com esse nome.');
let listed = []; // { celeb, item }: os cards são criados uma vez e o filtro só mostra/esconde

celebsFilter.addEventListener('input', applyCelebsFilter);

async function loadCelebrities() {
  try {
    const { celebrities } = await api('/api/admin/celebrities');
    totalCount.textContent = celebrities.length;

    if (celebrities.length === 0) {
      listed = [];
      celebritiesGrid.replaceChildren(el('p', { className: 'empty-ranking' }, 'Nenhuma celebridade cadastrada ainda.'));
      return;
    }

    listed = celebrities.map(celeb => ({ celeb, item: celebrityItem(celeb) }));
    celebritiesGrid.replaceChildren(...listed.map(entry => entry.item), noMatch);
    applyCelebsFilter();
  } catch (err) {
    showMessage(messageDiv, `❌ Erro ao carregar celebridades: ${err.message}`, 'error');
  }
}

// Busca pelo nome, ignorando acentos e maiúsculas
function applyCelebsFilter() {
  const query = searchKey(celebsFilter.value.trim());
  let visible = 0;
  for (const { celeb, item } of listed) {
    const match = !query || searchKey(celeb.name).includes(query);
    item.style.display = match ? '' : 'none';
    if (match) visible++;
  }
  noMatch.style.display = query && visible === 0 ? '' : 'none';
  celebsFilterInfo.textContent = query ? `Mostrando ${visible} de ${listed.length}` : '';
}

function celebrityItem(celeb) {
  const image = celebImage(celeb, { loading: 'lazy', sizes: '200px' });
  const title = el('h4', {}, celeb.name);

  return el('div', { className: 'celebrity-item' },
    image,
    title,
    el('p', { className: 'wins' }, `Cortado ${plural(celeb.wins, 'vez', 'vezes')}`),
    !celeb.image_stored && el('p', {
      className: 'image-badge',
      title: celeb.image_error || 'Ainda não guardada no servidor'
    }, '⚠️ link externo'),
    isSmall(celeb) && el('p', {
      className: 'image-badge',
      title: `${celeb.image_width}×${celeb.image_height}: pode ficar borrada no jogo`
    }, '📉 imagem pequena'),
    el('button', { className: 'btn-secondary btn-small', onClick: () => renameCelebrity(celeb, title) }, 'Renomear'),
    el('button', { className: 'btn-secondary btn-small', onClick: () => editFocal(celeb, image) }, 'Enquadrar'),
    el('button', { className: 'btn-delete', onClick: () => deleteCelebrity(celeb) }, 'Excluir')
  );
}

async function renameCelebrity(celeb, title) {
  const saved = await openFormDialog({
    title: `Renomear ${celeb.name}`,
    hint: 'O nome novo aparece no jogo, no ranking e no histórico de partidas.',
    fields: [{ name: 'name', label: 'Nome', value: celeb.name, maxLength: MAX_NAME_LENGTH }],
    onSubmit: (values) => api(`/api/admin/celebrity/${celeb.id}/name`, { method: 'PUT', body: { name: values.name } })
  });
  if (!saved) return;

  const oldName = celeb.name;
  celeb.name = saved.name;
  title.textContent = saved.name;
  applyCelebsFilter();
  showMessage(messageDiv, `✅ ${oldName} agora se chama ${saved.name}`);
}

// Mesmo limite do aviso do servidor (MIN_RECOMMENDED_SIDE em server/images.js)
const MIN_RECOMMENDED_SIDE = 400;

function isSmall(celeb) {
  return celeb.image_stored && Math.min(celeb.image_width, celeb.image_height) < MIN_RECOMMENDED_SIDE;
}

async function editFocal(celeb, image) {
  const point = await openFocalEditor(celeb);
  if (!point) return;

  try {
    const saved = await api(`/api/admin/celebrity/${celeb.id}/focal`, { method: 'PUT', body: point });
    Object.assign(celeb, { focal_x: saved.focal_x, focal_y: saved.focal_y, focal_zoom: saved.focal_zoom });
    applyFraming(image.querySelector('img'), focalOf(celeb));
    showMessage(messageDiv, `✅ Enquadramento de ${celeb.name} salvo`);
  } catch (err) {
    showMessage(messageDiv, `❌ ${err.message}`, 'error');
  }
}

async function deleteCelebrity(celeb) {
  if (!confirm(`Tem certeza que deseja excluir ${celeb.name}?`)) return;

  try {
    await api(`/api/admin/celebrity/${celeb.id}`, { method: 'DELETE' });
    showMessage(messageDiv, '✅ Celebridade excluída com sucesso!');
    loadCelebrities();
  } catch (err) {
    showMessage(messageDiv, `❌ ${err.message}`, 'error');
  }
}

loadCelebrities();

import { api } from '../api.js';
import { celebImage, el, hide, hideMessage, icon, show, showMessage, whenDecoded } from '../dom.js';
import { confetti } from '../effects.js';
import { setupFullscreenButton } from '../fullscreen.js';
import { GameState, plural } from '../game/state.js';
import { logout, requireLogin } from '../session.js';
import { playCut, playSave, setupSoundButton } from '../sound.js';

// Como se joga: em cada duelo o jogador escolhe quem quer CORTAR. O escolhido segue para o
// próximo duelo (GameState trata ele como "sobrevivente") e o outro se salva. Quem for
// escolhido até o fim é cortado pela raiz e ganha um ponto no ranking dos mais cortados.

// Mosaico de fundo: quantas fotos cabem na tela (células de ~126px, ver .mosaic-background)
const MOSAIC_CELL_PX = 126;
const MOSAIC_MAX_TILES = 120;
// Largura exibida de cada card do duelo (ver .celebrity-card em styles.css).
// O mosaico usa o mesmo valor para baixar o mesmo arquivo: cada foto vem uma vez só.
const DUEL_IMAGE_SIZES = '(max-width: 640px) 45vw, 380px';
const FINAL_IMAGE_SIZES = '300px';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Duração da saída de quem se salva (animação saved-out no CSS)
const LEAVE_MS = REDUCED_MOTION ? 0 : 600;
// Se uma imagem demorar demais, o jogo segue com o que tiver (o fallback cuida de link quebrado)
const IMAGE_WAIT_MS = 4000;
// Quanto a troca de duelo espera a foto do próximo antes de entrar com o skeleton
const NEXT_CARD_WAIT_MS = 250;
// Fila com 2 downloads por vez: a foto do próximo duelo nunca divide a rede com as últimas
const PRELOAD_CONCURRENCY = 2;
const BURST_COLORS = ['var(--cyan)', 'var(--yellow)', 'var(--text)'];

const user = await requireLogin({ admin: false });
document.getElementById('username').textContent = user.username;

const startScreen = document.getElementById('startScreen');
const gameScreen = document.getElementById('gameScreen');
const winnerScreen = document.getElementById('winnerScreen');
const duelContainer = document.getElementById('duelContainer');
const progressBox = document.getElementById('progressBox');
const currentRoundEl = document.getElementById('currentRound');
const totalRoundsEl = document.getElementById('totalRounds');
const progressFill = document.getElementById('progressFill');
const mosaicBg = document.getElementById('mosaicBg');
const winnerCard = document.getElementById('winnerCard');
const rankingPosition = document.getElementById('rankingPosition');
const startMessage = document.getElementById('startMessage');
const startGameBtn = document.getElementById('startGameBtn');
const startLabel = startGameBtn.querySelector('.btn-label');
const playAgainBtn = document.getElementById('playAgainBtn');
const confettiLayer = document.getElementById('leafRain');

let game = null;
let gameId = null;
let maxWins = 0;
let cards = new Map();        // id da celebridade -> card do duelo
let finalFrames = new Map();  // finalistas -> foto grande do fim já carregada
let busy = false;

startGameBtn.addEventListener('click', startGame);
playAgainBtn.addEventListener('click', startGame);
document.getElementById('exitBtn').addEventListener('click', showStartScreen);
document.getElementById('viewRankingBtn').addEventListener('click', () => { window.location.href = '/ranking'; });
document.getElementById('rankingBtn').addEventListener('click', () => { window.location.href = '/ranking'; });
document.getElementById('logoutBtn').addEventListener('click', logout);
setupFullscreenButton(document.getElementById('fullscreenBtn'));
setupSoundButton(document.getElementById('soundBtn'));

async function startGame() {
  for (const btn of [startGameBtn, playAgainBtn]) btn.disabled = true;
  const label = startLabel.textContent;
  startLabel.textContent = 'Afiando a tesoura...';
  hideMessage(startMessage);

  try {
    const data = await api('/api/game/start');
    game = new GameState(data.celebrities);
    gameId = data.gameId;
    maxWins = data.maxWins ?? 0;
  } catch (err) {
    showStartScreen();
    showMessage(startMessage, err.message, 'error');
    return;
  } finally {
    for (const btn of [startGameBtn, playAgainBtn]) btn.disabled = false;
    startLabel.textContent = label;
  }

  finalFrames = new Map();
  busy = false;
  totalRoundsEl.textContent = game.totalRounds;
  updateProgress();

  const { players } = game;

  // Primeiro só as duas fotos do primeiro duelo, com prioridade alta: nada disputa a rede com elas
  const first = [game.survivor, game.challenger].map(celeb => createCard(celeb, 'high'));
  cards = new Map(first.map(card => [Number(card.dataset.id), card]));
  await Promise.all(first.map(card => card.ready));
  duelContainer.replaceChildren(...first);

  hide(startScreen);
  hide(winnerScreen);
  show(gameScreen);
  show(progressBox, 'grid');

  // Enquanto o jogador decide, as outras fotos carregam em fila, na ordem dos duelos. O mosaico
  // é só decoração: entra depois, reaproveitando os mesmos arquivos.
  preloadInOrder(players.slice(2)).then(() => {
    if (game?.players === players) renderMosaic(players);
  });
  prefetchFinalIfLastDuel();
}

async function preloadInOrder(celebrities) {
  const queue = [...celebrities];
  const worker = async () => {
    while (queue.length > 0) {
      await cardFor(queue.shift()).ready;
    }
  };
  await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
}

// Card já criado pela fila, ou criado agora se o jogador foi mais rápido que ela
function cardFor(celeb) {
  if (!cards.has(celeb.id)) cards.set(celeb.id, createCard(celeb, 'high'));
  return cards.get(celeb.id);
}

function createCard(celeb, fetchPriority) {
  const frame = celebImage(celeb, { sizes: DUEL_IMAGE_SIZES, fetchPriority });
  const wins = celeb.wins ?? 0;
  const level = maxWins > 0 ? wins / maxWins : 0;

  const card = el('button', {
    type: 'button',
    className: 'celebrity-card',
    dataset: { id: celeb.id },
    'aria-label': `Cortar ${celeb.name} pela raiz`,
    onClick: () => handleChoice(celeb.id)
  },
    el('div', { className: 'card-photo' },
      el('span', { className: 'card-tag' }, `Ficha #${celeb.id}`),
      frame
    ),
    el('h3', {}, celeb.name),
    el('div', { className: 'meter' },
      el('div', { className: 'meter-head' },
        el('span', {}, 'Já foi podado'),
        el('strong', {}, `${wins}x`)
      ),
      el('div', { className: 'meter-bar' }, meterFill(level))
    ),
    el('span', { className: 'card-cta', 'aria-hidden': 'true' },
      icon('shears'),
      el('span', { className: 'cta-long' }, 'Poda severa!'),
      el('span', { className: 'cta-short' }, 'Podar!')
    )
  );

  // Até a foto estar decodificada a moldura mostra o skeleton; depois a foto aparece com fade
  frame.classList.add('loading');
  card.ready = whenDecoded(frame.querySelector('img'), IMAGE_WAIT_MS).then(() => frame.classList.remove('loading'));
  return card;
}

function meterFill(level) {
  const fill = el('div', { className: 'meter-fill' });
  fill.style.setProperty('--level', String(level));
  return fill;
}

function renderMosaic(celebrities) {
  const columns = Math.ceil(window.innerWidth / MOSAIC_CELL_PX);
  const rows = Math.ceil(window.innerHeight / MOSAIC_CELL_PX);
  const count = Math.min(columns * rows, MOSAIC_MAX_TILES);
  // As mesmas 11 fotos se repetem: nenhum download a mais
  const tiles = Array.from({ length: count }, (_, i) =>
    celebImage(celebrities[i % celebrities.length], { alt: '', sizes: DUEL_IMAGE_SIZES })
  );
  mosaicBg.replaceChildren(...tiles);
}

function updateProgress() {
  currentRoundEl.textContent = Math.min(game.round, game.totalRounds);
  progressFill.style.transform = `scaleX(${(game.round - 1) / game.totalRounds})`;
}

// O escolhido fica na mira (e no lugar); o outro se salva e sai voando.
// O próximo desafiante cai na vaga de quem se salvou.
async function handleChoice(celebrityId) {
  if (busy || !game.choose(celebrityId)) return;
  busy = true;

  const marked = cards.get(celebrityId);
  const saved = [...duelContainer.children].find(card => card !== marked);
  for (const card of duelContainer.children) card.disabled = true;
  marked.classList.add('marked');
  saved.append(savedBurst());
  saved.classList.add('saved');
  playSave();
  updateProgress();

  await sleep(LEAVE_MS);

  if (game.finished) {
    showFinal();
    return;
  }

  const next = cardFor(game.challenger);
  await Promise.race([next.ready, sleep(NEXT_CARD_WAIT_MS)]);
  saved.replaceWith(next);
  next.classList.add('dropping');
  next.addEventListener('animationend', () => next.classList.remove('dropping'), { once: true });
  marked.classList.remove('marked');

  marked.disabled = false;
  next.disabled = false;
  busy = false;
  prefetchFinalIfLastDuel();
}

// Estrelinhas que explodem de quem se salvou
function savedBurst() {
  const stars = Array.from({ length: 8 }, (_, i) => {
    const star = icon('sparkle');
    star.style.setProperty('--a', `${i * 45 + Math.random() * 20}deg`);
    star.style.setProperty('--r', `${70 + Math.random() * 40}px`);
    star.style.setProperty('--c', BURST_COLORS[i % BURST_COLORS.length]);
    return star;
  });
  return el('span', { className: 'saved-burst', 'aria-hidden': 'true' }, stars);
}

// No último duelo, a foto grande do fim dos dois finalistas já começa a carregar
function prefetchFinalIfLastDuel() {
  if (game.round !== game.totalRounds) return;
  for (const celeb of [game.survivor, game.challenger]) {
    finalFrames.set(celeb.id, celebImage(celeb, { sizes: FINAL_IMAGE_SIZES }));
  }
}

// Fim: a tesoura corta a foto ao meio, a metade de baixo cai e entra o carimbo
async function showFinal() {
  const cut = game.winner;
  const top = finalFrames.get(cut.id) ?? celebImage(cut, { sizes: FINAL_IMAGE_SIZES });
  await whenDecoded(top.querySelector('img'), IMAGE_WAIT_MS);
  // Segunda cópia da mesma foto (já em cache) para a metade de baixo
  const bottom = celebImage(cut, { sizes: FINAL_IMAGE_SIZES, alt: '' });

  const finalCard = el('div', { className: 'final-card' },
    el('div', { className: 'final-photo' },
      el('div', { className: 'final-half top' }, top),
      el('div', { className: 'final-half bottom', 'aria-hidden': 'true' }, bottom)
    ),
    el('span', { className: 'snip', 'aria-hidden': 'true' }, el('span', { className: 'snip-blade' }, icon('shears'))),
    el('span', { className: 'final-stamp', 'aria-hidden': 'true' }, 'Cortado!')
  );
  winnerCard.replaceChildren(finalCard, el('h3', { className: 'final-name' }, cut.name));
  rankingPosition.textContent = 'Registrando o corte...';

  hide(gameScreen);
  hide(progressBox);
  show(winnerScreen);
  requestAnimationFrame(() => finalCard.classList.add('sliced'));
  playCut();
  confetti(confettiLayer);

  try {
    const { rank, wins } = await api('/api/game/winner', { method: 'POST', body: { gameId, winnerId: cut.id } });
    rankingPosition.replaceChildren(...describeStanding(rank, wins));
  } catch (err) {
    rankingPosition.textContent = `Não foi possível registrar o corte: ${err.message}`;
  }
}

function describeStanding(rank, wins) {
  if (wins === 1) {
    return [el('strong', {}, 'Primeiro corte!'), el('br'), `Entrou nos mais podados em ${rank}º lugar.`];
  }
  return [
    el('strong', {}, `${rank}º lugar`), ' entre os mais podados',
    el('br'), `${plural(wins, 'corte', 'cortes')} no total.`
  ];
}

function showStartScreen() {
  hide(gameScreen);
  hide(winnerScreen);
  hide(progressBox);
  show(startScreen, 'grid');
  game = null;
  gameId = null;
  cards = new Map();
  finalFrames = new Map();
  duelContainer.replaceChildren();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

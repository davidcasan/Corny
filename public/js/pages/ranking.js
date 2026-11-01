import { api } from '../api.js';
import { celebImage, el, hide, show } from '../dom.js';
import { plural } from '../game/state.js';
import { homeFor, requireLogin } from '../session.js';

const user = await requireLogin();

const rankingList = document.getElementById('rankingList');
const emptyMessage = document.getElementById('emptyMessage');
const globalTab = document.getElementById('globalTab');
const personalTab = document.getElementById('personalTab');
const title = document.getElementById('rankingTitle');
const subtitle = document.getElementById('rankingSubtitle');

const VIEWS = {
  global: {
    tab: globalTab,
    title: 'Mais cortados',
    subtitle: 'Quem mais foi cortado pela raiz',
    empty: ['Ninguém foi cortado ainda.', 'Jogue a primeira partida!'],
    load: async () => {
      const { ranking } = await api('/api/ranking');
      const top = ranking[0]?.wins || 1;
      return ranking.map(celeb => rankingItem({
        position: celeb.rank,
        rankClass: celeb.rank <= 3 ? `rank-${celeb.rank}` : '',
        celeb,
        detail: plural(celeb.wins, 'corte', 'cortes'),
        level: celeb.wins / top
      }));
    }
  },
  personal: {
    tab: personalTab,
    title: 'Meus cortes',
    subtitle: 'Quem você cortou pela raiz',
    empty: ['Você ainda não cortou ninguém.', 'Quem você cortar aparece aqui.'],
    load: async () => {
      const { history } = await api('/api/ranking/personal');
      return history.map((item, index) => rankingItem({
        position: history.length - index,
        celeb: item,
        detail: formatDate(item.played_at)
      }));
    }
  }
};

if (user.isAdmin) {
  const adminBtn = document.getElementById('adminBtn');
  show(adminBtn, 'inline-flex');
  adminBtn.addEventListener('click', () => { window.location.href = '/admin'; });
}

const goHome = () => { window.location.href = homeFor(user); };
document.getElementById('backBtn').addEventListener('click', goHome);
document.getElementById('closeBtn').addEventListener('click', goHome);
globalTab.addEventListener('click', () => showView('global'));
personalTab.addEventListener('click', () => showView('personal'));

showView('global');

async function showView(name) {
  const view = VIEWS[name];
  for (const v of Object.values(VIEWS)) {
    v.tab.classList.toggle('active', v === view);
    v.tab.setAttribute('aria-selected', String(v === view));
  }
  title.textContent = view.title;
  subtitle.textContent = view.subtitle;

  try {
    const items = await view.load();
    if (items.length === 0) {
      showEmpty(view.empty);
    } else {
      hide(emptyMessage);
      rankingList.replaceChildren(...items);
      show(rankingList, 'flex');
    }
  } catch (err) {
    showEmpty([`Não foi possível carregar: ${err.message}`]);
  }
}

function showEmpty(lines) {
  hide(rankingList);
  emptyMessage.replaceChildren(...lines.map(line => el('p', {}, line)));
  show(emptyMessage);
}

function rankingItem({ position, rankClass = '', celeb, detail, level }) {
  let meter = null;
  if (level !== undefined) {
    const fill = el('div', { className: 'meter-fill' });
    fill.style.setProperty('--level', String(level));
    meter = el('div', { className: 'meter-bar', 'aria-hidden': 'true' }, fill);
  }
  return el('li', { className: `ranking-item ${rankClass}`.trim() },
    el('div', { className: 'ranking-position' }, String(position)),
    celebImage(celeb, { className: 'ranking-image', loading: 'lazy', sizes: '60px' }),
    el('div', { className: 'ranking-info' },
      el('div', { className: 'ranking-name' }, celeb.name),
      el('div', { className: 'ranking-wins' }, detail),
      meter
    )
  );
}

// SQLite grava em UTC sem fuso ("2026-02-19 13:45:00")
function formatDate(sqliteDate) {
  return new Date(`${sqliteDate.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

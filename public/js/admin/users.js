import { api } from '../api.js';
import { celebImage, el, hide, showMessage } from '../dom.js';
import { formatDate, searchKey } from '../format.js';
import { plural } from '../game/state.js';
import { openDialog, openFormDialog } from './dialog.js';

// Aba "Jogadores" do admin: lista, cria, edita (nome, senha, admin) e mostra as partidas.
// As senhas ficam só como hash no servidor: dá para definir uma nova, não para ver a atual.

const MAIN_ADMIN = 'admin';
const MAX_USERNAME_LENGTH = 30;

const list = document.getElementById('usersList');
const count = document.getElementById('usersCount');
const filter = document.getElementById('usersFilter');
const message = document.getElementById('usersMessage');
const newName = document.getElementById('newUserName');
const newPassword = document.getElementById('newUserPassword');
const newIsAdmin = document.getElementById('newUserAdmin');
const createBtn = document.getElementById('createUserBtn');

let users = [];
let started = false;

export function initUsersTab() {
  if (started) return;
  started = true;

  filter.addEventListener('input', render);
  document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    createBtn.disabled = true;
    try {
      const { user } = await api('/api/admin/users', {
        method: 'POST',
        body: { username: newName.value, password: newPassword.value, isAdmin: newIsAdmin.checked }
      });
      showMessage(message, `Jogador "${user.username}" criado.`);
      newName.value = '';
      newPassword.value = '';
      newIsAdmin.checked = false;
      await load();
    } catch (err) {
      showMessage(message, err.message, 'error');
    } finally {
      createBtn.disabled = false;
    }
  });

  load();
}

async function load() {
  try {
    ({ users } = await api('/api/admin/users'));
    render();
  } catch (err) {
    showMessage(message, `Não foi possível carregar os jogadores: ${err.message}`, 'error');
  }
}

function render() {
  const query = searchKey(filter.value.trim());
  const visible = users.filter(u => !query || searchKey(u.username).includes(query));
  count.textContent = users.length;

  if (visible.length === 0) {
    list.replaceChildren(el('p', { className: 'empty-ranking' }, query ? 'Nenhum jogador com esse nome.' : 'Nenhum jogador ainda.'));
    return;
  }
  list.replaceChildren(...visible.map(userRow));
}

function userRow(user) {
  const meta = plural(user.games, 'partida', 'partidas') + (user.lastPlayed ? ` · última em ${formatDate(user.lastPlayed)}` : '');

  return el('div', { className: 'user-row' },
    el('div', { className: 'user-main' },
      el('span', { className: 'user-name' }, user.username),
      user.isAdmin && el('span', { className: 'pill pill-cyan' }, 'Admin'),
      user.legacyPassword && el('span', {
        className: 'pill pill-yellow',
        title: 'Senha guardada do jeito antigo, sem criptografia. Vira criptografada no próximo login da pessoa ou quando você definir uma nova.'
      }, 'Senha antiga')
    ),
    el('p', { className: 'user-meta' }, meta),
    el('div', { className: 'user-actions' },
      el('button', { type: 'button', className: 'btn-secondary btn-small', onClick: () => editUser(user) }, 'Editar'),
      el('button', { type: 'button', className: 'btn-secondary btn-small', disabled: user.games === 0, onClick: () => showGames(user) }, 'Partidas')
    )
  );
}

async function editUser(user) {
  const isMainAdmin = user.username === MAIN_ADMIN;
  const saved = await openFormDialog({
    title: `Editar ${user.username}`,
    hint: 'A senha atual não pode ser vista (fica guardada criptografada). Para trocar, digite uma nova; deixe vazio para manter.',
    fields: [
      { name: 'username', label: 'Nome', value: user.username, maxLength: MAX_USERNAME_LENGTH, disabled: isMainAdmin,
        help: isMainAdmin ? 'A conta "admin" principal não pode ser renomeada.' : null },
      { name: 'password', label: 'Nova senha', type: 'password', placeholder: 'Deixe vazio para manter a atual' },
      { name: 'isAdmin', label: 'Pode acessar o painel admin', type: 'checkbox', value: user.isAdmin, disabled: isMainAdmin }
    ],
    onSubmit: (values) => api(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      body: {
        ...(isMainAdmin ? {} : { username: values.username, isAdmin: values.isAdmin }),
        password: values.password
      }
    })
  });
  if (!saved) return;

  const changedPassword = saved.user && !saved.user.legacyPassword && user.legacyPassword;
  showMessage(message, saved.note || `Jogador "${saved.user.username}" atualizado.${changedPassword ? ' Senha agora criptografada.' : ''}`, saved.note ? 'warning' : 'success');
  await load();
}

async function showGames(user) {
  let data;
  try {
    data = await api(`/api/admin/users/${user.id}/games`);
  } catch (err) {
    showMessage(message, err.message, 'error');
    return;
  }

  const rows = data.games.map(game =>
    el('li', { className: 'history-item' },
      celebImage({ ...game, name: game.name }, { className: 'history-thumb', loading: 'lazy', sizes: '44px' }),
      el('div', { className: 'history-info' },
        el('span', { className: 'history-name' }, game.name + (game.deleted ? ' (excluída)' : '')),
        el('span', { className: 'history-date' }, formatDate(game.played_at))
      )
    )
  );
  const shown = data.total > data.games.length ? ` (mostrando as ${data.games.length} mais recentes)` : '';

  openDialog({
    title: `Partidas de ${data.username}`,
    content: el('div', {},
      el('p', { className: 'focal-hint' }, `${plural(data.total, 'partida', 'partidas')}${shown}. Em cada uma, quem foi cortado pela raiz:`),
      el('ol', { className: 'history-list' }, rows)
    )
  });
  hide(message);
}

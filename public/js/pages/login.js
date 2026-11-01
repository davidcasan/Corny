import { api } from '../api.js';
import { showMessage } from '../dom.js';
import { setupFullscreenButton } from '../fullscreen.js';
import { fetchCurrentUser, homeFor } from '../session.js';

const form = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const messageDiv = document.getElementById('message');

setupFullscreenButton(document.getElementById('fullscreenBtnLogin'));

// Já logado: vai direto para o jogo (ou painel)
const existing = await fetchCurrentUser();
if (existing) {
  window.location.replace(homeFor(existing));
}

// Enter em qualquer campo envia o formulário
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showMessage(messageDiv, 'Preencha o nome e a senha.', 'error');
    (username ? passwordInput : usernameInput).focus();
    return;
  }

  loginBtn.disabled = true;
  try {
    const data = await api('/api/login', { method: 'POST', body: { username, password } });
    showMessage(messageDiv, data.newUser ? 'Conta criada. Bora podar!' : 'Entrando...');
    setTimeout(() => window.location.replace(homeFor(data.user)), 500);
  } catch (err) {
    showMessage(messageDiv, err.message, 'error');
    loginBtn.disabled = false;
  }
});

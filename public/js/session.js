import { api } from './api.js';

export async function fetchCurrentUser() {
  try {
    const { user } = await api('/api/me');
    return user;
  } catch {
    return null;
  }
}

// Garante que há alguém logado; senão volta para o login.
// Com { admin: true } exige admin; com { admin: false } manda o admin para o painel.
export async function requireLogin({ admin } = {}) {
  const user = await fetchCurrentUser();
  if (!user) {
    window.location.replace('/');
    return new Promise(() => {}); // Página está saindo; não continua a execução
  }
  if (admin === true && !user.isAdmin) {
    window.location.replace('/game');
    return new Promise(() => {});
  }
  if (admin === false && user.isAdmin) {
    window.location.replace('/admin');
    return new Promise(() => {});
  }
  return user;
}

export function homeFor(user) {
  return user.isAdmin ? '/admin' : '/game';
}

export async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } finally {
    window.location.replace('/');
  }
}

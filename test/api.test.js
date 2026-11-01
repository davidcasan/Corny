import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { ensureAdminUser } from '../server/auth.js';
import { createCelebrityImages } from '../server/celebrity-images.js';
import { SCHEMA_VERSION, openDatabase } from '../server/db.js';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');

// Cliente HTTP mínimo que guarda o cookie de sessão
function client(baseUrl) {
  let cookie = '';
  return async function request(method, url, body) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}

let db;
let server;
let baseUrl;
const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2k-api-img-'));

before(async () => {
  db = openDatabase(':memory:');
  ensureAdminUser(db, 'senha-admin');
  const searchImages = async (name) => name === 'Ninguém'
    ? { images: [], stats: [] }
    : { images: [{ url: 'https://a.com/1.jpg', thumb: 'https://a.com/1t.jpg', source: 'Teste' }], stats: [{ id: 't', label: 'Teste', kept: 1, found: 1 }] };
  const celebrityImages = createCelebrityImages({ db, dir: imagesDir, allowPrivateHosts: true });
  server = createApp({ db, publicDir, imagesDir, celebrityImages, searchImages }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(imagesDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM game_history; DELETE FROM games; DELETE FROM celebrities;');
});

function seedCelebrities(n) {
  const insert = db.prepare('INSERT INTO celebrities (name, image_url) VALUES (?, ?)');
  for (let i = 1; i <= n; i++) insert.run(`Celeb ${i}`, `https://example.com/${i}.jpg`);
}

async function loggedIn(username, password = 'senha123') {
  const request = client(baseUrl);
  const res = await request('POST', '/api/login', { username, password });
  assert.equal(res.status, 200);
  return request;
}

describe('login', () => {
  it('cria a conta no primeiro acesso e depois exige a mesma senha', async () => {
    const first = await client(baseUrl)('POST', '/api/login', { username: 'maria', password: 'abc' });
    assert.equal(first.data.newUser, true);

    const wrong = await client(baseUrl)('POST', '/api/login', { username: 'maria', password: 'xyz' });
    assert.equal(wrong.status, 401);

    const again = await client(baseUrl)('POST', '/api/login', { username: 'maria', password: 'abc' });
    assert.equal(again.data.newUser, false);
  });

  it('a senha é gravada com hash', async () => {
    await client(baseUrl)('POST', '/api/login', { username: 'hashuser', password: 'minhasenha' });
    const row = db.prepare("SELECT password FROM users WHERE username = 'hashuser'").get();
    assert.match(row.password, /^scrypt\$/);
  });

  it('senha legada em texto puro funciona e é convertida para hash', async () => {
    db.prepare("INSERT INTO users (username, password) VALUES ('antigo', 'velha')").run();
    const res = await client(baseUrl)('POST', '/api/login', { username: 'antigo', password: 'velha' });
    assert.equal(res.status, 200);
    const row = db.prepare("SELECT password FROM users WHERE username = 'antigo'").get();
    assert.match(row.password, /^scrypt\$/);
  });

  it('bloqueia após muitas tentativas erradas', async () => {
    await client(baseUrl)('POST', '/api/login', { username: 'alvo', password: 'certa' });
    let last;
    for (let i = 0; i < 11; i++) {
      last = await client(baseUrl)('POST', '/api/login', { username: 'alvo', password: 'errada' });
    }
    assert.equal(last.status, 429);
  });

  it('/api/me reflete a sessão e o logout a encerra', async () => {
    const request = await loggedIn('sessao');
    assert.equal((await request('GET', '/api/me')).data.user.username, 'sessao');
    await request('POST', '/api/logout');
    assert.equal((await request('GET', '/api/me')).data.user, null);
  });
});

describe('admin', () => {
  it('rotas de admin exigem login de admin', async () => {
    const anon = client(baseUrl);
    assert.equal((await anon('GET', '/api/admin/celebrities')).status, 401);
    assert.equal((await anon('POST', '/api/admin/add-celebrity', { name: 'X', imageUrl: 'https://a.com/x.jpg' })).status, 401);
    assert.equal((await anon('DELETE', '/api/admin/celebrity/1')).status, 401);

    const player = await loggedIn('jogador');
    assert.equal((await player('GET', '/api/admin/celebrities')).status, 403);
    assert.equal((await player('DELETE', '/api/admin/celebrity/1')).status, 403);
  });

  it('o admin adiciona, lista e exclui', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    const added = await admin('POST', '/api/admin/add-celebrity', { name: 'Anitta', imageUrl: 'https://a.com/anitta.jpg' });
    assert.equal(added.status, 200);

    const list = await admin('GET', '/api/admin/celebrities');
    assert.deepEqual(list.data.celebrities.map(c => c.name), ['Anitta']);

    assert.equal((await admin('DELETE', `/api/admin/celebrity/${added.data.id}`)).status, 200);
    assert.equal((await admin('GET', '/api/admin/celebrities')).data.celebrities.length, 0);
    assert.equal((await admin('DELETE', `/api/admin/celebrity/${added.data.id}`)).status, 404);
  });

  it('impede duplicata ignorando acentos e maiúsculas', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    await admin('POST', '/api/admin/add-celebrity', { name: 'Xuxa Meneghel', imageUrl: 'https://a.com/1.jpg' });
    const dup = await admin('POST', '/api/admin/add-celebrity', { name: '  XÚXA   meneghel ', imageUrl: 'https://a.com/2.jpg' });
    assert.equal(dup.status, 409);
  });

  it('busca de imagens devolve opções com fonte e estatísticas', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    const found = await admin('GET', '/api/admin/search-image?name=Anitta');
    assert.equal(found.status, 200);
    assert.equal(found.data.images[0].source, 'Teste');
    assert.equal(found.data.stats[0].kept, 1);

    const none = await admin('GET', `/api/admin/search-image?name=${encodeURIComponent('Ninguém')}`);
    assert.equal(none.status, 404);
    assert.match(none.data.message, /Nenhuma imagem/);
  });

  it('rejeita URL de imagem perigosa', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    const res = await admin('POST', '/api/admin/add-celebrity', { name: 'Hacker', imageUrl: 'javascript:alert(1)' });
    assert.equal(res.status, 400);
  });

  it('aceita upload de imagem maior que 100 KB e guarda no servidor', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    // Ruído aleatório não comprime: JPEG bem acima de 100 KB
    const noise = await sharp(Buffer.from(Array.from({ length: 600 * 800 * 3 }, () => Math.random() * 255)), { raw: { width: 600, height: 800, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    assert.ok(noise.length > 100 * 1024);
    const res = await admin('POST', '/api/admin/add-celebrity', { name: 'Grande', imageUrl: `data:image/jpeg;base64,${noise.toString('base64')}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.warning, null);

    const [celeb] = (await admin('GET', '/api/admin/celebrities')).data.celebrities;
    assert.equal(celeb.image_stored, true);
    assert.equal(celeb.image_srcset.split(", ").length, 2, "320w e 600w (sem ampliar)");

    const file = await fetch(baseUrl + celeb.image_url);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/webp');
    assert.match(file.headers.get('cache-control'), /immutable/);
  });

  it('avisa quando a imagem não pode ser guardada, mas cadastra mesmo assim', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    const res = await admin('POST', '/api/admin/add-celebrity', { name: 'Quebrada', imageUrl: `${baseUrl}/nao-existe.jpg` });
    assert.equal(res.status, 200);
    assert.match(res.data.warning, /link original/);
  });

  it('salva o ponto de enquadramento e ele aparece no jogo', async () => {
    const admin = await loggedIn('admin', 'senha-admin');
    seedCelebrities(11);
    const id = db.prepare('SELECT id FROM celebrities LIMIT 1').get().id;

    assert.equal((await admin('PUT', `/api/admin/celebrity/${id}/focal`, { x: 'abc', y: 1 })).status, 400);
    const saved = await admin('PUT', `/api/admin/celebrity/${id}/focal`, { x: 130, y: 33.333, zoom: 5 });
    assert.equal(saved.data.focal_x, 100);
    assert.equal(saved.data.focal_y, 33.3);
    assert.equal(saved.data.focal_zoom, 3);

    const start = await admin('GET', '/api/game/start');
    const celeb = start.data.celebrities.find(c => c.id === id);
    assert.equal(celeb.focal_x, 100);
    assert.equal(celeb.focal_zoom, 3);
    const other = start.data.celebrities.find(c => c.id !== id);
    assert.equal(other.focal_y, 25);
    assert.equal(other.focal_zoom, 1);
  });
});

describe('jogo', () => {
  it('exige login', async () => {
    assert.equal((await client(baseUrl)('GET', '/api/game/start')).status, 401);
  });

  it('avisa quando não há celebridades suficientes', async () => {
    seedCelebrities(5);
    const player = await loggedIn('poucos');
    const res = await player('GET', '/api/game/start');
    assert.equal(res.status, 400);
    assert.match(res.data.message, /Disponível: 5/);
  });

  it('partida completa: sorteia 11, registra vitória uma única vez', async () => {
    seedCelebrities(15);
    const player = await loggedIn('completo');

    const start = await player('GET', '/api/game/start');
    assert.equal(start.data.celebrities.length, 11);
    assert.equal(start.data.maxWins, 0);
    assert.equal(start.data.celebrities[0].wins, 0);
    assert.equal(new Set(start.data.celebrities.map(c => c.id)).size, 11);

    const winnerId = start.data.celebrities[4].id;
    const win = await player('POST', '/api/game/winner', { gameId: start.data.gameId, winnerId });
    assert.equal(win.status, 200);
    assert.equal(win.data.wins, 1);
    assert.equal(win.data.rank, 1);

    const repeat = await player('POST', '/api/game/winner', { gameId: start.data.gameId, winnerId });
    assert.equal(repeat.status, 404);
  });

  it('não aceita vencedor que não estava na partida', async () => {
    seedCelebrities(15);
    const player = await loggedIn('trapaca');
    const start = await player('GET', '/api/game/start');
    const inGame = new Set(start.data.celebrities.map(c => c.id));
    const outsider = db.prepare('SELECT id FROM celebrities').all().find(c => !inGame.has(c.id));

    const res = await player('POST', '/api/game/winner', { gameId: start.data.gameId, winnerId: outsider.id });
    assert.equal(res.status, 400);
  });

  it('um jogador não fecha a partida de outro', async () => {
    seedCelebrities(11);
    const owner = await loggedIn('dono');
    const other = await loggedIn('intruso');
    const start = await owner('GET', '/api/game/start');

    const res = await other('POST', '/api/game/winner', { gameId: start.data.gameId, winnerId: start.data.celebrities[0].id });
    assert.equal(res.status, 404);
  });

  it('não sorteia celebridades excluídas', async () => {
    seedCelebrities(12);
    db.prepare("UPDATE celebrities SET deleted_at = datetime('now') WHERE id IN (SELECT id FROM celebrities LIMIT 1)").run();
    const player = await loggedIn('excluidas');
    const start = await player('GET', '/api/game/start');
    const deleted = db.prepare('SELECT id FROM celebrities WHERE deleted_at IS NOT NULL').get().id;
    assert.ok(!start.data.celebrities.some(c => c.id === deleted));
  });
});

describe('ranking', () => {
  it('empates recebem a mesma posição', async () => {
    seedCelebrities(4);
    db.exec("UPDATE celebrities SET wins = CASE name WHEN 'Celeb 1' THEN 5 WHEN 'Celeb 2' THEN 3 WHEN 'Celeb 3' THEN 3 ELSE 1 END");
    const player = await loggedIn('ranking');
    const { ranking } = (await player('GET', '/api/ranking')).data;
    assert.deepEqual(ranking.map(r => r.rank), [1, 2, 2, 4]);
  });

  it('histórico pessoal mantém vencedores excluídos depois', async () => {
    seedCelebrities(11);
    const player = await loggedIn('historico');
    const start = await player('GET', '/api/game/start');
    const winner = start.data.celebrities[0];
    await player('POST', '/api/game/winner', { gameId: start.data.gameId, winnerId: winner.id });

    db.prepare("UPDATE celebrities SET deleted_at = datetime('now') WHERE id = ?").run(winner.id);

    const { history } = (await player('GET', '/api/ranking/personal')).data;
    assert.equal(history.length, 1);
    assert.equal(history[0].name, winner.name);

    const { ranking } = (await player('GET', '/api/ranking')).data;
    assert.ok(!ranking.some(r => r.id === winner.id));
  });
});

describe('páginas e segurança', () => {
  it('serve as páginas com CSP sem script inline', async () => {
    const res = await fetch(`${baseUrl}/game`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.doesNotMatch(await res.text(), /<script>/);
  });

  it('rota de API desconhecida devolve 404 em JSON', async () => {
    const res = await client(baseUrl)('GET', '/api/nada');
    assert.equal(res.status, 404);
    assert.equal(res.data.success, false);
  });
});

describe('migração', () => {
  it('converte um banco v1 mantendo os dados e cria backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2k-'));
    const dbPath = path.join(dir, 'legado.db');

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, is_admin INTEGER DEFAULT 0);
      CREATE TABLE celebrities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, image_url TEXT NOT NULL, wins INTEGER DEFAULT 0);
      CREATE TABLE game_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, winner_id INTEGER NOT NULL, played_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO users (username, password, is_admin) VALUES ('admin', 'admin', 1);
      INSERT INTO celebrities (name, image_url, wins) VALUES ('Neymar', 'https://a.com/n.jpg', 3);
      INSERT INTO game_history (user_id, winner_id) VALUES (1, 1);
    `);
    legacy.close();

    const migrated = openDatabase(dbPath);
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(migrated.prepare('SELECT wins FROM celebrities').get().wins, 3);
    assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM game_history').get().n, 1);
    assert.equal(ensureAdminUser(migrated, null).usingDefaultPassword, true);
    migrated.close();

    assert.ok(fs.existsSync(`${dbPath}.bak-v0`));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

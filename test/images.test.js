import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { createCelebrityImages } from '../server/celebrity-images.js';
import { openDatabase } from '../server/db.js';
import { decodeDataUrl, downloadImage, isPrivateAddress, presentImage, storeImage } from '../server/images.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c2k-img-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function jpeg(width, height, extra = (s) => s) {
  return extra(sharp({ create: { width, height, channels: 3, background: '#c33' } })).jpeg().toBuffer();
}

describe('storeImage', () => {
  it('gera os 3 tamanhos em WebP sem ampliar', async () => {
    const dir = path.join(tmp, 'grande');
    const stored = await storeImage(await jpeg(1600, 2000), { dir, prefix: 'c1' });
    assert.deepEqual(stored.widths, [320, 640, 960]);
    assert.equal(stored.width, 1600);
    for (const w of stored.widths) {
      const meta = await sharp(path.join(dir, `${stored.base}-${w}.webp`)).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, w);
    }
  });

  it('imagem pequena não é ampliada', async () => {
    const stored = await storeImage(await jpeg(500, 700), { dir: path.join(tmp, 'pequena'), prefix: 'c2' });
    assert.deepEqual(stored.widths, [320, 500]);
  });

  it('corrige a rotação EXIF (foto de celular "deitada")', async () => {
    const dir = path.join(tmp, 'exif');
    // 1200x800 com orientação 6 = foto em pé de 800x1200
    const rotated = await jpeg(1200, 800, s => s.withMetadata({ orientation: 6 }));
    const stored = await storeImage(rotated, { dir, prefix: 'c3' });
    assert.equal(stored.width, 800);
    assert.equal(stored.height, 1200);
    const meta = await sharp(path.join(dir, `${stored.base}-640.webp`)).metadata();
    assert.ok(meta.height > meta.width, 'arquivo gravado já em pé');
  });

  it('rejeita arquivo que não é imagem', async () => {
    await assert.rejects(storeImage(Buffer.from('não sou imagem'), { dir: path.join(tmp, 'x'), prefix: 'c4' }), /inválido/);
  });

  it('o nome muda quando a imagem muda (cache pode ser eterno)', async () => {
    const dir = path.join(tmp, 'hash');
    const a = await storeImage(await jpeg(400, 400), { dir, prefix: 'c5' });
    const b = await storeImage(await jpeg(401, 400), { dir, prefix: 'c5' });
    assert.notEqual(a.base, b.base);
  });
});

describe('utilitários de imagem', () => {
  it('reconhece endereços da rede interna', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.0.10', '172.20.1.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:192.168.1.1']) {
      assert.ok(isPrivateAddress(ip), ip);
    }
    for (const ip of ['8.8.8.8', '200.147.67.142', '172.32.0.1', '2606:4700::1']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it('decodifica data URL', () => {
    assert.deepEqual(decodeDataUrl('data:image/png;base64,AQID'), Buffer.from([1, 2, 3]));
    assert.throws(() => decodeDataUrl('data:text/html;base64,AQID'));
  });

  it('presentImage usa os arquivos locais quando existem', () => {
    const local = presentImage({ image_url: 'https://a.com/x.jpg', image_base: 'c1-abc', image_widths: '[320,640]', image_width: 800, image_height: 1000, focal_x: 40, focal_y: 20 });
    assert.equal(local.image_url, '/images/c1-abc-640.webp');
    assert.equal(local.image_srcset, '/images/c1-abc-320.webp 320w, /images/c1-abc-640.webp 640w');
    assert.equal(local.focal_x, 40);

    const remote = presentImage({ image_url: 'https://a.com/x.jpg' });
    assert.equal(remote.image_url, 'https://a.com/x.jpg');
    assert.equal(remote.image_srcset, null);
    assert.equal(remote.focal_y, 25);
  });
});

describe('createCelebrityImages', () => {
  let server;
  let base;
  let db;
  let images;

  before(async () => {
    const photo = await jpeg(900, 1200);
    const hits = new Map();
    server = http.createServer((req, res) => {
      const count = (hits.get(req.url) ?? 0) + 1;
      hits.set(req.url, count);
      if (req.url === '/limite-uma-vez.jpg' && count === 1 || req.url === '/limite-sempre.jpg') {
        res.writeHead(429, { 'Retry-After': '1' });
        res.end();
      } else if (req.url === '/foto.jpg' || req.url === '/limite-uma-vez.jpg') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(photo);
      } else if (req.url === '/pagina') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html></html>');
      } else {
        res.writeHead(403);
        res.end();
      }
    }).listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    db = openDatabase(':memory:');
    images = createCelebrityImages({ db, dir: path.join(tmp, 'celebs'), allowPrivateHosts: true, batchDelayMs: 0 });
  });

  after(() => {
    server.close();
    db.close();
  });

  const insert = (name, url) => Number(db.prepare('INSERT INTO celebrities (name, image_url) VALUES (?, ?)').run(name, url).lastInsertRowid);
  const row = id => db.prepare('SELECT * FROM celebrities WHERE id = ?').get(id);

  it('baixa e guarda imagem de URL', async () => {
    const id = insert('Baixada', `${base}/foto.jpg`);
    const result = await images.store(id);
    assert.equal(result.stored, true);
    assert.equal(row(id).image_status, 'stored');
    assert.equal(row(id).image_url, `${base}/foto.jpg`, 'mantém o link original como referência');
    assert.ok(fs.existsSync(path.join(tmp, "celebs", `${row(id).image_base}-900.webp`)), "maior tamanho = largura original (900)");
  });

  it('upload em base64 vira arquivo e sai do banco', async () => {
    const dataUrl = `data:image/jpeg;base64,${(await jpeg(600, 800)).toString('base64')}`;
    const id = insert('Upload', dataUrl);
    await images.store(id);
    assert.match(row(id).image_url, /^\/images\/c\d+-[0-9a-f]+-600\.webp$/);
  });

  it('link que não é imagem ou bloqueado fica marcado com o motivo', async () => {
    const html = insert('Html', `${base}/pagina`);
    const blocked = insert('Bloqueada', `${base}/bloqueada.jpg`);
    assert.match((await images.store(html)).error, /não é uma imagem/);
    assert.match((await images.store(blocked)).error, /HTTP 403/);
    assert.equal(row(blocked).image_status, 'failed');
    assert.match(row(blocked).image_error, /403/);
  });

  it('em HTTP 429 espera o Retry-After e tenta de novo', async () => {
    const id = insert('Limitada uma vez', `${base}/limite-uma-vez.jpg`);
    const started = Date.now();
    assert.equal((await images.store(id)).stored, true);
    assert.ok(Date.now() - started >= 900, 'respeitou o Retry-After de 1s');
  });

  it('429 persistente fica pendente (não vira falha permanente)', async () => {
    const id = insert('Limitada sempre', `${base}/limite-sempre.jpg`);
    const result = await images.store(id);
    assert.equal(result.stored, false);
    assert.equal(result.transient, true);
    assert.equal(row(id).image_status, null);
    assert.match(row(id).image_error, /429/);
    db.prepare("UPDATE celebrities SET image_status = 'failed' WHERE id = ?").run(id);
  });

  it('bloqueia endereço da rede interna por padrão', async () => {
    await assert.rejects(downloadImage(`${base}/foto.jpg`), /rede interna/);
  });

  it('processPending só processa quem ainda não foi tentado', async () => {
    const a = insert('Pendente A', `${base}/foto.jpg`);
    const b = insert('Pendente B', `${base}/foto.jpg`);
    const { total, failed } = await images.processPending();
    assert.equal(total, 2);
    assert.equal(failed, 0);
    assert.equal(row(a).image_status, 'stored');
    assert.equal(row(b).image_status, 'stored');
    assert.equal((await images.processPending()).total, 0);
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { dedupeKey, rejectReason } from '../server/search/filter.js';
import { createImageSearch } from '../server/search/index.js';
import { brave, braveEnabled } from '../server/search/sources/brave.js';
import { openverse, resetOpenversePause } from '../server/search/sources/openverse.js';
import { commons, wikidata, wikipedia } from '../server/search/sources/wikimedia.js';

const photo = (url, extra = {}) => ({ url, thumb: `${url}?thumb`, width: 800, height: 1000, ...extra });
const source = (id, search) => ({ id, label: id.toUpperCase(), search });

describe('dedupeKey', () => {
  it('reconhece o mesmo arquivo da Wikimedia em tamanhos e formatos de URL diferentes', () => {
    const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Anitta_2023.jpg';
    const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Anitta_2023.jpg/800px-Anitta_2023.jpg';
    const filePath = 'https://commons.wikimedia.org/wiki/Special:FilePath/Anitta_2023.jpg?width=800';
    assert.equal(dedupeKey(original), dedupeKey(thumb));
    assert.equal(dedupeKey(original), dedupeKey(filePath));
  });

  it('ignora a query string em outros sites', () => {
    assert.equal(dedupeKey('https://a.com/x.jpg?w=1'), dedupeKey('https://a.com/x.jpg?w=2'));
    assert.notEqual(dedupeKey('https://a.com/x.jpg'), dedupeKey('https://a.com/y.jpg'));
  });
});

describe('rejectReason', () => {
  it('aceita foto normal', () => {
    assert.equal(rejectReason(photo('https://a.com/x.jpg', { fileName: 'Pessoa.jpg' })), null);
  });

  it('aceita imagem sem tamanho conhecido', () => {
    assert.equal(rejectReason({ url: 'https://a.com/x.jpg' }), null);
  });

  it('descarta svg, logos, bandeiras e assinaturas', () => {
    assert.match(rejectReason(photo('https://a.com/1', { fileName: 'Brasao.svg' })), /não é foto/);
    assert.match(rejectReason(photo('https://a.com/2', { fileName: 'Globo_logo.png' })), /logo/);
    assert.match(rejectReason(photo('https://a.com/3', { fileName: 'Flag_of_Brazil.png' })), /logo/);
    assert.match(rejectReason(photo('https://a.com/4', { fileName: 'Assinatura_Pele.jpg' })), /logo/);
  });

  it('descarta imagens pequenas e banners', () => {
    assert.match(rejectReason(photo('https://a.com/x.jpg', { width: 120, height: 160 })), /pequena/);
    assert.match(rejectReason(photo('https://a.com/x.jpg', { width: 2000, height: 400 })), /banner/);
  });
});

describe('createImageSearch', () => {
  it('junta as fontes na ordem definida e remove duplicatas', async () => {
    const search = createImageSearch([
      source('a', async () => [photo('https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Foto.jpg/800px-Foto.jpg')]),
      source('b', async () => [photo('https://upload.wikimedia.org/wikipedia/commons/1/12/Foto.jpg'), photo('https://b.com/2.jpg')])
    ]);
    const { images, stats } = await search('Fulano');
    assert.deepEqual(images.map(i => i.source), ['A', 'B']);
    assert.equal(images[1].url, 'https://b.com/2.jpg');
    assert.equal(stats[1].discarded.duplicada, 1);
  });

  it('uma fonte com erro não derruba as outras', async () => {
    const search = createImageSearch([
      source('quebrada', async () => { throw new Error('HTTP 500'); }),
      source('boa', async () => [photo('https://b.com/1.jpg')])
    ]);
    const { images, stats } = await search('Fulano');
    assert.equal(images.length, 1);
    assert.equal(stats[0].error, 'HTTP 500');
  });

  it('respeita fonte desativada', async () => {
    const off = mock.fn(async () => [photo('https://x.com/1.jpg')]);
    const search = createImageSearch([{ ...source('off', off), enabled: () => false }]);
    const { images, stats } = await search('Fulano');
    assert.equal(images.length, 0);
    assert.equal(stats.length, 0);
    assert.equal(off.mock.callCount(), 0);
  });

  it('usa cache para o mesmo nome (ignorando acento e maiúsculas)', async () => {
    const fn = mock.fn(async () => [photo('https://b.com/1.jpg')]);
    const search = createImageSearch([source('a', fn)]);
    await search('João Silva');
    await search('joao silva');
    assert.equal(fn.mock.callCount(), 1);
  });

  it('não guarda resultado vazio no cache', async () => {
    const fn = mock.fn(async () => []);
    const search = createImageSearch([source('a', fn)]);
    await search('Ninguém');
    await search('Ninguém');
    assert.equal(fn.mock.callCount(), 2);
  });
});

// ==================== PARSERS DAS FONTES (fetch simulado) ====================

function mockFetch(routes) {
  return mock.method(globalThis, 'fetch', async (url) => {
    const match = routes.find(([pattern]) => String(url).includes(pattern));
    if (!match) return new Response('não mapeado', { status: 404 });
    const body = match[1];
    return typeof body === 'string' ? new Response(body) : Response.json(body);
  });
}

describe('fontes', () => {
  afterEach(() => mock.restoreAll());

  it('wikipedia devolve a foto principal dos artigos na ordem de relevância', async () => {
    mockFetch([['pt.wikipedia.org', {
      query: { pages: [
        { index: 2, title: 'Outro', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/B.jpg/800px-B.jpg' }, pageimage: 'B.jpg' },
        { index: 1, title: 'Anitta', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/A.jpg/960px-A.jpg?utm_source=pt.wikipedia.org' }, pageimage: 'A.jpg', original: { width: 2000, height: 3000 } },
        { index: 3, title: 'Sem foto' }
      ] }
    }]]);
    const images = await wikipedia('pt')('Anitta');
    assert.equal(images.length, 2);
    assert.match(images[0].url, /A\.jpg\?/);
    assert.match(images[0].thumb, /\/250px-A\.jpg$/);
    assert.equal(images[0].width, 2000);
  });

  it('wikidata pega a P18 das entidades encontradas', async () => {
    mockFetch([
      ['wbsearchentities', { search: [{ id: 'Q1' }, { id: 'Q2' }] }],
      ['wbgetentities', { entities: {
        Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Pessoa Famosa.jpg' } } }] } },
        Q2: { claims: {} }
      } }]
    ]);
    const images = await wikidata('Apelido');
    assert.equal(images.length, 1);
    assert.match(images[0].url, /Special:FilePath\/Pessoa_Famosa\.jpg\?width=800$/);
    assert.equal(images[0].fileName, 'Pessoa Famosa.jpg');
  });

  it('commons usa thumb de 800px e mantém nome do arquivo para o filtro', async () => {
    mockFetch([['commons.wikimedia.org', {
      query: { pages: [{ index: 1, title: 'File:Fulano 2020.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Fulano_2020.jpg/800px-Fulano_2020.jpg', width: 3000, height: 4000 }] }] }
    }]]);
    const [image] = await commons('Fulano');
    assert.equal(image.fileName, 'Fulano 2020.jpg');
    assert.equal(image.width, 3000);
  });

  it('brave só fica ativa com chave e manda a chave no cabeçalho', async () => {
    const previous = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    assert.equal(braveEnabled(), false);

    process.env.BRAVE_API_KEY = 'chave-teste';
    assert.equal(braveEnabled(), true);
    const fetchMock = mockFetch([['api.search.brave.com', {
      results: [{ properties: { url: 'https://site.com/a.jpg', width: 1200, height: 800 }, thumbnail: { src: 'https://imgs.search.brave.com/t' } }]
    }]]);
    const [image] = await brave('Fulano');
    assert.equal(image.url, 'https://site.com/a.jpg');
    assert.equal(image.thumb, 'https://imgs.search.brave.com/t');
    assert.equal(fetchMock.mock.calls[0].arguments[1].headers['X-Subscription-Token'], 'chave-teste');

    if (previous === undefined) delete process.env.BRAVE_API_KEY; else process.env.BRAVE_API_KEY = previous;
  });

  it('openverse faz uma consulta por vez (limite sem chave)', async () => {
    let running = 0;
    let maxRunning = 0;
    mock.method(globalThis, 'fetch', async () => {
      maxRunning = Math.max(maxRunning, ++running);
      await new Promise(r => setTimeout(r, 20));
      running--;
      return Response.json({ results: [{ url: 'https://live.staticflickr.com/1.jpg', thumbnail: 'https://api.openverse.org/t', width: 800, height: 600 }] });
    });
    const results = await Promise.all([openverse('A'), openverse('B'), openverse('C')]);
    assert.equal(maxRunning, 1);
    assert.equal(results.flat().length, 3);
  });

  it('openverse pausa após falha em vez de atrasar as próximas buscas', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('limite', { status: 429 }));
    await assert.rejects(openverse('A'), /HTTP 429/);
    await assert.rejects(openverse('B'), /pausada/);
    assert.equal(fetchMock.mock.callCount(), 1);
    resetOpenversePause();
  });
});

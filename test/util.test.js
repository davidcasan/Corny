import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, isLegacyPassword, verifyPassword } from '../server/auth.js';
import { cleanText, normalizeName } from '../server/util/text.js';
import { isValidImageUrl, parseId } from '../server/util/validate.js';

describe('normalizeName', () => {
  it('ignora acentos, maiúsculas e espaços extras', () => {
    assert.equal(normalizeName('  Ânitta   Larissa '), 'anitta larissa');
    assert.equal(normalizeName('JOÃO GUILHERME'), normalizeName('joao guilherme'));
  });
});

describe('cleanText', () => {
  it('colapsa espaços e corta no limite', () => {
    assert.equal(cleanText('  a   b  ', 10), 'a b');
    assert.equal(cleanText('abcdef', 3), 'abc');
    assert.equal(cleanText(42, 3), '');
  });
});

describe('isValidImageUrl', () => {
  it('aceita http(s) e data URL de imagem', () => {
    assert.ok(isValidImageUrl('https://upload.wikimedia.org/a.jpg'));
    assert.ok(isValidImageUrl('http://exemplo.com/a.png'));
    assert.ok(isValidImageUrl('data:image/jpeg;base64,/9j/4AAQ'));
  });

  it('rejeita esquemas perigosos e lixo', () => {
    assert.equal(isValidImageUrl('javascript:alert(1)'), false);
    assert.equal(isValidImageUrl('data:text/html;base64,PHNjcmlwdD4='), false);
    assert.equal(isValidImageUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
    assert.equal(isValidImageUrl('" onerror="alert(1)'), false);
    assert.equal(isValidImageUrl(''), false);
    assert.equal(isValidImageUrl(null), false);
  });
});

describe('parseId', () => {
  it('só inteiros positivos', () => {
    assert.equal(parseId('12'), 12);
    assert.equal(parseId(3), 3);
    assert.equal(parseId('0'), null);
    assert.equal(parseId('-1'), null);
    assert.equal(parseId('1.5'), null);
    assert.equal(parseId('abc'), null);
  });
});

describe('senhas', () => {
  it('hash confere com a senha certa e não com a errada', () => {
    const stored = hashPassword('segredo');
    assert.notEqual(stored, 'segredo');
    assert.ok(verifyPassword('segredo', stored));
    assert.equal(verifyPassword('outra', stored), false);
    assert.equal(isLegacyPassword(stored), false);
  });

  it('cada hash usa um salt diferente', () => {
    assert.notEqual(hashPassword('x'), hashPassword('x'));
  });

  it('ainda aceita senha legada em texto puro', () => {
    assert.ok(verifyPassword('admin', 'admin'));
    assert.equal(verifyPassword('admin', 'admin2'), false);
    assert.ok(isLegacyPassword('admin'));
  });
});

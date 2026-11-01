import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameState, plural } from '../public/js/game/state.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));

describe('GameState', () => {
  it('começa com o primeiro sorteado contra o segundo', () => {
    const game = new GameState(players(11));
    assert.equal(game.round, 1);
    assert.equal(game.totalRounds, 10);
    assert.equal(game.survivor.id, 1);
    assert.equal(game.challenger.id, 2);
    assert.equal(game.finished, false);
  });

  it('o escolhido continua e enfrenta o próximo', () => {
    const game = new GameState(players(11));
    assert.equal(game.choose(2), true);
    assert.equal(game.survivor.id, 2);
    assert.equal(game.challenger.id, 3);
    assert.equal(game.choose(2), true);
    assert.equal(game.challenger.id, 4);
  });

  it('termina após 10 duelos com o último sobrevivente como vencedor', () => {
    const game = new GameState(players(11));
    for (let i = 0; i < 10; i++) game.choose(game.challenger.id);
    assert.equal(game.finished, true);
    assert.equal(game.winner.id, 11);
    assert.equal(game.challenger, null);
    assert.equal(game.progress, 1);
  });

  it('ignora clique repetido de um duelo que já passou (clique duplo)', () => {
    const game = new GameState(players(11));
    const round = game.round;
    assert.equal(game.choose(1, round), true);
    // Segundo clique no mesmo card, ainda com o número do duelo antigo
    assert.equal(game.choose(1, round), false);
    assert.equal(game.round, 2);
  });

  it('rejeita escolher alguém fora do duelo atual', () => {
    const game = new GameState(players(11));
    assert.equal(game.choose(7), false);
    assert.equal(game.round, 1);
  });

  it('não aceita escolhas depois do fim', () => {
    const game = new GameState(players(2));
    game.choose(1);
    assert.equal(game.choose(2), false);
    assert.equal(game.winner.id, 1);
  });

  it('exige pelo menos 2 celebridades', () => {
    assert.throws(() => new GameState([]));
    assert.throws(() => new GameState(players(1)));
  });

  it('não altera o array recebido', () => {
    const list = players(3);
    const game = new GameState(list);
    game.choose(2);
    assert.equal(list.length, 3);
    assert.notEqual(game.players, list);
  });
});

describe('helpers', () => {
  it('plural', () => {
    assert.equal(plural(1, 'vitória', 'vitórias'), '1 vitória');
    assert.equal(plural(2, 'vitória', 'vitórias'), '2 vitórias');
    assert.equal(plural(0, 'vitória', 'vitórias'), '0 vitórias');
  });
});

// Lógica pura do jogo, sem DOM: roda igual no navegador e nos testes.
//
// O primeiro sorteado começa como sobrevivente e enfrenta cada um dos outros em ordem.
// Quem for escolhido continua; o último sobrevivente é o vencedor.

export class GameState {
  constructor(celebrities) {
    if (!Array.isArray(celebrities) || celebrities.length < 2) {
      throw new Error('São necessárias pelo menos 2 celebridades');
    }
    this.players = [...celebrities];
    this.round = 1;
    this.survivor = this.players[0];
  }

  get totalRounds() {
    return this.players.length - 1;
  }

  get finished() {
    return this.round > this.totalRounds;
  }

  get challenger() {
    return this.finished ? null : this.players[this.round];
  }

  get winner() {
    return this.finished ? this.survivor : null;
  }

  get progress() {
    return Math.min(this.round, this.totalRounds) / this.totalRounds;
  }

  // round: o duelo que o jogador estava vendo ao clicar.
  // Cliques atrasados ou repetidos de um duelo anterior são ignorados.
  choose(celebrityId, round = this.round) {
    if (this.finished || round !== this.round) return false;

    const current = [this.survivor, this.challenger];
    const chosen = current.find(c => c.id === celebrityId);
    if (!chosen) return false;

    this.survivor = chosen;
    this.round++;
    return true;
  }
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

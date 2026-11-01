import express from 'express';
import { requireUser } from '../auth.js';
import { transaction } from '../db.js';
import { presentImage } from '../images.js';
import { parseId } from '../util/validate.js';

export const PLAYERS_PER_GAME = 11;
const UNFINISHED_GAME_TTL_MS = 1000 * 60 * 60 * 24;

export function gameRoutes(db) {
  const router = express.Router();
  router.use(requireUser);

  const countActive = db.prepare('SELECT COUNT(*) AS n FROM celebrities WHERE deleted_at IS NULL');
  // Recorde de cortes: escala do medidor "Já foi cortado" nos cards
  const maxWins = db.prepare('SELECT COALESCE(MAX(wins), 0) AS n FROM celebrities WHERE deleted_at IS NULL');
  const drawRandom = db.prepare(`
    SELECT * FROM celebrities
    WHERE deleted_at IS NULL
    ORDER BY RANDOM() LIMIT ?
  `);
  const insertGame = db.prepare('INSERT INTO games (user_id, celebrity_ids, created_at) VALUES (?, ?, ?)');
  const purgeStaleGames = db.prepare('DELETE FROM games WHERE finished_at IS NULL AND created_at < ?');
  const findOpenGame = db.prepare('SELECT * FROM games WHERE id = ? AND user_id = ? AND finished_at IS NULL');
  const finishGame = db.prepare('UPDATE games SET finished_at = ? WHERE id = ?');
  const addWin = db.prepare('UPDATE celebrities SET wins = wins + 1 WHERE id = ?');
  const insertHistory = db.prepare('INSERT INTO game_history (user_id, winner_id, game_id) VALUES (?, ?, ?)');
  const winnerStanding = db.prepare(`
    SELECT c.wins,
      1 + (SELECT COUNT(*) FROM celebrities o WHERE o.deleted_at IS NULL AND o.wins > c.wins) AS rank
    FROM celebrities c WHERE c.id = ?
  `);

  // Sorteia as celebridades e registra a partida no servidor
  router.get('/start', (req, res) => {
    const available = countActive.get().n;
    if (available < PLAYERS_PER_GAME) {
      return res.status(400).json({
        success: false,
        message: `Não há celebridades suficientes. Necessário: ${PLAYERS_PER_GAME}, Disponível: ${available}`
      });
    }

    purgeStaleGames.run(Date.now() - UNFINISHED_GAME_TTL_MS);
    const celebrities = drawRandom.all(PLAYERS_PER_GAME).map(row => ({ id: row.id, name: row.name, wins: row.wins, ...presentImage(row) }));
    const ids = celebrities.map(c => c.id);
    const { lastInsertRowid } = insertGame.run(req.user.id, JSON.stringify(ids), Date.now());

    res.json({ success: true, gameId: Number(lastInsertRowid), celebrities, maxWins: maxWins.get().n });
  });

  // Registra o vencedor (quem o jogador cortou pela raiz). Só vale uma vez por partida e
  // para quem estava nela. No banco a coluna continua se chamando `wins`.
  router.post('/winner', (req, res) => {
    const gameId = parseId(req.body?.gameId);
    const winnerId = parseId(req.body?.winnerId);
    if (!gameId || !winnerId) {
      return res.status(400).json({ success: false, message: 'gameId e winnerId são obrigatórios' });
    }

    const game = findOpenGame.get(gameId, req.user.id);
    if (!game) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada ou já finalizada' });
    }
    if (!JSON.parse(game.celebrity_ids).includes(winnerId)) {
      return res.status(400).json({ success: false, message: 'Vencedor não faz parte desta partida' });
    }

    transaction(db, () => {
      addWin.run(winnerId);
      insertHistory.run(req.user.id, winnerId, gameId);
      finishGame.run(Date.now(), gameId);
    });

    const { wins, rank } = winnerStanding.get(winnerId);
    res.json({ success: true, wins, rank });
  });

  return router;
}

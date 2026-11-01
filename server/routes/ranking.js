import express from 'express';
import { requireUser } from '../auth.js';
import { presentImage } from '../images.js';

export function rankingRoutes(db) {
  const router = express.Router();
  router.use(requireUser);

  // RANK() dá a mesma posição para empates (1, 2, 2, 4...)
  const globalRanking = db.prepare(`
    SELECT *, RANK() OVER (ORDER BY wins DESC) AS rank
    FROM celebrities
    WHERE deleted_at IS NULL AND wins > 0
    ORDER BY wins DESC, id ASC
    LIMIT 100
  `);
  const personalHistory = db.prepare(`
    SELECT gh.id AS history_id, gh.played_at, c.*
    FROM game_history gh
    JOIN celebrities c ON c.id = gh.winner_id
    WHERE gh.user_id = ?
    ORDER BY gh.played_at DESC, gh.id DESC
    LIMIT 100
  `);

  router.get('/', (req, res) => {
    const ranking = globalRanking.all().map(row => ({
      id: row.id, name: row.name, wins: row.wins, rank: row.rank, ...presentImage(row)
    }));
    res.json({ success: true, ranking });
  });

  router.get('/personal', (req, res) => {
    const history = personalHistory.all(req.user.id).map(row => ({
      id: row.history_id, played_at: row.played_at, name: row.name, ...presentImage(row)
    }));
    res.json({ success: true, history });
  });

  return router;
}

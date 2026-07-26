import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ambFilter = (a) => (a === 'empresa' ? 'empresa' : a === 'pessoal' ? 'pessoal' : null);
const ambStore = (a) => (a === 'empresa' ? 'empresa' : 'pessoal');
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Metas por categoria + quanto já foi gasto no mês. ?month=YYYY-MM&ambito=
router.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const amb = ambFilter(req.query.ambito);
  const rows = db
    .prepare(`SELECT * FROM budgets WHERE user_id = ?${amb ? ' AND ambito = ?' : ''} ORDER BY category`)
    .all(...(amb ? [req.user.id, amb] : [req.user.id]));
  const spentStmt = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS s FROM transactions
     WHERE user_id = ? AND type = 'saida' AND ambito = ? AND category = ? AND substr(date,1,7) = ?`
  );
  res.json(rows.map((b) => ({
    ...b,
    month,
    spent: round(spentStmt.get(req.user.id, b.ambito, b.category, month).s),
  })));
});

router.post('/', (req, res) => {
  const { category, ambito, limit_amount } = req.body || {};
  const lim = Number(limit_amount);
  if (!category || !String(category).trim()) return res.status(400).json({ error: 'Categoria é obrigatória' });
  if (!(lim > 0)) return res.status(400).json({ error: 'Limite deve ser maior que zero' });
  db.prepare(
    `INSERT INTO budgets (user_id, category, ambito, limit_amount) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, ambito, category) DO UPDATE SET limit_amount = excluded.limit_amount`
  ).run(req.user.id, String(category).trim(), ambStore(ambito), lim);
  res.status(201).json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!b) return res.status(404).json({ error: 'Meta não encontrada' });
  db.prepare('DELETE FROM budgets WHERE id = ?').run(b.id);
  res.json({ ok: true });
});

export default router;

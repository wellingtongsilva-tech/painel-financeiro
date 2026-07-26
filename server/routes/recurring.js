import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ensureRecurring } from '../recurring.js';

const router = Router();
router.use(requireAuth);

const ambFilter = (a) => (a === 'empresa' ? 'empresa' : a === 'pessoal' ? 'pessoal' : null);
const ambStore = (a) => (a === 'empresa' ? 'empresa' : 'pessoal');
const validType = (t) => (t === 'entrada' ? 'entrada' : 'saida');
const clampDom = (d) => Math.min(Math.max(parseInt(d, 10) || 1, 1), 28);

router.get('/', (req, res) => {
  const amb = ambFilter(req.query.ambito);
  const rows = db
    .prepare(
      `SELECT * FROM recurring WHERE user_id = ?${amb ? ' AND ambito = ?' : ''}
       ORDER BY active DESC, day_of_month, id`
    )
    .all(...(amb ? [req.user.id, amb] : [req.user.id]));
  res.json(rows);
});

router.post('/', (req, res) => {
  const { type, amount, category, description, ambito, day_of_month } = req.body || {};
  const value = Number(amount);
  if (!(value > 0)) return res.status(400).json({ error: 'Valor deve ser maior que zero' });
  const info = db
    .prepare(
      `INSERT INTO recurring (user_id, type, amount, category, description, ambito, day_of_month)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, validType(type), value, (category || 'Outros').trim(), description || null, ambStore(ambito), clampDom(day_of_month));
  // materializa já no mês corrente
  ensureRecurring(req.user.id, new Date().toISOString().slice(0, 7));
  res.status(201).json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const r = getOwned(req);
  if (!r) return res.status(404).json({ error: 'Recorrência não encontrada' });
  const { type, amount, category, description, ambito, day_of_month, active } = req.body || {};
  db.prepare(
    `UPDATE recurring SET type = ?, amount = ?, category = ?, description = ?, ambito = ?, day_of_month = ?, active = ?
     WHERE id = ?`
  ).run(
    type ? validType(type) : r.type,
    amount != null ? Number(amount) : r.amount,
    category ?? r.category,
    description ?? r.description,
    ambito ? ambStore(ambito) : r.ambito,
    day_of_month != null ? clampDom(day_of_month) : r.day_of_month,
    active != null ? (active ? 1 : 0) : r.active,
    r.id
  );
  res.json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(r.id));
});

router.delete('/:id', (req, res) => {
  const r = getOwned(req);
  if (!r) return res.status(404).json({ error: 'Recorrência não encontrada' });
  db.prepare('DELETE FROM recurring WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

function getOwned(req) {
  return db.prepare('SELECT * FROM recurring WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
}

export default router;

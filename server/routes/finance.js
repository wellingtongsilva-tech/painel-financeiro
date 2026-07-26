import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ensureRecurring } from '../recurring.js';

const router = Router();
router.use(requireAuth);

// Âmbito: 'pessoal' | 'empresa'. Query inválida/ausente => sem filtro (tudo).
const ambFilter = (a) => (a === 'empresa' ? 'empresa' : a === 'pessoal' ? 'pessoal' : null);
const ambStore = (a) => (a === 'empresa' ? 'empresa' : 'pessoal'); // grava sempre um dos dois

// Lançamentos de um mês. ?month=YYYY-MM (padrão: mês atual) &ambito=pessoal|empresa
router.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
    ? req.query.month
    : new Date().toISOString().slice(0, 7);
  if (month === new Date().toISOString().slice(0, 7)) ensureRecurring(req.user.id, month);
  const amb = ambFilter(req.query.ambito);
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ?
       ${amb ? 'AND ambito = ?' : ''} ORDER BY date DESC, id DESC`
    )
    .all(...(amb ? [req.user.id, month, amb] : [req.user.id, month]));
  res.json({ month, ambito: amb, transactions: rows, summary: summarize(rows) });
});

// Contas a pagar em aberto (paid = 0), ordenadas por vencimento
router.get('/pending', (req, res) => {
  const amb = ambFilter(req.query.ambito);
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND type = 'saida' AND paid = 0
       ${amb ? 'AND ambito = ?' : ''} ORDER BY due_date IS NULL, due_date, id`
    )
    .all(...(amb ? [req.user.id, amb] : [req.user.id]));
  res.json(rows);
});

// Contas a RECEBER em aberto (entrada + paid = 0), ordenadas por previsão
router.get('/receivable', (req, res) => {
  const amb = ambFilter(req.query.ambito);
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND type = 'entrada' AND paid = 0
       ${amb ? 'AND ambito = ?' : ''} ORDER BY due_date IS NULL, due_date, id`
    )
    .all(...(amb ? [req.user.id, amb] : [req.user.id]));
  res.json(rows);
});

router.post('/', (req, res) => {
  const { type, amount, category, description, date, paid, due_date, ambito } = req.body || {};
  if (!['entrada', 'saida'].includes(type)) {
    return res.status(400).json({ error: 'Tipo deve ser "entrada" ou "saida"' });
  }
  const value = Number(amount);
  if (!(value > 0)) return res.status(400).json({ error: 'Valor deve ser maior que zero' });

  const info = db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount, category, description, date, paid, due_date, ambito)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      type,
      value,
      (category || 'Outros').trim(),
      description || null,
      date || new Date().toISOString().slice(0, 10),
      paid === 0 || paid === false ? 0 : 1,
      due_date || null,
      ambStore(ambito)
    );
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const tx = getOwned(req);
  if (!tx) return res.status(404).json({ error: 'Lançamento não encontrado' });
  const { type, amount, category, description, date, paid, due_date, ambito } = req.body || {};
  db.prepare(
    `UPDATE transactions SET type = ?, amount = ?, category = ?, description = ?, date = ?, paid = ?, due_date = ?, ambito = ?
     WHERE id = ?`
  ).run(
    type ?? tx.type,
    amount != null ? Number(amount) : tx.amount,
    category ?? tx.category,
    description ?? tx.description,
    date ?? tx.date,
    paid != null ? (paid ? 1 : 0) : tx.paid,
    due_date ?? tx.due_date,
    ambito ? ambStore(ambito) : tx.ambito,
    tx.id
  );
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
});

// Marca uma conta a pagar como paga
router.post('/:id/pay', (req, res) => {
  const tx = getOwned(req);
  if (!tx) return res.status(404).json({ error: 'Lançamento não encontrado' });
  db.prepare('UPDATE transactions SET paid = 1 WHERE id = ?').run(tx.id);
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
});

router.delete('/:id', (req, res) => {
  const tx = getOwned(req);
  if (!tx) return res.status(404).json({ error: 'Lançamento não encontrado' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  res.json({ ok: true });
});

function getOwned(req) {
  return db
    .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
}

function summarize(rows) {
  let entradas = 0,
    saidas = 0;
  const porCategoria = {};
  for (const t of rows) {
    if (t.type === 'entrada') entradas += t.amount;
    else {
      saidas += t.amount;
      porCategoria[t.category] = (porCategoria[t.category] || 0) + t.amount;
    }
  }
  return {
    entradas: round(entradas),
    saidas: round(saidas),
    saldo: round(entradas - saidas),
    porCategoria: Object.entries(porCategoria)
      .map(([categoria, total]) => ({ categoria, total: round(total) }))
      .sort((a, b) => b.total - a.total),
  };
}
const round = (n) => Math.round(n * 100) / 100;

export default router;

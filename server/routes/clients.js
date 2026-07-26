/*
 * Clientes / projetos (contexto Empresa). Amarra tarefas e lançamentos a um
 * cliente para saber quanto cada um rende / custa / tem em aberto.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Lista de clientes com rollup (recebido, a receber, gasto, tarefas abertas)
router.get('/', (req, res) => {
  const uid = req.user.id;
  const clients = db.prepare('SELECT * FROM clients WHERE user_id = ? ORDER BY active DESC, name').all(uid);
  const sum = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE user_id = ? AND client_id = ? AND type = ? AND paid = ?`
  );
  const openTasks = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND client_id = ? AND done = 0');
  res.json(clients.map((c) => ({
    ...c,
    recebido: round(sum.get(uid, c.id, 'entrada', 1).s),
    aReceber: round(sum.get(uid, c.id, 'entrada', 0).s),
    gasto: round(sum.get(uid, c.id, 'saida', 1).s + sum.get(uid, c.id, 'saida', 0).s),
    tarefasAbertas: openTasks.get(uid, c.id).n,
  })));
});

router.post('/', (req, res) => {
  const { name, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  const info = db
    .prepare('INSERT INTO clients (user_id, name, notes) VALUES (?, ?, ?)')
    .run(req.user.id, String(name).trim(), notes || null);
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const c = getOwned(req);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
  const { name, notes, active } = req.body || {};
  db.prepare('UPDATE clients SET name = ?, notes = ?, active = ? WHERE id = ?').run(
    name ? String(name).trim() : c.name,
    notes ?? c.notes,
    active != null ? (active ? 1 : 0) : c.active,
    c.id
  );
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id));
});

router.delete('/:id', (req, res) => {
  const c = getOwned(req);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
  // não apaga histórico: só desvincula lançamentos e tarefas
  db.prepare('UPDATE transactions SET client_id = NULL WHERE user_id = ? AND client_id = ?').run(req.user.id, c.id);
  db.prepare('UPDATE tasks SET client_id = NULL WHERE user_id = ? AND client_id = ?').run(req.user.id, c.id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

function getOwned(req) {
  return db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
}

export default router;

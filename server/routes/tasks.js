import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// ?scope=today | open | all  (padrão: open)  &ambito=pessoal|empresa
const ambFilter = (a) => (a === 'empresa' ? 'empresa' : a === 'pessoal' ? 'pessoal' : null);
const ambStore = (a) => (a === 'empresa' ? 'empresa' : 'pessoal');

router.get('/', (req, res) => {
  const scope = req.query.scope || 'open';
  const amb = ambFilter(req.query.ambito);
  const aClause = amb ? ' AND ambito = ?' : '';
  const uid = req.user.id;
  let rows;
  if (scope === 'all') {
    rows = db
      .prepare(`SELECT * FROM tasks WHERE user_id = ?${aClause} ORDER BY done, due_date IS NULL, due_date, id DESC`)
      .all(...(amb ? [uid, amb] : [uid]));
  } else if (scope === 'today') {
    const day = new Date().toISOString().slice(0, 10);
    rows = db
      .prepare(
        `SELECT * FROM tasks WHERE user_id = ? AND done = 0 AND (due_date IS NULL OR due_date <= ?)${aClause}
         ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
                  due_date IS NULL, due_date, id`
      )
      .all(...(amb ? [uid, day, amb] : [uid, day]));
  } else {
    rows = db
      .prepare(`SELECT * FROM tasks WHERE user_id = ? AND done = 0${aClause} ORDER BY due_date IS NULL, due_date, id`)
      .all(...(amb ? [uid, amb] : [uid]));
  }
  res.json(rows);
});

router.post('/', (req, res) => {
  const { title, notes, due_date, priority, ambito } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' });
  const info = db
    .prepare(
      'INSERT INTO tasks (user_id, title, notes, due_date, priority, ambito) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      req.user.id,
      String(title).trim(),
      notes || null,
      due_date || null,
      validPriority(priority),
      ambStore(ambito)
    );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const task = getOwned(req);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
  const { title, notes, due_date, priority, ambito } = req.body || {};
  db.prepare(
    'UPDATE tasks SET title = ?, notes = ?, due_date = ?, priority = ?, ambito = ? WHERE id = ?'
  ).run(
    title ?? task.title,
    notes ?? task.notes,
    due_date ?? task.due_date,
    priority ? validPriority(priority) : task.priority,
    ambito ? ambStore(ambito) : task.ambito,
    task.id
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

router.post('/:id/toggle', (req, res) => {
  const task = getOwned(req);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
  const done = task.done ? 0 : 1;
  db.prepare('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?').run(
    done,
    done ? new Date().toISOString() : null,
    task.id
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

router.delete('/:id', (req, res) => {
  const task = getOwned(req);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ ok: true });
});

function getOwned(req) {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
}
function validPriority(p) {
  return ['baixa', 'media', 'alta'].includes(p) ? p : 'media';
}

export default router;

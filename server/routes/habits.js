import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// Lista hábitos ativos com o registro do dia informado (?day=YYYY-MM-DD)
router.get('/', (req, res) => {
  const day = req.query.day || today();
  const habits = db
    .prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1 ORDER BY sort_order, id')
    .all(req.user.id);
  const withLogs = habits.map((h) => {
    const log = db
      .prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?')
      .get(h.id, day);
    return { ...h, count: log?.count || 0, day };
  });
  res.json(withLogs);
});

router.post('/', (req, res) => {
  const { name, icon, goal } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM habits WHERE user_id = ?')
    .get(req.user.id);
  const info = db
    .prepare('INSERT INTO habits (user_id, name, icon, goal, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, String(name).trim(), icon || '✅', Number(goal) || 1, max.m + 1);
  res.json(db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const habit = getOwned(req);
  if (!habit) return res.status(404).json({ error: 'Hábito não encontrado' });
  const { name, icon, goal, active } = req.body || {};
  db.prepare('UPDATE habits SET name = ?, icon = ?, goal = ?, active = ? WHERE id = ?').run(
    name ?? habit.name,
    icon ?? habit.icon,
    goal ?? habit.goal,
    active ?? habit.active,
    habit.id
  );
  res.json(db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id));
});

router.delete('/:id', (req, res) => {
  const habit = getOwned(req);
  if (!habit) return res.status(404).json({ error: 'Hábito não encontrado' });
  db.prepare('DELETE FROM habits WHERE id = ?').run(habit.id);
  res.json({ ok: true });
});

// Marca +1 / -1 / define o valor do dia. body: { day, delta } ou { day, count }
router.post('/:id/toggle', (req, res) => {
  const habit = getOwned(req);
  if (!habit) return res.status(404).json({ error: 'Hábito não encontrado' });
  const day = req.body?.day || today();
  const current =
    db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(habit.id, day)
      ?.count || 0;

  let next;
  if (typeof req.body?.count === 'number') next = req.body.count;
  else next = current + (Number(req.body?.delta) || 1);
  next = Math.max(0, Math.min(next, habit.goal));

  db.prepare(
    `INSERT INTO habit_logs (habit_id, day, count) VALUES (?, ?, ?)
     ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count`
  ).run(habit.id, day, next);

  res.json({ id: habit.id, day, count: next, goal: habit.goal });
});

function getOwned(req) {
  return db
    .prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default router;

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const ambFilter = (a) => (a === 'empresa' ? 'empresa' : a === 'pessoal' ? 'pessoal' : null);

router.get('/', (req, res) => {
  const uid = req.user.id;
  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const amb = ambFilter(req.query.ambito);
  const aClause = amb ? ' AND ambito = ?' : '';

  // --- Autocuidado do dia ---
  const habits = db
    .prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1 ORDER BY sort_order, id')
    .all(uid);
  const habitItems = habits.map((h) => {
    const count =
      db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(h.id, day)
        ?.count || 0;
    return { id: h.id, name: h.name, icon: h.icon, goal: h.goal, count };
  });
  const habitDone = habitItems.filter((h) => h.count >= h.goal).length;

  // --- Tarefas do dia (abertas, vencendo hoje ou sem prazo) ---
  const tasks = db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ? AND done = 0 AND (due_date IS NULL OR due_date <= ?)${aClause}
       ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
                due_date IS NULL, due_date, id LIMIT 20`
    )
    .all(...(amb ? [uid, day, amb] : [uid, day]));
  const overdue = db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND done = 0 AND due_date < ?${aClause}`)
    .get(...(amb ? [uid, day, amb] : [uid, day])).n;

  // --- Finanças do mês ---
  const monthRows = db
    .prepare(`SELECT type, amount FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?${aClause}`)
    .all(...(amb ? [uid, month, amb] : [uid, month]));
  let entradas = 0,
    saidas = 0;
  for (const t of monthRows) t.type === 'entrada' ? (entradas += t.amount) : (saidas += t.amount);

  const pending = db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND type = 'saida' AND paid = 0${aClause}
       ORDER BY due_date IS NULL, due_date LIMIT 10`
    )
    .all(...(amb ? [uid, amb] : [uid]));
  const pendingTotal = pending.reduce((s, t) => s + t.amount, 0);

  const recebiveis = db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND type = 'entrada' AND paid = 0${aClause}
       ORDER BY due_date IS NULL, due_date LIMIT 10`
    )
    .all(...(amb ? [uid, amb] : [uid]));
  const recebiveisTotal = recebiveis.reduce((s, t) => s + t.amount, 0);

  res.json({
    day,
    month,
    ambito: amb,
    saudacao: greeting(),
    autocuidado: { itens: habitItems, feitos: habitDone, total: habitItems.length },
    tarefas: { itens: tasks, atrasadas: overdue },
    financas: {
      entradas: round(entradas),
      saidas: round(saidas),
      saldo: round(entradas - saidas),
      contasAbertas: pending,
      contasAbertasTotal: round(pendingTotal),
      recebiveis,
      recebiveisTotal: round(recebiveisTotal),
    },
  });
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
const round = (n) => Math.round(n * 100) / 100;

export default router;

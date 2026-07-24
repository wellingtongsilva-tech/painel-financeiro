/*
 * API de máquina para a assistente-ops (WhatsApp) da iaiaBrasil.
 * Autenticada por bearer token (a "chave de API" gerada no banco e exibida
 * em Configurações). Escopo: CONSULTAR + LANÇAR (sem editar/excluir).
 *
 * A assistente roda no mesmo VPS e chama:
 *   curl -H "Authorization: Bearer <chave>" http://127.0.0.1:8090/api/agent/summary
 */
import { Router } from 'express';
import { db, getSetting, OWNER_ID } from '../db.js';
import { safeEqual } from '../security.js';

const router = Router();

// --- Auth por bearer token ---
router.use((req, res, next) => {
  const key = getSetting('agent_api_key');
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key || !token || !safeEqual(token, key)) {
    return res.status(401).json({ error: 'Chave de API inválida' });
  }
  next();
});

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
function localToday() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ_APP || 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// ---------- CONSULTAR ----------

// Resumo do dia (visão geral para a assistente responder rápido)
router.get('/summary', (req, res) => {
  const day = localToday();
  const month = day.slice(0, 7);

  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1 ORDER BY sort_order, id').all(OWNER_ID);
  const habitItems = habits.map((h) => {
    const count = db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(h.id, day)?.count || 0;
    return { id: h.id, nome: h.name, feito: count, meta: h.goal, concluido: count >= h.goal };
  });

  const tasks = db.prepare(
    `SELECT id, title, priority, due_date FROM tasks WHERE user_id = ? AND done = 0 AND (due_date IS NULL OR due_date <= ?)
     ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, due_date IS NULL, due_date LIMIT 20`
  ).all(OWNER_ID, day);
  const atrasadas = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND done = 0 AND due_date < ?').get(OWNER_ID, day).n;

  const monthRows = db.prepare('SELECT type, amount FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?').all(OWNER_ID, month);
  let entradas = 0, saidas = 0;
  for (const t of monthRows) t.type === 'entrada' ? (entradas += t.amount) : (saidas += t.amount);

  const contas = db.prepare(
    `SELECT id, description, category, amount, due_date FROM transactions
     WHERE user_id = ? AND type = 'saida' AND paid = 0 ORDER BY due_date IS NULL, due_date LIMIT 20`
  ).all(OWNER_ID);

  res.json({
    dia: day,
    autocuidado: { itens: habitItems, feitos: habitItems.filter((h) => h.concluido).length, total: habitItems.length },
    tarefas: { itens: tasks, atrasadas },
    financas: {
      entradas: round(entradas), saidas: round(saidas), saldo: round(entradas - saidas),
      contasAbertas: contas, contasAbertasTotal: round(contas.reduce((s, t) => s + t.amount, 0)),
    },
  });
});

router.get('/tasks', (req, res) => {
  const day = localToday();
  const scope = req.query.scope || 'open';
  let sql = 'SELECT id, title, notes, due_date, priority, done FROM tasks WHERE user_id = ?';
  const args = [OWNER_ID];
  if (scope === 'open') sql += ' AND done = 0';
  else if (scope === 'today') { sql += ' AND done = 0 AND (due_date IS NULL OR due_date <= ?)'; args.push(day); }
  sql += " ORDER BY done, CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, due_date IS NULL, due_date";
  res.json(db.prepare(sql).all(...args));
});

router.get('/bills', (req, res) => {
  res.json(db.prepare(
    `SELECT id, description, category, amount, due_date FROM transactions
     WHERE user_id = ? AND type = 'saida' AND paid = 0 ORDER BY due_date IS NULL, due_date`
  ).all(OWNER_ID));
});

router.get('/habits', (req, res) => {
  const day = localToday();
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1 ORDER BY sort_order, id').all(OWNER_ID);
  res.json(habits.map((h) => {
    const count = db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(h.id, day)?.count || 0;
    return { id: h.id, nome: h.name, feito: count, meta: h.goal };
  }));
});

// ---------- LANÇAR ----------

router.post('/tasks', (req, res) => {
  const { title, due_date, priority, notes } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title é obrigatório' });
  const pri = ['baixa', 'media', 'alta'].includes(priority) ? priority : 'media';
  const info = db.prepare(
    'INSERT INTO tasks (user_id, title, notes, due_date, priority) VALUES (?, ?, ?, ?, ?)'
  ).run(OWNER_ID, String(title).trim(), notes || null, due_date || null, pri);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/finance', (req, res) => {
  const b = req.body || {};
  const type = b.type === 'entrada' ? 'entrada' : 'saida';
  const amount = Number(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'amount deve ser > 0' });
  const paid = b.paid === 0 || b.paid === false || b.paid === '0' ? 0 : 1;
  const info = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, category, description, date, paid, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    OWNER_ID, type, amount, b.category || 'Outros', b.description || null,
    b.date || localToday(), paid, paid === 0 ? (b.due_date || null) : null
  );
  res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
});

// Marca um hábito no dia. body: { id | nome, count? | delta? }
router.post('/habits/log', (req, res) => {
  const b = req.body || {};
  const day = localToday();
  let habit;
  if (b.id) habit = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(b.id, OWNER_ID);
  else if (b.nome || b.name) {
    // busca sem acento e por substring (a assistente manda "agua", "remedio"…)
    const norm = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
    const alvo = norm(b.nome || b.name);
    const ativos = db.prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1 ORDER BY id').all(OWNER_ID);
    habit = ativos.find((h) => norm(h.name) === alvo)
      || ativos.find((h) => norm(h.name).includes(alvo) || alvo.includes(norm(h.name)));
  }
  if (!habit) return res.status(404).json({ error: 'Hábito não encontrado (use id ou nome)' });

  const current = db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(habit.id, day)?.count || 0;
  let next = typeof b.count === 'number' ? b.count : current + (Number(b.delta) || 1);
  next = Math.max(0, Math.min(next, habit.goal));
  db.prepare(
    `INSERT INTO habit_logs (habit_id, day, count) VALUES (?, ?, ?)
     ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count`
  ).run(habit.id, day, next);
  res.json({ id: habit.id, nome: habit.name, feito: next, meta: habit.goal, concluido: next >= habit.goal });
});

export default router;

/*
 * Contas recorrentes → materialização preguiçosa.
 * Para o mês corrente, cada recorrência ativa vira UM lançamento em aberto
 * (paid=0) uma única vez (idempotente via transactions.recurring_id + mês).
 * Chamado no carregamento do dashboard e das finanças do mês corrente.
 */
import { db } from './db.js';

export function ensureRecurring(uid, month) {
  const recs = db.prepare('SELECT * FROM recurring WHERE user_id = ? AND active = 1').all(uid);
  const exists = db.prepare(
    'SELECT id FROM transactions WHERE user_id = ? AND recurring_id = ? AND substr(date,1,7) = ?'
  );
  const insert = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, category, description, date, paid, due_date, ambito, recurring_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  );
  for (const r of recs) {
    if (exists.get(uid, r.id, month)) continue;
    const dom = Math.min(Math.max(Number(r.day_of_month) || 1, 1), 28);
    const date = `${month}-${String(dom).padStart(2, '0')}`;
    insert.run(uid, r.type, r.amount, r.category, r.description || null, date, date, r.ambito, r.id);
  }
}

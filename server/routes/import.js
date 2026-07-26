/*
 * Importação de extrato bancário: preview (parse + dedup) e commit (grava os
 * escolhidos). Não conecta ao banco — recebe o TEXTO do arquivo OFX/CSV que o
 * usuário exportou. Escopo: Caixa, PagBank, PicPay, InfinitePay (e genérico).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { parseStatement } from '../import-parsers.js';

const router = Router();
router.use(requireAuth);

const ambStore = (a) => (a === 'empresa' ? 'empresa' : 'pessoal');

// Analisa o arquivo e marca duplicados (import_key já existente). Não grava.
router.post('/preview', (req, res) => {
  const { text, format } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Envie o conteúdo do arquivo' });
  let parsed;
  try { parsed = parseStatement(text, format); } catch { return res.status(422).json({ error: 'Não consegui ler este arquivo' }); }
  const has = db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND import_key = ?');
  const seen = new Set();
  const transactions = parsed.items.map((t) => {
    const dupDb = !!has.get(req.user.id, t.import_key);
    const dupBatch = seen.has(t.import_key);
    seen.add(t.import_key);
    return { ...t, dup: dupDb || dupBatch };
  });
  res.json({
    format: parsed.format,
    count: transactions.length,
    novos: transactions.filter((t) => !t.dup).length,
    duplicados: transactions.filter((t) => t.dup).length,
    transactions,
  });
});

// Grava os lançamentos escolhidos (pula os que já existem por import_key).
router.post('/commit', (req, res) => {
  const { ambito, category, transactions } = req.body || {};
  if (!Array.isArray(transactions) || !transactions.length) {
    return res.status(400).json({ error: 'Nada para importar' });
  }
  const amb = ambStore(ambito);
  const cat = (category || 'Importado').trim();
  const has = db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND import_key = ?');
  const insert = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, category, description, date, paid, ambito, import_key)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  let imported = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const t of transactions) {
      const type = t.type === 'entrada' ? 'entrada' : 'saida';
      const amount = Number(t.amount);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
      const key = t.import_key || null;
      if (!(amount > 0) || !date) { skipped++; continue; }
      if (key && has.get(req.user.id, key)) { skipped++; continue; } // já importado (dedup)
      insert.run(req.user.id, type, amount, cat, (t.description || '').trim() || null, date, amb, key);
      imported++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Falha ao importar' });
  }
  res.json({ imported, skipped });
});

export default router;

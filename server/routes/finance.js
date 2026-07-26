import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ensureRecurring } from '../recurring.js';
import { geminiText, geminiConfigured } from '../gemini.js';

const router = Router();
router.use(requireAuth);

// Âmbito: 'pessoal' | 'empresa'. Query inválida/ausente => sem filtro (tudo).
const ambFilter = (a) => (a === 'empresa' ? 'empresa' : a === 'pessoal' ? 'pessoal' : null);
const ambStore = (a) => (a === 'empresa' ? 'empresa' : 'pessoal'); // grava sempre um dos dois
const cid = (v) => (v ? Number(v) : null); // client_id normalizado (0/''/null → null)

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

// Fechamento do mês: Pessoal × Empresa lado a lado. ?month=YYYY-MM
router.get('/report', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const per = (amb) => {
    const rows = db
      .prepare("SELECT type, amount FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? AND ambito = ?")
      .all(req.user.id, month, amb);
    let e = 0, s = 0;
    for (const t of rows) t.type === 'entrada' ? (e += t.amount) : (s += t.amount);
    return { entradas: round(e), saidas: round(s), saldo: round(e - s) };
  };
  const pessoal = per('pessoal');
  const empresa = per('empresa');
  res.json({
    month,
    pessoal,
    empresa,
    total: {
      entradas: round(pessoal.entradas + empresa.entradas),
      saidas: round(pessoal.saidas + empresa.saidas),
      saldo: round(pessoal.saldo + empresa.saldo),
    },
  });
});

// --- Análise de gastos (base local + camada de IA opcional) ---
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function buildResumo(uid, month, amb) {
  const aClause = amb ? ' AND ambito = ?' : '';
  const rows = db
    .prepare(`SELECT type, amount, category, description FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?${aClause}`)
    .all(...(amb ? [uid, month, amb] : [uid, month]));
  let entradas = 0, saidas = 0;
  const cat = {};
  const gastos = [];
  for (const t of rows) {
    if (t.type === 'entrada') entradas += t.amount;
    else {
      saidas += t.amount;
      cat[t.category] = (cat[t.category] || 0) + t.amount;
      gastos.push({ desc: t.description || t.category, valor: round(t.amount) });
    }
  }
  const prev = shiftMonth(month, -1);
  const prevSaidas = db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE user_id = ? AND type='saida' AND substr(date,1,7) = ?${aClause}`)
    .get(...(amb ? [uid, prev, amb] : [uid, prev])).s;
  return {
    month,
    ambito: amb || 'tudo',
    entradas: round(entradas),
    saidas: round(saidas),
    saldo: round(entradas - saidas),
    saidasMesAnterior: round(prevSaidas),
    variacaoPct: prevSaidas > 0 ? Math.round(((saidas - prevSaidas) / prevSaidas) * 100) : null,
    porCategoria: Object.entries(cat).map(([categoria, total]) => ({ categoria, total: round(total) })).sort((a, b) => b.total - a.total),
    topGastos: gastos.sort((a, b) => b.valor - a.valor).slice(0, 8),
    lancamentos: rows.length,
  };
}

// Base local da análise (sempre funciona, sem IA)
router.get('/analysis', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const resumo = buildResumo(req.user.id, month, ambFilter(req.query.ambito));
  res.json({ resumo, aiConfigured: geminiConfigured() });
});

// Camada de IA (Gemini) sob demanda: diagnóstico + sugestões de corte
router.post('/analysis/ai', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const amb = ambFilter(req.query.ambito);
  const r = buildResumo(req.user.id, month, amb);
  if (!r.lancamentos) return res.status(422).json({ error: 'Sem lançamentos neste mês para analisar.' });
  const contexto = amb === 'empresa' ? 'da empresa' : amb === 'pessoal' ? 'pessoais' : 'gerais';
  const prompt =
    `Você é um consultor financeiro brasileiro, direto e prático. Analise as finanças ${contexto} do mês ${month} e responda em português do Brasil, curto e objetivo.\n\n` +
    `Entradas: ${brl(r.entradas)}\nSaídas: ${brl(r.saidas)} (mês anterior: ${brl(r.saidasMesAnterior)}${r.variacaoPct != null ? `, ${r.variacaoPct >= 0 ? '+' : ''}${r.variacaoPct}%` : ''})\nSaldo: ${brl(r.saldo)}\n` +
    `Gastos por categoria: ${r.porCategoria.map((c) => `${c.categoria} ${brl(c.total)}`).join('; ') || '—'}\n` +
    `Maiores gastos: ${r.topGastos.map((g) => `${g.desc} ${brl(g.valor)}`).join('; ') || '—'}\n\n` +
    `Responda com:\n1) Um diagnóstico em 1 frase.\n2) 3 a 4 sugestões objetivas para cortar ou controlar gastos, citando categorias e valores reais.\n3) Uma meta de gasto sugerida para o próximo mês.\nSeja consultor, não relatório: não repita todos os números crus, não invente dados, não use markdown pesado.`;
  try {
    const out = await geminiText(prompt, {
      system: 'Você é um consultor financeiro pessoal objetivo. Responde em pt-BR, sem enrolação, com sugestões acionáveis.',
    });
    res.json({ resumo: r, ai: out.text, model: out.model });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha na análise por IA', resumo: r });
  }
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
  const { type, amount, category, description, date, paid, due_date, ambito, client_id } = req.body || {};
  if (!['entrada', 'saida'].includes(type)) {
    return res.status(400).json({ error: 'Tipo deve ser "entrada" ou "saida"' });
  }
  const value = Number(amount);
  if (!(value > 0)) return res.status(400).json({ error: 'Valor deve ser maior que zero' });

  const info = db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount, category, description, date, paid, due_date, ambito, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      ambStore(ambito),
      cid(client_id)
    );
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const tx = getOwned(req);
  if (!tx) return res.status(404).json({ error: 'Lançamento não encontrado' });
  const { type, amount, category, description, date, paid, due_date, ambito, client_id } = req.body || {};
  db.prepare(
    `UPDATE transactions SET type = ?, amount = ?, category = ?, description = ?, date = ?, paid = ?, due_date = ?, ambito = ?, client_id = ?
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
    client_id !== undefined ? cid(client_id) : tx.client_id,
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

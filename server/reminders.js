/*
 * Notificações push (Web Push / VAPID) + agendador dos lembretes.
 *
 * O SERVIDOR é quem dispara — por isso os lembretes chegam mesmo com o
 * celular fechado (o navegador acorda o service worker). Roda de 30 em 30s
 * e usa o fuso America/Sao_Paulo para comparar os horários configurados.
 */
import webpush from 'web-push';
import { db, getSetting, setSetting, OWNER_ID } from './db.js';

const TZ = process.env.TZ_APP || 'America/Sao_Paulo';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:wellington.gsilva@gmail.com';

// --- VAPID: gera o par de chaves uma única vez e guarda no banco ---
function ensureVapid() {
  let pub = getSetting('vapid_public');
  let priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    setSetting('vapid_public', pub);
    setSetting('vapid_private', priv);
    console.log('[push] chaves VAPID geradas');
  }
  webpush.setVapidDetails(SUBJECT, pub, priv);
  return pub;
}

let vapidPublic = null;
export function getVapidPublic() {
  if (!vapidPublic) vapidPublic = ensureVapid();
  return vapidPublic;
}

// --- Inscrições ---
export function saveSubscription(sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return false;
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  return true;
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function countSubscriptions() {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;
}

// --- Envio para todos os aparelhos inscritos ---
export async function sendToAll(payload) {
  getVapidPublic(); // garante VAPID configurado
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  if (!subs.length) return { sent: 0, removed: 0 };
  const data = JSON.stringify(payload);
  let sent = 0,
    removed = 0;
  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, data);
      sent++;
    } catch (err) {
      // 404/410 = inscrição expirada/cancelada: limpa
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        removeSubscription(s.endpoint);
        removed++;
      } else {
        console.warn('[push] falha ao enviar:', err?.statusCode || err?.message);
      }
    }
  }
  return { sent, removed };
}

// --- Canal WhatsApp (via assistente-ops da iaiaBrasil) ---
// best-effort: a assistente só entrega texto livre dentro da janela de 24h da
// Meta; fora disso o push continua sendo o canal garantido.
const OPS_URL = process.env.OPS_NOTIFY_URL || '';
const OPS_SECRET = process.env.OPS_NOTIFY_SECRET || '';
export async function notifyWhatsApp(text) {
  if (!OPS_URL || !OPS_SECRET) return { skipped: true };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(OPS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ops-Secret': OPS_SECRET },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { ok: r.ok, status: r.status };
  } catch (err) {
    console.warn('[wa] notify falhou:', err?.message);
    return { ok: false, error: err?.message };
  }
}

// Entrega um lembrete nos canais ativos: push (sempre) + WhatsApp (se ligado).
function dispatch(payload) {
  sendToAll(payload);
  if (getSetting('reminder_whatsapp', '1') === '1') {
    notifyWhatsApp(`${payload.title}\n${payload.body}`);
  }
}

// --- Fuso local (São Paulo) sem depender do TZ do container ---
function localNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  let hh = g('hour');
  if (hh === '24') hh = '00'; // alguns ambientes retornam 24 à meia-noite
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${hh}:${g('minute')}` };
}

// --- Idempotência: cada lembrete dispara no máx. 1x por dia ---
function alreadySent(key, day) {
  return !!db.prepare('SELECT 1 FROM notif_sent WHERE key = ? AND day = ?').get(key, day);
}
function markSent(key, day) {
  db.prepare('INSERT OR IGNORE INTO notif_sent (key, day) VALUES (?, ?)').run(key, day);
}

const isHM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

// --- Consultas para montar os textos ---
function habitsPending(date) {
  const habits = db
    .prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1')
    .all(OWNER_ID);
  return habits.filter((h) => {
    const c = db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(h.id, date)?.count || 0;
    return c < h.goal;
  });
}
function tasksDue(date) {
  return db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ? AND done = 0 AND (due_date IS NULL OR due_date <= ?)
       ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, due_date`
    )
    .all(OWNER_ID, date);
}
function billsOpen() {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND type = 'saida' AND paid = 0 AND due_date IS NOT NULL`
    )
    .all(OWNER_ID);
}
function receivablesOpen() {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE user_id = ? AND type = 'entrada' AND paid = 0 AND due_date IS NOT NULL`
    )
    .all(OWNER_ID);
}
const ambTag = (a) => (a === 'empresa' ? '[Empresa] ' : '');
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function daysBetween(a, b) {
  // a, b = 'YYYY-MM-DD' -> dias inteiros (b - a)
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// --- Um "tick" do agendador ---
function tick() {
  try {
    const { date, hm } = localNow();

    // 1) Resumo da manhã
    const morning = getSetting('reminder_morning', '');
    if (isHM(morning) && morning === hm && !alreadySent('morning', date)) {
      const h = habitsPending(date).length;
      const t = tasksDue(date).length;
      const bills = billsOpen().filter((b) => daysBetween(date, b.due_date) <= 2);
      const recv = receivablesOpen().filter((b) => daysBetween(date, b.due_date) <= 2);
      const parts = [];
      if (h) parts.push(`${h} hábito(s) pendente(s)`);
      if (t) parts.push(`${t} tarefa(s) para hoje`);
      if (bills.length) {
        const emp = bills.filter((b) => b.ambito === 'empresa').length;
        parts.push(`${bills.length} conta(s) a vencer${emp ? ` (${emp} da empresa)` : ''}`);
      }
      if (recv.length) parts.push(`${brl(recv.reduce((s, b) => s + b.amount, 0))} a receber`);
      const body = parts.length ? parts.join(' · ') : 'Tudo em dia por aqui 🎉';
      dispatch({ title: '☀️ Bom dia! Seu dia', body, tag: 'morning' });
      markSent('morning', date);
    }

    // 2) Tarefas do dia (digest)
    const tasksTime = getSetting('reminder_tasks_time', '');
    if (isHM(tasksTime) && tasksTime === hm && !alreadySent('tasks', date)) {
      const list = tasksDue(date);
      if (list.length) {
        const overdue = list.filter((x) => x.due_date && x.due_date < date).length;
        const first = list.slice(0, 3).map((x) => x.title).join(', ');
        const extra = list.length > 3 ? `… +${list.length - 3}` : '';
        const body =
          (overdue ? `${overdue} atrasada(s). ` : '') + `${first}${extra}`;
        dispatch({ title: `✅ ${list.length} tarefa(s) para hoje`, body, tag: 'tasks' });
      }
      markSent('tasks', date); // marca mesmo se vazio: não reavalia o dia todo
    }

    // 3) Contas a pagar (X dias antes do vencimento, e no dia)
    const billsTime = getSetting('reminder_bills_time', '');
    const billsDays = parseInt(getSetting('reminder_bills_days', '2'), 10) || 0;
    if (isHM(billsTime) && billsTime === hm) {
      for (const b of billsOpen()) {
        const d = daysBetween(date, b.due_date); // <0 vencida, 0 hoje, >0 futura
        if (d < 0 || d > billsDays) continue;
        const key = `bill:${b.id}`;
        if (alreadySent(key, date)) continue;
        const quando = d < 0 ? 'venceu' : d === 0 ? 'vence hoje' : `vence em ${d} dia(s)`;
        dispatch({
          title: `💸 ${ambTag(b.ambito)}Conta ${quando}`,
          body: `${b.description || b.category} — ${brl(b.amount)}`,
          tag: key,
        });
        markSent(key, date);
      }
      // contas a RECEBER previstas (mesma antecedência configurada)
      for (const b of receivablesOpen()) {
        const d = daysBetween(date, b.due_date);
        if (d < 0 || d > billsDays) continue;
        const key = `recv:${b.id}`;
        if (alreadySent(key, date)) continue;
        const quando = d === 0 ? 'previsto hoje' : `previsto em ${d} dia(s)`;
        dispatch({
          title: `💰 ${ambTag(b.ambito)}A receber ${quando}`,
          body: `${b.description || b.category} — ${brl(b.amount)}`,
          tag: key,
        });
        markSent(key, date);
      }
    }

    // 4) Hábitos com horário configurado
    for (const h of db.prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1').all(OWNER_ID)) {
      const times = String(h.remind_times || '')
        .split(',')
        .map((s) => s.trim())
        .filter(isHM);
      if (!times.includes(hm)) continue;
      const key = `habit:${h.id}:${hm}`;
      if (alreadySent(key, date)) continue;
      const count = db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND day = ?').get(h.id, date)?.count || 0;
      if (count >= h.goal) {
        markSent(key, date);
        continue; // já cumpriu hoje, não incomoda
      }
      dispatch({
        title: `${h.icon || '⏰'} ${h.name}`,
        body: h.goal > 1 ? `Faltam ${h.goal - count} de ${h.goal} hoje.` : 'Hora de fazer 👍',
        tag: key,
      });
      markSent(key, date);
    }

    // Limpeza: remove marcações antigas (mantém ~3 dias)
    db.prepare("DELETE FROM notif_sent WHERE day < date('now','-3 days')").run();
  } catch (err) {
    console.error('[push] erro no agendador:', err?.message);
  }
}

let timer = null;
export function startScheduler() {
  if (timer) return;
  ensureVapid();
  timer = setInterval(tick, 30_000); // a cada 30s; dedup evita repetição
  console.log(`[push] agendador de lembretes ativo (fuso ${TZ})`);
}

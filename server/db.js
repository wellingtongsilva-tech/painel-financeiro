import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashSecret } from './security.js';

const DB_PATH = resolve(process.env.DB_PATH || 'data/painel.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- AUTOCUIDADO: hábitos e seus registros diários
  CREATE TABLE IF NOT EXISTS habits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '✅',
    goal       INTEGER NOT NULL DEFAULT 1,   -- quantas vezes por dia
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day      TEXT NOT NULL,                  -- YYYY-MM-DD
    count    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(habit_id, day)
  );

  -- RESPONSABILIDADES: tarefas do dia a dia
  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    notes      TEXT,
    due_date   TEXT,                         -- YYYY-MM-DD
    priority   TEXT NOT NULL DEFAULT 'media', -- baixa | media | alta
    done       INTEGER NOT NULL DEFAULT 0,
    done_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- FINANÇAS: lançamentos (entradas/saídas) e contas a pagar
  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,               -- entrada | saida
    amount      REAL NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Outros',
    description TEXT,
    date        TEXT NOT NULL,               -- YYYY-MM-DD (competência)
    paid        INTEGER NOT NULL DEFAULT 1,  -- 0 = conta a pagar em aberto
    due_date    TEXT,                        -- vencimento (contas a pagar)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_habit_logs_day ON habit_logs(day);
  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);
  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);

  -- Preferências do app (senha de acesso, tema, etc.) — chave/valor
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- NOTIFICAÇÕES PUSH: aparelhos inscritos (Web Push / VAPID)
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Controle de idempotência: qual lembrete já foi enviado em cada dia
  CREATE TABLE IF NOT EXISTS notif_sent (
    key TEXT NOT NULL,   -- ex.: "morning", "tasks", "bill:12", "habit:3:09:00"
    day TEXT NOT NULL,   -- YYYY-MM-DD (fuso local)
    PRIMARY KEY (key, day)
  );
`);

// --- Migrações leves (idempotentes) ---
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('habits', 'remind_times', 'remind_times TEXT'); // CSV "08:00,12:00"

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

// --- Uso pessoal: um único usuário (login por token, estilo cockpit) ---
export const OWNER_ID = 1;

export function ensureOwner() {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(OWNER_ID);
  if (exists) return;
  db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(
    OWNER_ID,
    'Você',
    'dono@local',
    'token-auth' // login é por token; sem senha por usuário
  );
  const defaults = [
    { name: 'Beber água', icon: '💧', goal: 8 },
    { name: 'Tomar remédio', icon: '💊', goal: 1 },
    { name: 'Exercício', icon: '🏃', goal: 1 },
    { name: 'Meditar', icon: '🧘', goal: 1 },
    { name: 'Dormir 8h', icon: '😴', goal: 1 },
  ];
  const stmt = db.prepare(
    'INSERT INTO habits (user_id, name, icon, goal, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  defaults.forEach((h, i) => stmt.run(OWNER_ID, h.name, h.icon, h.goal, i));
}

// Semeia a senha de acesso na PRIMEIRA vez (a partir do .env, se houver;
// senão um padrão trocável). Depois disso, a senha vive só no banco e é
// alterada dentro do app.
export function bootstrapSettings() {
  if (!getSetting('access_token_hash')) {
    const initial = process.env.ACCESS_TOKEN || 'trocar-senha';
    setSetting('access_token_hash', hashSecret(initial));
    if (!process.env.ACCESS_TOKEN) {
      console.warn('[painel] Senha inicial = "trocar-senha". Troque em Configurações após entrar.');
    }
  }
  if (!getSetting('theme')) setSetting('theme', 'system');

  // Horários padrão dos lembretes (todos configuráveis no app; "" = desligado)
  if (getSetting('reminder_morning') === null) setSetting('reminder_morning', '07:00');
  if (getSetting('reminder_tasks_time') === null) setSetting('reminder_tasks_time', '08:00');
  if (getSetting('reminder_bills_days') === null) setSetting('reminder_bills_days', '2');
  if (getSetting('reminder_bills_time') === null) setSetting('reminder_bills_time', '09:00');
}

ensureOwner();
bootstrapSettings();

export default db;

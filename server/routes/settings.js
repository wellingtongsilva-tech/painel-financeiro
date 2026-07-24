import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { randomToken } from '../security.js';

const router = Router();
router.use(requireAuth);

const THEMES = ['system', 'light', 'dark'];
const isHM = (s) => s === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function snapshot() {
  return {
    theme: getSetting('theme', 'system'),
    reminders: {
      morning: getSetting('reminder_morning', ''),
      tasksTime: getSetting('reminder_tasks_time', ''),
      billsDays: parseInt(getSetting('reminder_bills_days', '2'), 10) || 0,
      billsTime: getSetting('reminder_bills_time', ''),
      whatsapp: getSetting('reminder_whatsapp', '1') === '1',
    },
    integracoes: {
      agentKey: getSetting('agent_api_key', ''),
    },
  };
}

router.get('/', (req, res) => res.json(snapshot()));

router.patch('/', (req, res) => {
  const b = req.body || {};

  if (b.theme !== undefined) {
    if (!THEMES.includes(b.theme)) return res.status(400).json({ error: 'Tema inválido' });
    setSetting('theme', b.theme);
  }

  const r = b.reminders || {};
  if (r.morning !== undefined) {
    if (!isHM(r.morning)) return res.status(400).json({ error: 'Horário do resumo inválido' });
    setSetting('reminder_morning', r.morning);
  }
  if (r.tasksTime !== undefined) {
    if (!isHM(r.tasksTime)) return res.status(400).json({ error: 'Horário das tarefas inválido' });
    setSetting('reminder_tasks_time', r.tasksTime);
  }
  if (r.billsTime !== undefined) {
    if (!isHM(r.billsTime)) return res.status(400).json({ error: 'Horário das contas inválido' });
    setSetting('reminder_bills_time', r.billsTime);
  }
  if (r.billsDays !== undefined) {
    const n = parseInt(r.billsDays, 10);
    if (Number.isNaN(n) || n < 0 || n > 30) return res.status(400).json({ error: 'Dias inválidos' });
    setSetting('reminder_bills_days', String(n));
  }
  if (r.whatsapp !== undefined) {
    setSetting('reminder_whatsapp', r.whatsapp ? '1' : '0');
  }

  res.json(snapshot());
});

// Gera uma nova chave de API da assistente (invalida a anterior)
router.post('/agent-key/regenerate', (req, res) => {
  const key = randomToken('pfin');
  setSetting('agent_api_key', key);
  res.json({ agentKey: key });
});

export default router;

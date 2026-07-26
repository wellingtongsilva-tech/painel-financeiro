import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import './db.js';
import authRoutes from './routes/auth.js';
import habitsRoutes from './routes/habits.js';
import tasksRoutes from './routes/tasks.js';
import financeRoutes from './routes/finance.js';
import dashboardRoutes from './routes/dashboard.js';
import settingsRoutes from './routes/settings.js';
import pushRoutes from './routes/push.js';
import agentRoutes from './routes/agent.js';
import gcalRoutes from './routes/gcal.js';
import recurringRoutes from './routes/recurring.js';
import budgetsRoutes from './routes/budgets.js';
import clientsRoutes from './routes/clients.js';
import { startScheduler } from './reminders.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1); // atrás do nginx no VPS
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// --- API ---
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/habits', habitsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/gcal', gcalRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/clients', clientsRoutes);

// --- PWA estática ---
app.use(express.static(PUBLIC_DIR));

// Fallback SPA: qualquer rota não-API devolve o index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[painel] rodando em http://localhost:${PORT}`);
  startScheduler(); // dispara os lembretes push (fuso America/Sao_Paulo)
});

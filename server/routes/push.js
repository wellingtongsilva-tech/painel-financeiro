import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  getVapidPublic,
  saveSubscription,
  removeSubscription,
  countSubscriptions,
  sendToAll,
} from '../reminders.js';

const router = Router();

// Chave pública VAPID (não é segredo — o cliente precisa dela para se inscrever)
router.get('/vapid', (req, res) => {
  res.json({ key: getVapidPublic() });
});

router.use(requireAuth);

// Registra/atualiza a inscrição deste aparelho
router.post('/subscribe', (req, res) => {
  const ok = saveSubscription(req.body?.subscription || req.body);
  if (!ok) return res.status(400).json({ error: 'Inscrição inválida' });
  res.json({ ok: true, devices: countSubscriptions() });
});

router.post('/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) removeSubscription(endpoint);
  res.json({ ok: true, devices: countSubscriptions() });
});

router.get('/status', (req, res) => {
  res.json({ devices: countSubscriptions() });
});

// Dispara uma notificação de teste para todos os aparelhos inscritos
router.post('/test', async (req, res) => {
  const r = await sendToAll({
    title: '🔔 Teste de notificação',
    body: 'Se você está vendo isto, os lembretes estão funcionando!',
    tag: 'test',
  });
  res.json(r);
});

export default router;

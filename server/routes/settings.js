import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const THEMES = ['system', 'light', 'dark'];

router.get('/', (req, res) => {
  res.json({ theme: getSetting('theme', 'system') });
});

router.patch('/', (req, res) => {
  const { theme } = req.body || {};
  if (theme !== undefined) {
    if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Tema inválido' });
    setSetting('theme', theme);
  }
  res.json({ theme: getSetting('theme', 'system') });
});

export default router;

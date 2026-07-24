import { Router } from 'express';
import { OWNER_ID, getSetting, setSetting } from '../db.js';
import { hashSecret, verifySecret } from '../security.js';
import { signSession, setAuthCookie, clearAuthCookie, requireAuth } from '../auth.js';

const router = Router();

// Login por senha/token (estilo cockpit): um único campo, validado contra o hash no banco.
router.post('/login', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Informe a senha de acesso' });
  const stored = getSetting('access_token_hash');
  if (!verifySecret(token, stored)) return res.status(401).json({ error: 'Senha inválida' });
  setAuthCookie(res, signSession(OWNER_ID));
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true });
});

// Trocar a senha de acesso (dentro do app)
router.post('/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const stored = getSetting('access_token_hash');
  if (!verifySecret(current, stored)) {
    return res.status(401).json({ error: 'Senha atual incorreta' });
  }
  if (!next || String(next).length < 4) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 4 caracteres' });
  }
  setSetting('access_token_hash', hashSecret(String(next)));
  res.json({ ok: true });
});

export default router;

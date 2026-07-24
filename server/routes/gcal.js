/*
 * Google Agenda — SOMENTE LEITURA (mostra os eventos do dia na tela Hoje).
 *
 * OAuth 2.0 com a conta do dono; o refresh_token vive no banco (settings).
 * Sem dependências: troca de código e refresh via fetch nativo (Node 24).
 *
 * .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 *   (redirect padrão: https://iaiabrasil.com/pfin/api/gcal/callback)
 */
import { Router } from 'express';
import { getSetting, setSetting, db } from '../db.js';
import { requireAuth } from '../auth.js';
import { randomToken } from '../security.js';

const router = Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://iaiabrasil.com/pfin/api/gcal/callback';
// URL pública do app (o nginx tira o prefixo /pfin, então derivamos do redirect).
const APP_URL = REDIRECT_URI.replace(/api\/gcal\/callback\/?$/, '');
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TZ = process.env.TZ_APP || 'America/Sao_Paulo';

const configured = () => !!(CLIENT_ID && CLIENT_SECRET);
const isConnected = () => !!getSetting('gcal_refresh_token');

function delSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ---------- OAuth: iniciar ----------
router.get('/connect', requireAuth, (req, res) => {
  if (!configured()) return res.status(500).send('Google não configurado (faltam GOOGLE_CLIENT_ID/SECRET no .env).');
  const state = randomToken('st');
  setSetting('gcal_oauth_state', state);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  res.redirect(url);
});

// ---------- OAuth: callback (navegação do browser vinda do Google) ----------
router.get('/callback', async (req, res) => {
  const back = (q) => res.redirect(APP_URL + q); // volta pro app (URL pública)
  try {
    const { code, state, error } = req.query;
    if (error) return back('?agenda=erro');
    if (!code || !state || state !== getSetting('gcal_oauth_state')) return back('?agenda=estado');
    delSetting('gcal_oauth_state');

    const tok = await exchange({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    });
    if (!tok.refresh_token) return back('?agenda=sem_refresh');
    setSetting('gcal_refresh_token', tok.refresh_token);
    if (tok.access_token) {
      setSetting('gcal_access_token', tok.access_token);
      setSetting('gcal_token_expiry', String(Date.now() + (tok.expires_in || 3600) * 1000 - 60000));
    }
    back('?agenda=ok');
  } catch (e) {
    console.warn('[gcal] callback falhou:', e?.message);
    back('?agenda=erro');
  }
});

router.use(requireAuth);

router.get('/status', (req, res) => {
  res.json({ configured: configured(), connected: isConnected() });
});

router.post('/disconnect', (req, res) => {
  ['gcal_refresh_token', 'gcal_access_token', 'gcal_token_expiry', 'gcal_oauth_state'].forEach(delSetting);
  res.json({ connected: false });
});

// Eventos de hoje (fuso São Paulo)
router.get('/today', async (req, res) => {
  if (!isConnected()) return res.json({ connected: false, eventos: [] });
  try {
    const token = await accessToken();
    const day = localDate();
    const timeMin = `${day}T00:00:00-03:00`;
    const timeMax = `${day}T23:59:59-03:00`;
    const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '25',
    });
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      if (r.status === 401) { // refresh inválido/revogado
        ['gcal_refresh_token', 'gcal_access_token', 'gcal_token_expiry'].forEach(delSetting);
        return res.json({ connected: false, eventos: [] });
      }
      return res.status(502).json({ error: 'Falha ao ler a agenda' });
    }
    const data = await r.json();
    const eventos = (data.items || []).map((e) => ({
      titulo: e.summary || '(sem título)',
      inicio: e.start?.dateTime || null,     // com hora
      diaInteiro: !e.start?.dateTime,         // all-day
      local: e.location || null,
    }));
    res.json({ connected: true, eventos });
  } catch (e) {
    console.warn('[gcal] today falhou:', e?.message);
    res.status(502).json({ error: 'Falha ao ler a agenda' });
  }
});

// ---------- helpers ----------
async function exchange(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || 'token error');
  return data;
}

async function accessToken() {
  const exp = Number(getSetting('gcal_token_expiry', '0'));
  const cached = getSetting('gcal_access_token');
  if (cached && Date.now() < exp) return cached;
  const tok = await exchange({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token', refresh_token: getSetting('gcal_refresh_token'),
  });
  setSetting('gcal_access_token', tok.access_token);
  setSetting('gcal_token_expiry', String(Date.now() + (tok.expires_in || 3600) * 1000 - 60000));
  return tok.access_token;
}

function localDate() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export default router;

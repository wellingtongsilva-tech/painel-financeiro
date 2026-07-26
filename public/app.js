'use strict';

/* Base do app: diretório atual da URL (funciona em / ou em /pfin/) */
const BASE = location.pathname.replace(/[^/]*$/, '');
const API = BASE + 'api/';

/* ---------- tema (sistema / claro / escuro) ---------- */
const THEME_KEY = 'painel-theme';
function applyTheme(theme) {
  const t = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}
applyTheme(localStorage.getItem(THEME_KEY) || 'system');

/* ---------- utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '');

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showAuth(); throw new Error('unauth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro inesperado');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- modal ---------- */
function openModal(title, bodyNode) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(bodyNode);
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ---------- auth ---------- */
function showAuth() { $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); }
function showApp() { $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); }

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#auth-error').textContent = '';
  try {
    await api('auth/login', { method: 'POST', body: { token: f.token.value } });
    await boot();
  } catch (err) { $('#auth-error').textContent = err.message; }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('auth/logout', { method: 'POST' }).catch(() => {});
  showAuth();
});

/* ---------- push (notificações) ---------- */
function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enablePush() {
  if (!pushSupported()) throw new Error('Este aparelho/navegador não suporta notificações.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Ative nas configurações do navegador.');
  const { key } = await api('push/vapid');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key),
    });
  }
  await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}
async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

/* ---------- configurações ---------- */
$('#btn-settings').addEventListener('click', settingsForm);

async function settingsForm() {
  const cur = localStorage.getItem(THEME_KEY) || 'system';
  const settings = await api('settings').catch(() => ({ reminders: {} }));
  const R = settings.reminders || {};
  const wrap = el('div', 'modal-form');

  // Tema
  const themeBlock = el('div');
  themeBlock.innerHTML = '<div class="card-title" style="margin-bottom:8px">Tema</div>';
  const seg = el('div', 'seg');
  [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']].forEach(([k, label]) => {
    const b = el('button', k === cur ? 'on' : '', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
      applyTheme(k);
      await api('settings', { method: 'PATCH', body: { theme: k } }).catch(() => {});
    });
    seg.appendChild(b);
  });
  themeBlock.appendChild(seg);
  wrap.appendChild(themeBlock);

  // Notificações (push)
  const notif = el('div');
  notif.style.marginTop = '22px';
  notif.innerHTML = '<div class="card-title" style="margin-bottom:8px">Notificações</div>';
  const notifStatus = el('p', 'muted', 'Verificando…');
  notif.appendChild(notifStatus);
  const notifBtn = el('button', 'btn-primary', 'Ativar neste aparelho');
  notifBtn.type = 'button';
  const testBtn = el('button', 'add-btn', 'Enviar teste');
  testBtn.type = 'button';
  testBtn.style.marginTop = '8px';
  notif.append(notifBtn, testBtn);
  wrap.appendChild(notif);

  async function refreshNotif() {
    if (!pushSupported()) {
      notifStatus.textContent = 'Este navegador não suporta push. No iPhone: instale o app na Tela de Início (iOS 16.4+).';
      notifBtn.style.display = 'none';
      testBtn.style.display = 'none';
      return;
    }
    const sub = await currentSubscription();
    const on = !!sub && Notification.permission === 'granted';
    notifStatus.textContent = on
      ? 'Ativadas neste aparelho ✓'
      : 'Desativadas. Ative para receber os lembretes.';
    notifBtn.textContent = on ? 'Desativar neste aparelho' : 'Ativar neste aparelho';
    notifBtn.className = on ? 'add-btn' : 'btn-primary';
    testBtn.style.display = on ? '' : 'none';
  }
  notifBtn.addEventListener('click', async () => {
    notifBtn.disabled = true;
    try {
      const sub = await currentSubscription();
      if (sub && Notification.permission === 'granted') { await disablePush(); toast('Notificações desativadas'); }
      else { await enablePush(); toast('Notificações ativadas'); }
    } catch (err) { toast(err.message); }
    notifBtn.disabled = false;
    refreshNotif();
  });
  testBtn.addEventListener('click', async () => {
    try { const r = await api('push/test', { method: 'POST' }); toast(r.sent ? 'Teste enviado 🔔' : 'Nenhum aparelho inscrito'); }
    catch (err) { toast(err.message); }
  });
  refreshNotif();

  // Horários dos lembretes
  const rem = el('form', 'modal-form');
  rem.style.marginTop = '22px';
  const chk = (on) => (on ? 'checked' : '');
  rem.innerHTML = `
    <div class="card-title" style="margin-bottom:0">Horários dos lembretes</div>
    <label class="chk"><input type="checkbox" name="mOn" ${chk(R.morning)} style="width:auto" /> Resumo da manhã</label>
    <label>Horário<input type="time" name="mTime" value="${R.morning || '07:00'}" /></label>
    <label class="chk"><input type="checkbox" name="tOn" ${chk(R.tasksTime)} style="width:auto" /> Tarefas do dia</label>
    <label>Horário<input type="time" name="tTime" value="${R.tasksTime || '08:00'}" /></label>
    <label class="chk"><input type="checkbox" name="bOn" ${chk(R.billsTime)} style="width:auto" /> Contas a pagar</label>
    <div class="row2">
      <label>Avisar antes<select name="bDays">
        ${[0,1,2,3,5,7].map((d) => `<option value="${d}" ${Number(R.billsDays)===d?'selected':''}>${d===0?'no dia':d+' dia(s) antes'}</option>`).join('')}
      </select></label>
      <label>Horário<input type="time" name="bTime" value="${R.billsTime || '09:00'}" /></label>
    </div>
    <button class="btn-primary" type="submit">Salvar lembretes</button>
    <p class="error" id="rem-msg"></p>`;
  rem.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = rem.querySelector('#rem-msg');
    const body = { reminders: {
      morning: rem.mOn.checked ? rem.mTime.value : '',
      tasksTime: rem.tOn.checked ? rem.tTime.value : '',
      billsTime: rem.bOn.checked ? rem.bTime.value : '',
      billsDays: Number(rem.bDays.value),
    }};
    try {
      await api('settings', { method: 'PATCH', body });
      msg.style.color = 'var(--green)'; msg.textContent = 'Lembretes salvos.';
    } catch (err) { msg.style.color = 'var(--red)'; msg.textContent = err.message; }
  });
  wrap.appendChild(rem);

  // Integrações (assistente-ops WhatsApp)
  const integ = el('div');
  integ.style.marginTop = '22px';
  let agentKey = (settings.integracoes && settings.integracoes.agentKey) || '';
  integ.innerHTML = `
    <div class="card-title" style="margin-bottom:8px">Integrações</div>
    <p class="hint">A assistente-ops da iaiaBrasil (WhatsApp) usa esta chave para consultar e lançar registros. Cole no arquivo <code>.env</code> da assistente (<code>PAINEL_API_KEY</code>).</p>
    <div class="codebox" id="agent-key">${esc(agentKey.replace(/^(pfin_.{6}).+(.{4})$/, '$1••••••••$2'))}</div>
    <div style="display:flex; gap:8px; margin-top:8px">
      <button type="button" class="add-btn" id="key-show">Mostrar</button>
      <button type="button" class="add-btn" id="key-copy">Copiar</button>
      <button type="button" class="add-btn" id="key-regen" style="color:var(--red)">Regenerar</button>
    </div>
    <label class="chk" style="margin-top:16px"><input type="checkbox" id="wa-toggle" ${R.whatsapp ? 'checked' : ''} /> Enviar os lembretes também pelo WhatsApp
      <span class="status-chip ${R.whatsapp ? 'on' : 'off'}" id="wa-chip" style="margin-left:auto">${R.whatsapp ? 'ativo' : 'off'}</span></label>
    <p class="hint">O push sempre chega. O WhatsApp é enviado pela assistente quando você falou com ela nas últimas 24h (regra da Meta).</p>`;
  let revealed = false;
  const keyBox = integ.querySelector('#agent-key');
  integ.querySelector('#key-show').addEventListener('click', (e) => {
    revealed = !revealed;
    keyBox.textContent = revealed ? agentKey : agentKey.replace(/^(pfin_.{6}).+(.{4})$/, '$1••••••••$2');
    e.target.textContent = revealed ? 'Ocultar' : 'Mostrar';
  });
  integ.querySelector('#key-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(agentKey); toast('Chave copiada'); }
    catch { keyBox.textContent = agentKey; revealed = true; toast('Selecione e copie a chave'); }
  });
  integ.querySelector('#key-regen').addEventListener('click', async () => {
    if (!confirm('Gerar uma nova chave? A anterior deixa de funcionar e você precisará atualizar a assistente.')) return;
    try {
      const r = await api('settings/agent-key/regenerate', { method: 'POST' });
      agentKey = r.agentKey; revealed = true; keyBox.textContent = agentKey; toast('Nova chave gerada');
    } catch (err) { toast(err.message); }
  });
  integ.querySelector('#wa-toggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    try {
      await api('settings', { method: 'PATCH', body: { reminders: { whatsapp: on } } });
      const chip = integ.querySelector('#wa-chip');
      chip.textContent = on ? 'ativo' : 'off'; chip.className = 'status-chip ' + (on ? 'on' : 'off');
    } catch (err) { toast(err.message); e.target.checked = !on; }
  });

  // Google Agenda (somente leitura)
  const I = settings.integracoes || {};
  const gcal = el('div');
  gcal.style.marginTop = '18px';
  gcal.style.borderTop = '1px solid var(--border)';
  gcal.style.paddingTop = '16px';
  if (!I.gcalConfigured) {
    gcal.innerHTML = `<div class="chk" style="justify-content:space-between">Google Agenda <span class="status-chip off">indisponível</span></div>
      <p class="hint">Falta configurar as credenciais do Google no servidor.</p>`;
  } else if (I.gcalConnected) {
    gcal.innerHTML = `<div class="chk" style="justify-content:space-between">Google Agenda <span class="status-chip on">conectada</span></div>
      <p class="hint">Os eventos do dia aparecem na tela Hoje.</p>
      <button type="button" class="add-btn" id="gcal-off" style="color:var(--red); margin-top:8px">Desconectar</button>`;
    gcal.querySelector('#gcal-off').addEventListener('click', async () => {
      try { await api('gcal/disconnect', { method: 'POST' }); toast('Agenda desconectada'); settingsForm(); }
      catch (err) { toast(err.message); }
    });
  } else {
    gcal.innerHTML = `<div class="chk" style="justify-content:space-between">Google Agenda <span class="status-chip off">desconectada</span></div>
      <p class="hint">Mostra seus eventos do dia na tela Hoje (somente leitura).</p>
      <button type="button" class="btn-primary" id="gcal-on" style="margin-top:8px">Conectar Google Agenda</button>`;
    gcal.querySelector('#gcal-on').addEventListener('click', () => { location.href = API + 'gcal/connect'; });
  }
  integ.appendChild(gcal);
  wrap.appendChild(integ);

  // Trocar senha
  const pwForm = el('form', 'modal-form');
  pwForm.style.marginTop = '22px';
  pwForm.innerHTML = `
    <div class="card-title" style="margin-bottom:0">Trocar senha de acesso</div>
    <label>Senha atual<input name="current" type="password" required /></label>
    <label>Nova senha<input name="next" type="password" minlength="4" required /></label>
    <button class="btn-primary" type="submit">Salvar nova senha</button>
    <p class="error" id="pw-msg"></p>`;
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = pwForm.querySelector('#pw-msg');
    msg.style.color = 'var(--red)';
    try {
      await api('auth/password', {
        method: 'POST',
        body: { current: pwForm.current.value, next: pwForm.next.value },
      });
      msg.style.color = 'var(--green)';
      msg.textContent = 'Senha alterada com sucesso.';
      pwForm.reset();
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  wrap.appendChild(pwForm);

  openModal('Configurações', wrap);
}

/* ---------- âmbito: PESSOAL × EMPRESA ---------- */
const AMBITO_KEY = 'painel-ambito';
const AMBITOS = ['pessoal', 'empresa', 'tudo'];
let ambito = AMBITOS.includes(localStorage.getItem(AMBITO_KEY)) ? localStorage.getItem(AMBITO_KEY) : 'pessoal';
// Âmbito para GRAVAR (captura/forms): em "tudo", cai em pessoal por padrão.
const ambitoWrite = () => (ambito === 'empresa' ? 'empresa' : 'pessoal');
function syncAmbitoButtons() { $$('.amb-btn').forEach((b) => b.classList.toggle('on', b.dataset.amb === ambito)); }
$$('.amb-btn').forEach((b) => b.addEventListener('click', () => {
  ambito = AMBITOS.includes(b.dataset.amb) ? b.dataset.amb : 'pessoal';
  localStorage.setItem(AMBITO_KEY, ambito);
  syncAmbitoButtons();
  render();
}));
syncAmbitoButtons();

/* ---------- navegação ---------- */
const TITLES = { hoje: 'Agora', agenda: 'Agenda', autocuidado: 'Rotina', tarefas: 'Tarefas', financas: 'Finanças' };
let currentView = 'hoje';
$$('.tabbar-btn').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view))
);
function switchView(view) {
  currentView = view;
  $$('.tabbar-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#topbar-title').textContent = TITLES[view];
  // âmbito não se aplica a rotina (pessoal) nem à agenda (calendário)
  $('#ambito-bar').classList.toggle('hidden', view === 'autocuidado' || view === 'agenda');
  render();
}

async function render() {
  const v = $('#view');
  v.innerHTML = '<p class="empty">Carregando…</p>';
  try {
    if (currentView === 'hoje') await renderAgora(v);
    else if (currentView === 'agenda') await renderAgendaView(v);
    else if (currentView === 'autocuidado') await renderAutocuidado(v);
    else if (currentView === 'tarefas') await renderTarefas(v);
    else if (currentView === 'financas') await renderFinancas(v);
  } catch (err) {
    if (err.message !== 'unauth') v.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

/* ============ AGORA (tela única de comando) ============ */
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

async function renderAgora(v) {
  const d = await api('dashboard?ambito=' + ambito);
  v.innerHTML = '';

  // status resumido
  const openN = d.tarefas.itens.length;
  const dueN = d.financas.contasAbertas.length;
  const status = el('div', 'statusline');
  status.innerHTML =
    `<span><i>${openN}</i> pendência${openN === 1 ? '' : 's'}</span>` +
    (dueN ? `<span class="sep">·</span><span class="warn"><i>${dueN}</i> conta${dueN === 1 ? '' : 's'} aberta${dueN === 1 ? '' : 's'}</span>` : '') +
    `<span class="sep">·</span><span>saldo <i class="num"${d.financas.saldo < 0 ? ' style="color:var(--neg)"' : ''}>${brl(d.financas.saldo)}</i></span>`;
  v.appendChild(status);

  // captura rápida (o dia todo, em fragmentos)
  v.appendChild(captureBar());

  // agenda do Google (opcional)
  let eventos = [];
  try { const g = await api('gcal/today'); if (g.connected) eventos = g.eventos || []; } catch { /* opcional */ }

  // lista unificada "Agora"
  const items = buildAgoraItems(d, eventos);
  const listCard = el('div', 'card');
  listCard.appendChild(el('div', 'card-title', `Agora <span>${ambito === 'empresa' ? 'Empresa' : ambito === 'tudo' ? 'Tudo' : 'Pessoal'}</span>`));
  const list = el('div', 'alist');
  if (!items.length) list.appendChild(el('p', 'empty', 'Nada urgente agora.'));
  items.forEach((it) => list.appendChild(agoraRow(it, () => renderAgora(v))));
  listCard.appendChild(list);
  v.appendChild(listCard);

  // dinheiro compacto
  const money = el('div', 'money-top');
  money.innerHTML =
    `<div class="saldo"><div class="k">Saldo do mês</div><div class="v num ${d.financas.saldo < 0 ? 'neg' : ''}">${brl(d.financas.saldo)}</div></div>
     <div class="io">
       <div class="in"><div class="k"><span class="dot"></span>Entrou</div><div class="v">${brl(d.financas.entradas)}</div></div>
       <div class="out"><div class="k"><span class="dot"></span>Saiu</div><div class="v">${brl(d.financas.saidas)}</div></div>
     </div>`;
  v.appendChild(money);

  // rotina (hábitos — sempre pessoal)
  const rot = el('div', 'card');
  rot.appendChild(el('div', 'card-title', `Rotina <span>${d.autocuidado.feitos}/${d.autocuidado.total}</span>`));
  const chips = el('div', 'chips');
  if (!d.autocuidado.itens.length) chips.appendChild(el('p', 'empty', 'Sem hábitos ainda.'));
  d.autocuidado.itens.forEach((h) => chips.appendChild(habitChip(h, () => renderAgora(v))));
  rot.appendChild(chips);
  v.appendChild(rot);
}

function buildAgoraItems(d, eventos) {
  const today = todayStr();
  const items = [];
  d.tarefas.itens.forEach((t) => {
    const overdue = t.due_date && t.due_date < today;
    items.push({ kind: 'task', pr: overdue ? 0 : (t.priority === 'alta' ? 1 : 2), data: t });
  });
  d.financas.contasAbertas.forEach((b) => {
    const overdue = b.due_date && b.due_date < today;
    items.push({ kind: 'bill', pr: overdue ? 0 : 1, data: b });
  });
  (d.financas.recebiveis || []).forEach((r) => {
    const overdue = r.due_date && r.due_date < today;
    items.push({ kind: 'recv', pr: overdue ? 0 : 1, data: r });
  });
  (eventos || []).forEach((e) => items.push({ kind: 'event', pr: 1, data: e }));
  return items.sort((a, b) => a.pr - b.pr);
}

function agoraRow(it, refresh) {
  const t = it.data;
  // etiqueta Pessoal/Empresa só aparece no modo "Tudo"
  const pe = (x) => (ambito === 'tudo' && x && x.ambito) ? `<span class="a-kind">${x.ambito === 'empresa' ? 'EMP' : 'PES'}</span>` : '';
  if (it.kind === 'task') {
    const overdue = t.due_date && t.due_date < todayStr();
    const row = el('div', 'aitem' + (t.done ? ' done' : ''));
    const tick = el('button', 'a-tick', CHECK_SVG);
    tick.setAttribute('aria-label', 'Concluir');
    tick.addEventListener('click', async () => { await api(`tasks/${t.id}/toggle`, { method: 'POST' }); refresh(); });
    const body = el('div', 'a-body');
    body.innerHTML = `<div class="a-title">${esc(t.title)}</div><div class="a-meta">` + pe(t) +
      (overdue ? '<span class="a-tag late">atrasada</span>' : (t.due_date ? '<span class="a-tag today">hoje</span>' : '<span>sem prazo</span>')) +
      (t.priority === 'alta' ? '<span class="a-tag late">alta</span>' : '') + '</div>';
    body.querySelector('.a-title').addEventListener('click', () => taskForm(t));
    row.append(tick, body);
    return row;
  }
  if (it.kind === 'bill') {
    const overdue = t.due_date && t.due_date < todayStr();
    const row = el('div', 'aitem');
    const mark = el('div', 'a-tick'); mark.style.borderStyle = 'dashed'; mark.style.cursor = 'default';
    const body = el('div', 'a-body');
    body.innerHTML = `<div class="a-title">${esc(t.description || t.category)}</div>` +
      `<div class="a-meta">` + pe(t) + `<span class="a-kind">conta</span><span class="a-tag ${overdue ? 'late' : 'due'}">` +
      (t.due_date ? (overdue ? 'venceu ' : 'vence ') + fmtDate(t.due_date) : 'em aberto') + '</span></div>';
    const amt = el('div', 'a-amt neg num', '−' + brl(t.amount));
    const pay = el('button', 'a-pay', 'Pagar');
    pay.addEventListener('click', async () => { await api(`finance/${t.id}/pay`, { method: 'POST' }); toast('Conta paga'); refresh(); });
    row.append(mark, body, amt, pay);
    return row;
  }
  if (it.kind === 'recv') {
    const overdue = t.due_date && t.due_date < todayStr();
    const row = el('div', 'aitem');
    const mark = el('div', 'a-tick'); mark.style.borderStyle = 'dashed'; mark.style.cursor = 'default';
    const body = el('div', 'a-body');
    body.innerHTML = `<div class="a-title">${esc(t.description || t.category)}</div>` +
      `<div class="a-meta">` + pe(t) + `<span class="a-kind">a receber</span><span class="a-tag ${overdue ? 'late' : 'due'}">` +
      (t.due_date ? (overdue ? 'venceu ' : 'prev. ') + fmtDate(t.due_date) : 'sem data') + '</span></div>';
    const amt = el('div', 'a-amt pos num', '+' + brl(t.amount));
    const rec = el('button', 'a-pay', 'Recebi');
    rec.addEventListener('click', async () => { await api(`finance/${t.id}/pay`, { method: 'POST' }); toast('Recebimento confirmado'); refresh(); });
    row.append(mark, body, amt, rec);
    return row;
  }
  // event
  const row = el('div', 'aitem');
  const mark = el('div', 'a-tick'); mark.style.background = 'var(--accent-weak)'; mark.style.borderColor = 'transparent'; mark.style.cursor = 'default';
  const hora = t.diaInteiro ? 'dia' : new Date(t.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const body = el('div', 'a-body');
  body.innerHTML = `<div class="a-title">${esc(t.titulo)}</div><div class="a-meta"><span class="a-kind ev">agenda</span>` +
    `<span class="a-time">${esc(hora)}</span>${t.local ? '<span>· ' + esc(t.local) + '</span>' : ''}</div>`;
  row.append(mark, body);
  return row;
}

function habitChip(h, refresh) {
  const done = h.count >= h.goal;
  if (h.goal > 1) {
    const chip = el('button', 'chip' + (done ? ' done' : ''));
    chip.innerHTML = `<span class="ct"><span class="pm" data-d="-1">−</span><b>${h.count}</b>/${h.goal}<span class="pm" data-d="1">+</span></span> ${esc(h.name)}`;
    chip.addEventListener('click', (e) => { const pm = e.target.closest('.pm'); if (pm) step(h, Number(pm.dataset.d), refresh); });
    return chip;
  }
  const chip = el('button', 'chip' + (done ? ' done' : ''), `<span class="mk">${CHECK_SVG}</span> ${esc(h.name)}`);
  chip.addEventListener('click', () => step(h, done ? -1 : 1, refresh));
  return chip;
}

/* ---------- captura rápida ---------- */
function captureBar() {
  const wrap = el('div', 'capture');
  const form = el('form', 'cap-form');
  form.setAttribute('autocomplete', 'off');
  form.innerHTML =
    `<input class="cap-input" id="cap-input" placeholder="Registrar agora…  ex: -34 uber" aria-label="Captura rápida" />` +
    `<button class="cap-send" type="submit" aria-label="Registrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>`;
  const hint = el('div', 'cap-hint', defaultHint());
  const input = form.querySelector('#cap-input');
  input.addEventListener('input', () => { hint.innerHTML = previewHint(input.value.trim()); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const txt = input.value.trim();
    if (!txt) return;
    try { await captureSubmit(txt); input.value = ''; render(); }
    catch (err) { toast(err.message); }
  });
  wrap.append(form, hint);
  return wrap;
}
function defaultHint() { return '<b>-1500 aluguel</b> vira saída · <b>amanhã ligar contador</b> vira tarefa'; }
function previewHint(v) {
  if (!v) return defaultHint();
  const p = parseCapture(v);
  if (p.type === 'money') return '→ ' + (p.txType === 'entrada' ? 'entrada' : 'gasto') + ' de <b>' + brl(p.amount) + '</b>' + (p.desc ? ' · ' + esc(p.desc) : '');
  return '→ tarefa: <b>' + esc(p.title.slice(0, 40)) + '</b>' + (p.due ? ' (' + (p.due === todayStr() ? 'hoje' : 'amanhã') + ')' : '');
}
async function captureSubmit(txt) {
  const p = parseCapture(txt);
  if (p.type === 'money') {
    await api('finance', { method: 'POST', body: { type: p.txType, amount: p.amount, category: p.category || 'Outros', description: p.desc, date: todayStr(), paid: 1, ambito: ambitoWrite() } });
    toast((p.txType === 'entrada' ? 'Entrada' : 'Gasto') + ' de ' + brl(p.amount) + ' lançado');
  } else {
    await api('tasks', { method: 'POST', body: { title: p.title, due_date: p.due, priority: 'media', ambito: ambitoWrite() } });
    toast('Tarefa criada');
  }
}
function parseAmount(s) {
  s = String(s).replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return parseFloat(s);
}
function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function parseCapture(txt) {
  const m = txt.match(/([+-]?)\s*r?\$?\s*([\d.,]+)/i);
  const moneyWord = /(gast|paguei|comprei|recebi|receb|sal[aá]rio|entrou|ganhei|mercado|uber|ifood|aluguel|conta|r\$)/i.test(txt);
  if (m && (/[+-]/.test(m[1]) || moneyWord)) {
    const amount = parseAmount(m[2]);
    if (amount > 0) {
      const pos = /^\+/.test(m[1]) || /(recebi|receb|sal[aá]rio|entrou|ganhei)/i.test(txt);
      let desc = txt.replace(m[0], '').replace(/^[+-]/, '').trim();
      desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : '';
      return { type: 'money', txType: pos ? 'entrada' : 'saida', amount, desc: desc || null, category: desc ? desc.split(/\s+/)[0] : 'Outros' };
    }
  }
  let due = null, title = txt;
  // \b não casa com "ã" (acento) — usa substring direta para amanhã.
  if (/amanh[ãa]/i.test(txt)) { due = addDays(todayStr(), 1); title = title.replace(/amanh[ãa]/ig, ''); }
  else if (/\bhoje\b/i.test(txt)) { due = todayStr(); title = title.replace(/\bhoje\b/ig, ''); }
  title = title.replace(/\s+/g, ' ').trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { type: 'task', title, due };
}

/* ============ AGENDA (calendário do mês + eventos do dia) ============ */
let agendaMonth = new Date().toISOString().slice(0, 7);
let agendaDay = todayStr();

async function renderAgendaView(v) {
  const g = await api('gcal/month?month=' + agendaMonth).catch(() => ({ connected: false, eventos: [] }));
  v.innerHTML = '';
  const head = el('div', 'section-h');
  head.innerHTML = '<h2>Agenda</h2>';
  v.appendChild(head);

  if (!g.connected) {
    const card = el('div', 'card');
    card.appendChild(el('p', 'empty', 'Google Agenda não conectada.'));
    const b = el('button', 'btn-primary', 'Conectar Google Agenda');
    b.style.marginTop = '4px';
    b.addEventListener('click', () => settingsForm());
    card.appendChild(b);
    v.appendChild(card);
    return;
  }

  const byDay = {};
  (g.eventos || []).forEach((e) => { (byDay[e.dia] = byDay[e.dia] || []).push(e); });

  // navegação de mês
  const calCard = el('div', 'card');
  const nav = el('div', 'month-nav');
  const prev = el('button', null, '‹');
  const next = el('button', null, '›');
  const label = el('span', 'm-label', monthLabel(agendaMonth));
  const goMonth = (delta) => {
    agendaMonth = shiftMonth(agendaMonth, delta);
    agendaDay = (agendaMonth === todayStr().slice(0, 7)) ? todayStr() : agendaMonth + '-01';
    renderAgendaView(v);
  };
  prev.addEventListener('click', () => goMonth(-1));
  next.addEventListener('click', () => goMonth(+1));
  nav.append(prev, label, next);
  calCard.appendChild(nav);

  // grade do calendário
  const cal = el('div', 'cal');
  ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach((w) => cal.appendChild(el('div', 'cal-wd', w)));
  const [y, mo] = agendaMonth.split('-').map(Number);
  const startWd = new Date(y, mo - 1, 1).getDay();
  const daysIn = new Date(y, mo, 0).getDate();
  for (let i = 0; i < startWd; i++) cal.appendChild(el('div', 'cal-cell empty'));
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${agendaMonth}-${String(d).padStart(2, '0')}`;
    const cls = 'cal-cell' + (ds === todayStr() ? ' today' : '') + (ds === agendaDay ? ' sel' : '') + (byDay[ds] ? ' has' : '');
    const cell = el('button', cls, String(d) + (byDay[ds] ? '<span class="cal-dot"></span>' : ''));
    cell.addEventListener('click', () => { agendaDay = ds; renderAgendaView(v); });
    cal.appendChild(cell);
  }
  calCard.appendChild(cal);
  v.appendChild(calCard);

  // eventos do dia selecionado
  const dayCard = el('div', 'card');
  dayCard.appendChild(el('div', 'card-title', agendaDay ? dayHeader(agendaDay) : 'Selecione um dia'));
  const evs = agendaDay ? (byDay[agendaDay] || []) : [];
  if (!evs.length) dayCard.appendChild(el('p', 'empty', 'Sem eventos neste dia.'));
  evs.forEach((e) => {
    const row = el('div', 'evt' + (e.diaInteiro ? ' allday' : ''));
    const hora = e.diaInteiro ? 'dia' : new Date(e.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `<span class="evt-time">${esc(hora)}</span>
      <div><div class="evt-title">${esc(e.titulo)}</div>${e.local ? `<div class="tx-cat">${esc(e.local)}</div>` : ''}</div>`;
    dayCard.appendChild(row);
  });
  v.appendChild(dayCard);
}

function dayHeader(dia) {
  const today = todayStr();
  const tmr = addDays(today, 1);
  const label = new Date(dia + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const prefix = dia === today ? 'Hoje · ' : dia === tmr ? 'Amanhã · ' : '';
  return prefix + label;
}

/* ============ AUTOCUIDADO ============ */
async function renderAutocuidado(v) {
  const habits = await api('habits?day=' + todayStr());
  v.innerHTML = '';
  const head = el('div', 'section-h');
  head.innerHTML = '<h2>Rotina de hoje</h2>';
  const add = el('button', 'add-btn', '+ Hábito');
  add.addEventListener('click', () => habitForm());
  head.appendChild(add);
  v.appendChild(head);

  const card = el('div', 'card');
  if (!habits.length) card.appendChild(el('p', 'empty', 'Crie seu primeiro hábito de autocuidado.'));
  habits.forEach((h) => card.appendChild(habitRow(h, () => renderAutocuidado(v), true)));
  v.appendChild(card);
}

function habitRow(h, refresh, editable = false) {
  const done = h.count >= h.goal;
  const row = el('div', 'habit' + (done ? ' done' : ''));
  row.innerHTML = `<div class="emoji">${esc(h.icon)}</div>
    <div class="h-body"><div class="h-name">${esc(h.name)}</div>
    <div class="h-meta">${h.count}/${h.goal}${h.goal > 1 ? ' hoje' : ''}</div></div>`;

  if (h.goal > 1) {
    const stepper = el('div', 'stepper');
    const minus = el('button', null, '−');
    const cnt = el('span', 'count', String(h.count));
    const plus = el('button', null, '+');
    minus.addEventListener('click', () => step(h, -1, refresh));
    plus.addEventListener('click', () => step(h, +1, refresh));
    stepper.append(minus, cnt, plus);
    row.appendChild(stepper);
  } else {
    const btn = el('button', 'check-btn' + (done ? ' on' : ''), '✓');
    btn.addEventListener('click', () => step(h, done ? -1 : +1, refresh));
    row.appendChild(btn);
  }

  if (editable) {
    row.addEventListener('dblclick', () => habitForm(h));
  }
  return row;
}

async function step(h, delta, refresh) {
  await api(`habits/${h.id}/toggle`, { method: 'POST', body: { day: todayStr(), delta } });
  refresh();
}

function habitForm(existing) {
  const form = el('form', 'modal-form');
  form.innerHTML = `
    <div class="row2">
      <label>Emoji<input name="icon" maxlength="2" value="${esc(existing?.icon || '✅')}" /></label>
      <label>Meta/dia<input name="goal" type="number" min="1" value="${existing?.goal || 1}" /></label>
    </div>
    <label>Nome<input name="name" required value="${esc(existing?.name || '')}" placeholder="Ex.: Beber água" /></label>
    <label>Lembretes (horários)<input name="remind_times" value="${esc(existing?.remind_times || '')}" placeholder="Ex.: 08:00, 12:00, 18:00" />
      <small class="muted">Notifica nesses horários se ainda não cumpriu o hábito. Deixe vazio para não lembrar.</small></label>
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>
    ${existing ? '<button type="button" class="add-btn" id="del-habit" style="background:var(--red-soft);color:var(--red)">Excluir hábito</button>' : ''}`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: form.name.value, icon: form.icon.value, goal: Number(form.goal.value), remind_times: form.remind_times.value };
    if (existing) await api('habits/' + existing.id, { method: 'PATCH', body });
    else await api('habits', { method: 'POST', body });
    closeModal(); toast('Hábito salvo'); render();
  });
  if (existing) {
    form.querySelector('#del-habit').addEventListener('click', async () => {
      await api('habits/' + existing.id, { method: 'DELETE' });
      closeModal(); toast('Hábito excluído'); render();
    });
  }
  openModal(existing ? 'Editar hábito' : 'Novo hábito', form);
}

/* ============ TAREFAS ============ */
let taskScope = 'open';
async function renderTarefas(v) {
  const tasks = await api('tasks?scope=' + taskScope + '&ambito=' + ambito);
  v.innerHTML = '';
  const head = el('div', 'section-h');
  head.innerHTML = '<h2>Responsabilidades</h2>';
  const add = el('button', 'add-btn', '+ Tarefa');
  add.addEventListener('click', () => taskForm());
  head.appendChild(add);
  v.appendChild(head);

  const seg = el('div', 'seg');
  [['open', 'Abertas'], ['today', 'Hoje'], ['all', 'Todas']].forEach(([k, label]) => {
    const b = el('button', k === taskScope ? 'on' : '', label);
    b.addEventListener('click', () => { taskScope = k; renderTarefas(v); });
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const card = el('div', 'card');
  card.style.marginTop = '14px';
  if (!tasks.length) card.appendChild(el('p', 'empty', 'Nenhuma tarefa aqui.'));
  tasks.forEach((t) => card.appendChild(taskRow(t, () => renderTarefas(v), true)));
  v.appendChild(card);
}

function taskRow(t, refresh, withDelete = false) {
  const overdue = !t.done && t.due_date && t.due_date < todayStr();
  const row = el('div', 'task' + (t.done ? ' done' : ''));
  const check = el('button', 'check-btn' + (t.done ? ' on' : ''), '✓');
  check.addEventListener('click', async () => { await api(`tasks/${t.id}/toggle`, { method: 'POST' }); refresh(); });
  row.appendChild(check);

  const body = el('div', 't-body');
  body.innerHTML = `<div class="t-title">${esc(t.title)}</div>`;
  const meta = el('div', 't-meta');
  meta.innerHTML =
    `<span class="pill ${t.priority}">${t.priority}</span>` +
    (t.due_date ? `<span class="pill ${overdue ? 'atraso' : ''}">${overdue ? 'atrasada · ' : ''}${fmtDate(t.due_date)}</span>` : '') +
    (t.notes ? `<span>${esc(t.notes)}</span>` : '');
  body.appendChild(meta);
  body.addEventListener('click', (e) => { if (e.target === body || e.target.classList.contains('t-title')) taskForm(t); });
  row.appendChild(body);

  if (withDelete) {
    const del = el('button', 't-del', '🗑');
    del.addEventListener('click', async () => { await api('tasks/' + t.id, { method: 'DELETE' }); refresh(); });
    row.appendChild(del);
  }
  return row;
}

function taskForm(existing) {
  const form = el('form', 'modal-form');
  form.innerHTML = `
    <label>Título<input name="title" required value="${esc(existing?.title || '')}" placeholder="O que precisa ser feito?" /></label>
    <div class="row2">
      <label>Prazo<input name="due_date" type="date" value="${existing?.due_date || ''}" /></label>
      <label>Prioridade<select name="priority">
        <option value="baixa">Baixa</option>
        <option value="media">Média</option>
        <option value="alta">Alta</option>
      </select></label>
    </div>
    <label>Notas<textarea name="notes" rows="2" placeholder="opcional">${esc(existing?.notes || '')}</textarea></label>
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>`;
  form.priority.value = existing?.priority || 'media';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: form.title.value,
      due_date: form.due_date.value || null,
      priority: form.priority.value,
      notes: form.notes.value || null,
      ambito: ambitoWrite(),
      client_id: form.client_id ? (form.client_id.value || null) : undefined,
    };
    if (existing) await api('tasks/' + existing.id, { method: 'PATCH', body });
    else await api('tasks', { method: 'POST', body });
    closeModal(); toast('Tarefa salva'); render();
  });
  openModal(existing ? 'Editar tarefa' : 'Nova tarefa', form);
  injectClientSelect(form, existing?.client_id);
}

/* ============ FINANÇAS ============ */
let finMonth = new Date().toISOString().slice(0, 7);
async function renderFinancas(v) {
  const d = await api('finance?month=' + finMonth + '&ambito=' + ambito);
  v.innerHTML = '';
  const head = el('div', 'section-h');
  head.innerHTML = '<h2>Finanças</h2>';
  const actions = el('div');
  actions.style.cssText = 'display:flex;gap:6px';
  const imp = el('button', 'add-btn', 'Importar');
  imp.addEventListener('click', () => importForm());
  const add = el('button', 'add-btn', '+ Lançamento');
  add.addEventListener('click', () => txForm());
  actions.append(imp, add);
  head.appendChild(actions);
  v.appendChild(head);

  // navegação de mês
  const nav = el('div', 'month-nav');
  const prev = el('button', null, '‹');
  const next = el('button', null, '›');
  const label = el('span', 'm-label', monthLabel(finMonth));
  prev.addEventListener('click', () => { finMonth = shiftMonth(finMonth, -1); renderFinancas(v); });
  next.addEventListener('click', () => { finMonth = shiftMonth(finMonth, +1); renderFinancas(v); });
  nav.append(prev, label, next);
  v.appendChild(nav);

  const s = d.summary;
  const stats = el('div', 'stats');
  stats.innerHTML = `
    <div class="stat in"><div class="v">${brl(s.entradas)}</div><div class="l">Entradas</div></div>
    <div class="stat out"><div class="v">${brl(s.saidas)}</div><div class="l">Saídas</div></div>
    <div class="stat"><div class="v">${brl(s.saldo)}</div><div class="l">Saldo</div></div>`;
  v.appendChild(stats);

  // fechamento Pessoal × Empresa (só no modo "Tudo")
  if (ambito === 'tudo') {
    try {
      const rep = await api('finance/report?month=' + finMonth);
      const card = el('div', 'card');
      card.appendChild(el('div', 'card-title', 'Fechamento do mês'));
      card.appendChild(reportCompare(rep));
      v.appendChild(card);
    } catch { /* opcional */ }
  }

  // a receber (recebíveis em aberto)
  try {
    const rec = await api('finance/receivable?ambito=' + ambito);
    if (rec.length) {
      const card = el('div', 'card');
      const tot = rec.reduce((s, t) => s + t.amount, 0);
      card.appendChild(el('div', 'card-title', `A receber <span>${brl(tot)}</span>`));
      rec.forEach((t) => card.appendChild(recvRow(t, () => renderFinancas(v))));
      v.appendChild(card);
    }
  } catch { /* opcional */ }

  // metas / orçamento do mês
  try {
    const budgets = await api('budgets?month=' + finMonth + '&ambito=' + ambito);
    const bc = el('div', 'card');
    const bh = el('div', 'card-title', 'Metas do mês');
    const addB = el('button', 'add-btn', '+ Meta');
    addB.style.cssText = 'padding:4px 9px;font-size:.72rem';
    addB.addEventListener('click', () => budgetForm(null, () => renderFinancas(v)));
    bh.appendChild(addB); bc.appendChild(bh);
    if (!budgets.length) bc.appendChild(el('p', 'empty', 'Sem metas. Defina um teto de gasto por categoria.'));
    budgets.forEach((b) => bc.appendChild(budgetRow(b, () => renderFinancas(v))));
    v.appendChild(bc);
  } catch { /* opcional */ }

  // gastos por categoria
  if (s.porCategoria.length) {
    const cat = el('div', 'card');
    cat.appendChild(el('div', 'card-title', 'Saídas por categoria'));
    const max = s.porCategoria[0].total || 1;
    s.porCategoria.forEach((c) => {
      const bar = el('div', 'cat-bar');
      bar.innerHTML = `<div class="cat-top"><span>${esc(c.categoria)}</span><span>${brl(c.total)}</span></div>
        <div class="cat-line"><i style="width:${Math.round((c.total / max) * 100)}%"></i></div>`;
      cat.appendChild(bar);
    });
    v.appendChild(cat);
  }

  // lançamentos
  const list = el('div', 'card');
  list.appendChild(el('div', 'card-title', 'Lançamentos'));
  if (!d.transactions.length) list.appendChild(el('p', 'empty', 'Nenhum lançamento neste mês.'));
  d.transactions.forEach((t) => list.appendChild(txRow(t, () => renderFinancas(v))));
  v.appendChild(list);

  // contas recorrentes (fixas)
  try {
    const recs = await api('recurring?ambito=' + ambito);
    const rc = el('div', 'card');
    const rh = el('div', 'card-title', 'Contas recorrentes');
    const addR = el('button', 'add-btn', '+ Recorrente');
    addR.style.cssText = 'padding:4px 9px;font-size:.72rem';
    addR.addEventListener('click', () => recurringForm(null, () => renderFinancas(v)));
    rh.appendChild(addR); rc.appendChild(rh);
    if (!recs.length) rc.appendChild(el('p', 'empty', 'Nenhuma conta fixa. Ex.: aluguel, salários, assinaturas — aparecem sozinhas todo mês.'));
    recs.forEach((r) => rc.appendChild(recurringItem(r, () => renderFinancas(v))));
    v.appendChild(rc);
  } catch { /* opcional */ }

  // clientes / projetos (contexto empresa)
  if (ambito !== 'pessoal') {
    try {
      const clients = await api('clients');
      const cc = el('div', 'card');
      const ch = el('div', 'card-title', 'Clientes / projetos');
      const addC = el('button', 'add-btn', '+ Cliente');
      addC.style.cssText = 'padding:4px 9px;font-size:.72rem';
      addC.addEventListener('click', () => clientForm(null, () => renderFinancas(v)));
      ch.appendChild(addC); cc.appendChild(ch);
      if (!clients.length) cc.appendChild(el('p', 'empty', 'Nenhum cliente. Cadastre pra amarrar tarefas e valores a cada um.'));
      clients.forEach((c) => cc.appendChild(clientRow(c, () => renderFinancas(v))));
      v.appendChild(cc);
    } catch { /* opcional */ }
  }
}

function clientRow(c, refresh) {
  const row = el('div', 'tx');
  row.style.cursor = 'pointer';
  const initials = (c.name || '?').trim().slice(0, 2).toUpperCase();
  row.innerHTML = `<div class="tx-ic">${esc(initials)}</div>
    <div class="tx-body"><div class="tx-desc">${esc(c.name)}${c.active ? '' : ' <span class="status-chip off">inativo</span>'}</div>
      <div class="tx-cat">recebido ${brl(c.recebido)} · a receber ${brl(c.aReceber)} · ${c.tarefasAbertas} tarefa${c.tarefasAbertas === 1 ? '' : 's'}</div></div>
    <div class="tx-amt in">${brl(c.recebido)}</div>`;
  row.querySelector('.tx-body').addEventListener('click', () => clientForm(c, refresh));
  return row;
}

function clientForm(existing, refresh) {
  const form = el('form', 'modal-form');
  form.innerHTML = `
    <label>Nome<input name="name" required value="${esc(existing?.name || '')}" placeholder="Ex.: Acme Ltda / Projeto site" /></label>
    <label>Notas<textarea name="notes" rows="2" placeholder="opcional">${esc(existing?.notes || '')}</textarea></label>
    ${existing ? `<label class="chk"><input type="checkbox" name="active" ${existing.active ? 'checked' : ''} /> Ativo</label>` : ''}
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>
    ${existing ? '<button type="button" class="add-btn" id="del-c" style="color:var(--neg)">Excluir</button>' : ''}
    <p class="error" id="c-msg"></p>`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: form.name.value, notes: form.notes.value || null };
    if (existing) body.active = form.active.checked;
    try {
      if (existing) await api('clients/' + existing.id, { method: 'PATCH', body });
      else await api('clients', { method: 'POST', body });
      closeModal(); toast('Cliente salvo'); refresh();
    } catch (err) { form.querySelector('#c-msg').textContent = err.message; }
  });
  if (existing) form.querySelector('#del-c').addEventListener('click', async () => {
    if (!confirm('Excluir cliente? Lançamentos e tarefas são desvinculados, não apagados.')) return;
    await api('clients/' + existing.id, { method: 'DELETE' }); closeModal(); toast('Cliente excluído'); refresh();
  });
  openModal(existing ? 'Editar cliente' : 'Novo cliente', form);
}

// injeta um seletor de cliente no form (tarefa/lançamento) quando há clientes e o âmbito é empresa/tudo
async function injectClientSelect(form, selectedId) {
  if (ambito === 'pessoal') return;
  let clients = [];
  try { clients = await api('clients'); } catch { return; }
  const usable = clients.filter((c) => c.active || String(c.id) === String(selectedId));
  if (!usable.length) return;
  const label = el('label', '', 'Cliente / projeto');
  const sel = el('select');
  sel.name = 'client_id';
  sel.innerHTML = '<option value="">— nenhum —</option>' +
    usable.map((c) => `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  label.appendChild(sel);
  const firstBtn = form.querySelector('button[type="submit"]');
  form.insertBefore(label, firstBtn);
}

function reportCompare(rep) {
  const wrap = el('div', 'report');
  const col = (label, d) => `<div class="rep-col"><div class="rep-h">${label}</div>
    <div class="rep-row"><span>Entrou</span><b class="pos num">${brl(d.entradas)}</b></div>
    <div class="rep-row"><span>Saiu</span><b class="num">${brl(d.saidas)}</b></div>
    <div class="rep-row tot"><span>Saldo</span><b class="num ${d.saldo < 0 ? 'neg' : 'pos'}">${brl(d.saldo)}</b></div></div>`;
  wrap.innerHTML = col('Pessoal', rep.pessoal) + col('Empresa', rep.empresa) + col('Total', rep.total);
  return wrap;
}

function budgetRow(b, refresh) {
  const ratio = b.limit_amount ? b.spent / b.limit_amount : 0;
  const pct = Math.min(Math.round(ratio * 100), 100);
  const state = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
  const row = el('div', 'cat-bar');
  row.style.cursor = 'pointer';
  row.innerHTML = `<div class="cat-top"><span>${esc(b.category)}</span><span class="num">${brl(b.spent)} / ${brl(b.limit_amount)}</span></div>
    <div class="cat-line"><i class="bud-${state}" style="width:${pct}%"></i></div>`;
  row.addEventListener('click', () => budgetForm(b, refresh));
  return row;
}

function budgetForm(existing, refresh) {
  const form = el('form', 'modal-form');
  form.innerHTML = `
    <label>Categoria<input name="category" list="cats-b" value="${esc(existing?.category || '')}" ${existing ? 'readonly' : ''} placeholder="Ex.: Mercado" />
      <datalist id="cats-b"><option>Moradia</option><option>Mercado</option><option>Transporte</option><option>Saúde</option><option>Lazer</option><option>Contas</option><option>Software</option><option>Outros</option></datalist></label>
    <label>Teto no mês (R$)<input name="limit" type="number" step="0.01" min="0.01" required value="${existing?.limit_amount ?? ''}" /></label>
    <button class="btn-primary" type="submit">Salvar meta</button>
    ${existing ? '<button type="button" class="add-btn" id="del-b" style="color:var(--neg)">Excluir meta</button>' : ''}
    <p class="error" id="b-msg"></p>`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('budgets', { method: 'POST', body: { category: form.category.value, ambito: ambitoWrite(), limit_amount: Number(form.limit.value) } });
      closeModal(); toast('Meta salva'); refresh();
    } catch (err) { form.querySelector('#b-msg').textContent = err.message; }
  });
  if (existing) form.querySelector('#del-b').addEventListener('click', async () => {
    await api('budgets/' + existing.id, { method: 'DELETE' }); closeModal(); toast('Meta excluída'); refresh();
  });
  openModal(existing ? 'Editar meta' : 'Nova meta', form);
}

function recurringItem(r, refresh) {
  const isIn = r.type === 'entrada';
  const row = el('div', 'tx');
  row.style.cursor = 'pointer';
  row.innerHTML = `<div class="tx-ic ${isIn ? 'in' : 'out'}">${isIn ? '↑' : '↓'}</div>
    <div class="tx-body"><div class="tx-desc">${esc(r.description || r.category)}${r.active ? '' : ' <span class="status-chip off">pausada</span>'}</div>
      <div class="tx-cat">${esc(r.category)} · todo dia ${r.day_of_month}${ambito === 'tudo' ? ' · ' + (r.ambito === 'empresa' ? 'EMP' : 'PES') : ''}</div></div>
    <div class="tx-amt ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${brl(r.amount)}</div>`;
  row.querySelector('.tx-body').addEventListener('click', () => recurringForm(r, refresh));
  return row;
}

function recurringForm(existing, refresh) {
  const type = existing?.type || 'saida';
  const form = el('form', 'modal-form');
  form.innerHTML = `
    <div class="seg ${type === 'entrada' ? 'in' : 'out'}" id="rec-type">
      <button type="button" data-t="entrada" class="${type === 'entrada' ? 'on' : ''}">Entrada</button>
      <button type="button" data-t="saida" class="${type === 'saida' ? 'on' : ''}">Saída</button>
    </div>
    <div class="row2">
      <label>Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" required value="${existing?.amount ?? ''}" /></label>
      <label>Todo dia<input name="dom" type="number" min="1" max="28" value="${existing?.day_of_month || 1}" /></label>
    </div>
    <label>Categoria<input name="category" list="cats-r" value="${esc(existing?.category || '')}" placeholder="Ex.: Aluguel" />
      <datalist id="cats-r"><option>Moradia</option><option>Contas</option><option>Software</option><option>Salário</option><option>Impostos</option><option>Outros</option></datalist></label>
    <label>Descrição<input name="description" value="${esc(existing?.description || '')}" placeholder="Ex.: Aluguel do escritório" /></label>
    ${existing ? `<label class="chk"><input type="checkbox" name="active" ${existing.active ? 'checked' : ''} /> Ativa (gera lançamento todo mês)</label>` : ''}
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>
    ${existing ? '<button type="button" class="add-btn" id="del-r" style="color:var(--neg)">Excluir</button>' : ''}
    <p class="error" id="r-msg"></p>`;
  let curType = type;
  form.querySelector('#rec-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    curType = b.dataset.t;
    $$('#rec-type button').forEach((x) => x.classList.toggle('on', x === b));
    form.querySelector('#rec-type').className = 'seg ' + (curType === 'entrada' ? 'in' : 'out');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { type: curType, amount: Number(form.amount.value), category: form.category.value || 'Outros', description: form.description.value || null, day_of_month: Number(form.dom.value), ambito: ambitoWrite() };
    if (existing) body.active = form.active.checked;
    try {
      if (existing) await api('recurring/' + existing.id, { method: 'PATCH', body });
      else await api('recurring', { method: 'POST', body });
      closeModal(); toast('Recorrente salva'); refresh();
    } catch (err) { form.querySelector('#r-msg').textContent = err.message; }
  });
  if (existing) form.querySelector('#del-r').addEventListener('click', async () => {
    if (!confirm('Excluir esta conta recorrente? Os lançamentos já gerados continuam.')) return;
    await api('recurring/' + existing.id, { method: 'DELETE' }); closeModal(); toast('Excluída'); refresh();
  });
  openModal(existing ? 'Editar recorrente' : 'Nova conta recorrente', form);
}

function txRow(t, refresh) {
  const isIn = t.type === 'entrada';
  const row = el('div', 'tx');
  row.innerHTML = `
    <div class="tx-ic ${isIn ? 'in' : 'out'}">${isIn ? '↑' : '↓'}</div>
    <div class="tx-body">
      <div class="tx-desc">${esc(t.description || t.category)}</div>
      <div class="tx-cat">${esc(t.category)} · ${fmtDate(t.date)}${t.paid ? '' : ' · em aberto'}</div>
    </div>
    <div class="tx-amt ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${brl(t.amount)}</div>`;
  row.querySelector('.tx-body').addEventListener('click', () => txForm(t));
  return row;
}

function recvRow(t, refresh) {
  const overdue = t.due_date && t.due_date < todayStr();
  const row = el('div', 'tx');
  row.innerHTML = `<div class="tx-ic in">↑</div>
    <div class="tx-body"><div class="tx-desc">${esc(t.description || t.category)}</div>
      <div class="tx-cat">${t.due_date ? (overdue ? 'venceu ' : 'prev. ') + fmtDate(t.due_date) : 'sem data'}</div></div>`;
  const rec = el('button', 'add-btn', 'Recebi');
  rec.addEventListener('click', async () => { await api(`finance/${t.id}/pay`, { method: 'POST' }); toast('Recebimento confirmado'); refresh(); });
  row.appendChild(rec);
  return row;
}

function pendingRow(t, refresh) {
  const overdue = t.due_date && t.due_date < todayStr();
  const row = el('div', 'tx');
  row.innerHTML = `
    <div class="tx-ic out">↓</div>
    <div class="tx-body"><div class="tx-desc">${esc(t.description || t.category)}</div>
      <div class="tx-cat">${overdue ? 'venceu ' : 'vence '}${fmtDate(t.due_date) || '—'}</div></div>`;
  const pay = el('button', 'add-btn', 'Pagar');
  pay.addEventListener('click', async () => { await api(`finance/${t.id}/pay`, { method: 'POST' }); toast('Conta paga'); refresh(); });
  row.appendChild(pay);
  return row;
}

function txForm(existing) {
  const form = el('form', 'modal-form');
  const type = existing?.type || 'saida';
  form.innerHTML = `
    <div class="seg ${type === 'entrada' ? 'in' : 'out'}" id="tx-type">
      <button type="button" data-t="entrada" class="${type === 'entrada' ? 'on' : ''}">Entrada</button>
      <button type="button" data-t="saida" class="${type === 'saida' ? 'on' : ''}">Saída</button>
    </div>
    <div class="row2">
      <label>Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" required value="${existing?.amount ?? ''}" /></label>
      <label>Data<input name="date" type="date" value="${existing?.date || todayStr()}" /></label>
    </div>
    <label>Categoria<input name="category" list="cats" value="${esc(existing?.category || '')}" placeholder="Ex.: Mercado" />
      <datalist id="cats"><option>Moradia</option><option>Mercado</option><option>Transporte</option><option>Saúde</option><option>Lazer</option><option>Contas</option><option>Salário</option><option>Outros</option></datalist>
    </label>
    <label>Descrição<input name="description" value="${esc(existing?.description || '')}" placeholder="opcional" /></label>
    <label class="chk"><input type="checkbox" name="pending" ${existing && !existing.paid ? 'checked' : ''} style="width:auto" /> <span id="pending-label">${type === 'entrada' ? 'É valor a receber (em aberto)' : 'É conta a pagar (em aberto)'}</span></label>
    <label id="due-wrap" class="${existing && !existing.paid ? '' : 'hidden'}"><span id="due-label">${type === 'entrada' ? 'Previsão de recebimento' : 'Vencimento'}</span><input name="due_date" type="date" value="${existing?.due_date || ''}" /></label>
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>
    ${existing ? '<button type="button" class="add-btn" id="del-tx" style="background:var(--red-soft);color:var(--red)">Excluir</button>' : ''}`;

  let curType = type;
  form.querySelector('#tx-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    curType = b.dataset.t;
    $$('#tx-type button').forEach((x) => x.classList.toggle('on', x === b));
    form.querySelector('#tx-type').className = 'seg ' + (curType === 'entrada' ? 'in' : 'out');
    form.querySelector('#pending-label').textContent = curType === 'entrada' ? 'É valor a receber (em aberto)' : 'É conta a pagar (em aberto)';
    form.querySelector('#due-label').textContent = curType === 'entrada' ? 'Previsão de recebimento' : 'Vencimento';
  });
  form.pending.addEventListener('change', () => form.querySelector('#due-wrap').classList.toggle('hidden', !form.pending.checked));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      type: curType,
      amount: Number(form.amount.value),
      category: form.category.value || 'Outros',
      description: form.description.value || null,
      date: form.date.value || todayStr(),
      paid: form.pending.checked ? 0 : 1,
      due_date: form.pending.checked ? form.due_date.value || null : null,
      ambito: ambitoWrite(),
      client_id: form.client_id ? (form.client_id.value || null) : undefined,
    };
    if (existing) await api('finance/' + existing.id, { method: 'PATCH', body });
    else await api('finance', { method: 'POST', body });
    closeModal(); toast('Lançamento salvo'); render();
  });
  if (existing) {
    form.querySelector('#del-tx').addEventListener('click', async () => {
      await api('finance/' + existing.id, { method: 'DELETE' });
      closeModal(); toast('Excluído'); render();
    });
  }
  openModal(existing ? 'Editar lançamento' : 'Novo lançamento', form);
  injectClientSelect(form, existing?.client_id);
}

/* ---------- importar extrato bancário (OFX/CSV) ---------- */
function importForm() {
  const form = el('div', 'modal-form');
  form.innerHTML = `
    <p class="hint">Exporte o extrato no app/site do banco (arquivo <b>OFX</b> ou <b>CSV</b>) e selecione abaixo. Caixa e PagBank costumam ter OFX; PicPay e InfinitePay, CSV. O arquivo é lido aqui e vira lançamentos — nada é enviado pra fora.</p>
    <div class="row2">
      <label>Banco<select id="imp-bank"><option>Caixa</option><option>PagBank</option><option>PicPay</option><option>InfinitePay</option><option>Outro</option></select></label>
      <label>Âmbito<select id="imp-amb"><option value="pessoal">Pessoal</option><option value="empresa">Empresa</option></select></label>
    </div>
    <label>Arquivo (.ofx / .csv)<input type="file" id="imp-file" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" /></label>
    <div id="imp-result"></div>`;
  form.querySelector('#imp-amb').value = ambitoWrite();
  const result = form.querySelector('#imp-result');
  form.querySelector('#imp-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    result.innerHTML = '<p class="empty">Lendo…</p>';
    let text;
    try { text = await file.text(); } catch { result.innerHTML = '<p class="error">Não consegui ler o arquivo.</p>'; return; }
    try {
      const prev = await api('import/preview', { method: 'POST', body: { text } });
      renderImportPreview(result, prev, form);
    } catch (err) { result.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
  openModal('Importar extrato', form);
}

function renderImportPreview(container, prev, form) {
  container.innerHTML = '';
  container.appendChild(el('p', 'hint', `Formato ${prev.format.toUpperCase()} · ${prev.novos} novo(s) · ${prev.duplicados} já importado(s).`));
  if (!prev.transactions.length) {
    container.appendChild(el('p', 'empty', 'Nenhum lançamento reconhecido neste arquivo.'));
    return;
  }
  const list = el('div', 'card');
  list.style.cssText = 'max-height:44vh;overflow:auto;margin:8px 0;padding:6px 12px';
  prev.transactions.forEach((t, i) => {
    const row = el('label', 'imp-row');
    row.innerHTML = `<input type="checkbox" ${t.dup ? '' : 'checked'} data-i="${i}" />
      <span class="imp-d">${fmtDate(t.date)}</span>
      <span class="imp-desc">${esc(t.description)}${t.dup ? ' <span class="status-chip off">dup</span>' : ''}</span>
      <span class="imp-amt ${t.type === 'entrada' ? 'pos' : 'neg'}">${t.type === 'entrada' ? '+' : '−'}${brl(t.amount)}</span>`;
    list.appendChild(row);
  });
  container.appendChild(list);
  const btn = el('button', 'btn-primary', 'Importar selecionados');
  btn.addEventListener('click', async () => {
    const chosen = [];
    $$('input[type=checkbox][data-i]', list).forEach((c) => { if (c.checked) chosen.push(prev.transactions[Number(c.dataset.i)]); });
    if (!chosen.length) { toast('Nada selecionado'); return; }
    btn.disabled = true;
    try {
      const r = await api('import/commit', {
        method: 'POST',
        body: { ambito: form.querySelector('#imp-amb').value, category: 'Extrato ' + form.querySelector('#imp-bank').value, transactions: chosen },
      });
      closeModal();
      toast(`${r.imported} importado(s)${r.skipped ? `, ${r.skipped} pulado(s)` : ''}`);
      render();
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
  container.appendChild(btn);
}

/* ---------- helpers de mês ---------- */
function monthLabel(m) {
  const [y, mo] = m.split('-');
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

/* ---------- boot ---------- */
function agendaFeedback() {
  const p = new URLSearchParams(location.search).get('agenda');
  if (!p) return;
  const msg = { ok: 'Google Agenda conectada ✓', erro: 'Falha ao conectar a agenda', estado: 'Sessão expirou, tente de novo', sem_refresh: 'Reconecte (sem token de atualização)' }[p] || '';
  if (msg) setTimeout(() => toast(msg), 300);
  history.replaceState(null, '', location.pathname); // limpa o ?agenda=
}

async function boot() {
  try {
    await api('auth/me');
    showApp();
    api('settings').then((s) => applyTheme(s.theme)).catch(() => {});
    switchView('hoje');
    agendaFeedback();
  } catch {
    showAuth();
  }
}

/* service worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {}));
}

boot();

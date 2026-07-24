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

/* ---------- configurações ---------- */
$('#btn-settings').addEventListener('click', settingsForm);

function settingsForm() {
  const cur = localStorage.getItem(THEME_KEY) || 'system';
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

  // Trocar senha
  const pwForm = el('form', 'modal-form');
  pwForm.style.marginTop = '20px';
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

/* ---------- navegação ---------- */
const TITLES = { hoje: 'Hoje', autocuidado: 'Autocuidado', tarefas: 'Tarefas', financas: 'Finanças' };
let currentView = 'hoje';
$$('.tabbar-btn').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view))
);
function switchView(view) {
  currentView = view;
  $$('.tabbar-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#topbar-title').textContent = TITLES[view];
  render();
}

async function render() {
  const v = $('#view');
  v.innerHTML = '<p class="empty">Carregando…</p>';
  try {
    if (currentView === 'hoje') await renderHoje(v);
    else if (currentView === 'autocuidado') await renderAutocuidado(v);
    else if (currentView === 'tarefas') await renderTarefas(v);
    else if (currentView === 'financas') await renderFinancas(v);
  } catch (err) {
    if (err.message !== 'unauth') v.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

/* ============ HOJE (dashboard) ============ */
async function renderHoje(v) {
  const d = await api('dashboard');
  v.innerHTML = '';
  v.appendChild(el('p', 'hello', `${d.saudacao}! Aqui está o seu dia.`));

  // resumo financeiro
  const fin = el('div', 'stats');
  fin.innerHTML = `
    <div class="stat in"><div class="v">${brl(d.financas.entradas)}</div><div class="l">Entradas</div></div>
    <div class="stat out"><div class="v">${brl(d.financas.saidas)}</div><div class="l">Saídas</div></div>
    <div class="stat"><div class="v">${brl(d.financas.saldo)}</div><div class="l">Saldo</div></div>`;
  v.appendChild(fin);

  // autocuidado
  const ac = el('div', 'card');
  ac.appendChild(el('div', 'card-title', `Autocuidado · ${d.autocuidado.feitos}/${d.autocuidado.total}`));
  const pct = d.autocuidado.total ? Math.round((d.autocuidado.feitos / d.autocuidado.total) * 100) : 0;
  ac.appendChild(el('div', 'progress-line', `<i style="width:${pct}%"></i>`));
  if (!d.autocuidado.itens.length) ac.appendChild(el('p', 'empty', 'Nenhum hábito cadastrado.'));
  d.autocuidado.itens.forEach((h) => ac.appendChild(habitRow(h, () => renderHoje(v))));
  v.appendChild(ac);

  // tarefas do dia
  const tk = el('div', 'card');
  const head = el('div', 'card-title', `Tarefas de hoje${d.tarefas.atrasadas ? ` · ${d.tarefas.atrasadas} atrasada(s)` : ''}`);
  tk.appendChild(head);
  if (!d.tarefas.itens.length) tk.appendChild(el('p', 'empty', 'Tudo em dia por aqui 🎉'));
  d.tarefas.itens.forEach((t) => tk.appendChild(taskRow(t, () => renderHoje(v))));
  v.appendChild(tk);

  // contas a pagar
  if (d.financas.contasAbertas.length) {
    const cp = el('div', 'card');
    cp.appendChild(el('div', 'card-title', `Contas a pagar · ${brl(d.financas.contasAbertasTotal)}`));
    d.financas.contasAbertas.forEach((t) => cp.appendChild(pendingRow(t, () => renderHoje(v))));
    v.appendChild(cp);
  }
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
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>
    ${existing ? '<button type="button" class="add-btn" id="del-habit" style="background:var(--red-soft);color:var(--red)">Excluir hábito</button>' : ''}`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: form.name.value, icon: form.icon.value, goal: Number(form.goal.value) };
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
  const tasks = await api('tasks?scope=' + taskScope);
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
    };
    if (existing) await api('tasks/' + existing.id, { method: 'PATCH', body });
    else await api('tasks', { method: 'POST', body });
    closeModal(); toast('Tarefa salva'); render();
  });
  openModal(existing ? 'Editar tarefa' : 'Nova tarefa', form);
}

/* ============ FINANÇAS ============ */
let finMonth = new Date().toISOString().slice(0, 7);
async function renderFinancas(v) {
  const d = await api('finance?month=' + finMonth);
  v.innerHTML = '';
  const head = el('div', 'section-h');
  head.innerHTML = '<h2>Finanças</h2>';
  const add = el('button', 'add-btn', '+ Lançamento');
  add.addEventListener('click', () => txForm());
  head.appendChild(add);
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
    <label class="chk"><input type="checkbox" name="pending" ${existing && !existing.paid ? 'checked' : ''} style="width:auto" /> É conta a pagar (em aberto)</label>
    <label id="due-wrap" class="${existing && !existing.paid ? '' : 'hidden'}">Vencimento<input name="due_date" type="date" value="${existing?.due_date || ''}" /></label>
    <button class="btn-primary" type="submit">${existing ? 'Salvar' : 'Adicionar'}</button>
    ${existing ? '<button type="button" class="add-btn" id="del-tx" style="background:var(--red-soft);color:var(--red)">Excluir</button>' : ''}`;

  let curType = type;
  form.querySelector('#tx-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    curType = b.dataset.t;
    $$('#tx-type button').forEach((x) => x.classList.toggle('on', x === b));
    form.querySelector('#tx-type').className = 'seg ' + (curType === 'entrada' ? 'in' : 'out');
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
async function boot() {
  try {
    await api('auth/me');
    showApp();
    api('settings').then((s) => applyTheme(s.theme)).catch(() => {});
    switchView('hoje');
  } catch {
    showAuth();
  }
}

/* service worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {}));
}

boot();

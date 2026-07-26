/* Service worker — cache do app shell (offline-first) + notificações push */
const VERSION = 'painel-v12';
const BASE = self.registration.scope; // termina com / (ex.: https://site/pfin/)
const SHELL = [
  '',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
].map((p) => BASE + p);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: sempre rede (não cacheia dados do usuário)
  if (url.pathname.includes('/api/')) {
    return; // deixa o navegador tratar; sem cache
  }

  // App shell: network-first com fallback ao cache (bom para atualizações)
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || caches.match(BASE + 'index.html'))
      )
  );
});

/* ---------- Notificações push ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Meu Painel';
  const opts = {
    body: d.body || '',
    tag: d.tag || 'painel',
    renotify: true,
    icon: BASE + 'icons/icon.svg',
    badge: BASE + 'icons/icon.svg',
    data: { url: d.url || BASE },
    vibrate: [80, 40, 80],
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Clicar na notificação: foca uma aba já aberta ou abre o app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(target) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

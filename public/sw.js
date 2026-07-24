/* Service worker — cache do app shell (offline-first para a casca da PWA) */
const VERSION = 'painel-v1';
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

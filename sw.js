// ═══════════════════════════════════════════════════════════════════
// DIÁRIO DE VIDA — Service Worker
// Funcionalidades: cache offline + notificações (locais e push)
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'diario-v5';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ── Instalar: cache dos assets principais
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Ativar: limpar caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: rede primeiro, cache quando não há rede
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Abrir a app a partir de uma notificação
function abrirApp() {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow('./');
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(abrirApp());
});

// ── Notificação enviada pela página (com a app aberta)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = e.data;
    self.registration.showNotification(title, {
      body,
      icon: icon || './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'diario-lembrete',
      renotify: true,
    });
  }
});

// ── Push a sério (quando o servidor enviar)
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) {
    try { payload = { body: e.data ? e.data.text() : '' }; } catch (e2) { payload = {}; }
  }
  const title = payload.title || 'Diário de Vida';
  const body = payload.body || 'Um lembrete pequeno, sem pressa.';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: payload.tag || 'diario-push',
      data: { url: payload.url || './' },
      renotify: true,
    })
  );
});

self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      list.forEach(c => c.postMessage({ type: 'PUSH_RESUBSCRIBE' }));
    })
  );
});

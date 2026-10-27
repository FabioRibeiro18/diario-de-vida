// ═══════════════════════════════════════════════════════════════════
// DIÁRIO DE VIDA — Service Worker
// Funcionalidades: cache offline + notificações push
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'diario-v4';
const ASSETS = [
  './',
  './index.html',
  './quick/index.html',
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

// ── Fetch: serve do cache se offline
self.addEventListener('fetch', e => {
  // Apenas pedidos GET locais
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

// ── Notificações push agendadas
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow(self.registration.scope);
      }
    })
  );
});

// ── Receber mensagem para mostrar notificação
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = e.data;
    const iconUrl = new URL('icon-192.png', self.registration.scope).href;
    self.registration.showNotification(title, {
      body,
      icon: icon || iconUrl,
      badge: iconUrl,
      vibrate: [200, 100, 200],
      tag: 'diario-lembrete',
      renotify: true,
    });
  }
});

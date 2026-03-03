// ═══════════════════════════════════════════════════════════════════
// DIÁRIO DE VIDA — Service Worker
// Funcionalidades: cache offline + notificações push
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'diario-v1';
const ASSETS = [
  '/diario-de-vida/',
  '/diario-de-vida/index.html',
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
  // Só para assets do próprio site
  if (!e.request.url.includes('diario-de-vida')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Atualiza cache com resposta nova
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
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
        clients.openWindow('/diario-de-vida/');
      }
    })
  );
});

// ── Receber mensagem para mostrar notificação
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = e.data;
    self.registration.showNotification(title, {
      body,
      icon: icon || '/diario-de-vida/icon-192.png',
      badge: '/diario-de-vida/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'diario-lembrete',
      renotify: true,
    });
  }
});

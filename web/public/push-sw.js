/*
 * Service worker for optional browser push notifications ("your turn", "fleet destroyed", ...).
 * FCM delivers the message written by functions/src/triggers/notifications.ts as JSON:
 *   { notification: { title, body }, data: { gameId } }
 * We show it and open the game when tapped. In-app indicators never depend on this file.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const n = payload.notification || {};
  const gameId = payload.data && payload.data.gameId;
  event.waitUntil(
    self.registration.showNotification(n.title || 'Broadside', {
      body: n.body || '',
      icon: '/icon.svg',
      tag: gameId || 'broadside',
      renotify: true,
      data: { gameId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const gameId = event.notification.data && event.notification.data.gameId;
  const url = new URL(gameId ? `/game/${gameId}` : '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c);
      if (existing) {
        existing.navigate(url);
        return existing.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

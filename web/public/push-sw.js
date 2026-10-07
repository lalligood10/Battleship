/*
 * Service worker for optional browser push notifications ("your turn", "fleet destroyed",
 * challenge accepted/declined, ...). FCM delivers the message written by
 * functions/src/triggers/notifications.ts as JSON:
 *   { notification: { title, body }, data: { gameId?, challengeId? } }
 * We show it and open the game when tapped; challenge pushes without a game open Home.
 * In-app indicators never depend on this file.
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
  const challengeId = payload.data && payload.data.challengeId;
  event.waitUntil(
    self.registration.showNotification(n.title || 'Broadside', {
      body: n.body || '',
      icon: '/icon.svg',
      tag: gameId || (challengeId ? `challenge-${challengeId}` : 'broadside'),
      renotify: true,
      data: { gameId, challengeId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  // Challenge pushes open Home, where the invite (or the new game) is waiting.
  const url = new URL(data.gameId ? `/game/${data.gameId}` : '/', self.location.origin).href;
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

/* public/sw-push.js */
/* Runs inside the Service Worker context (imported by next-pwa's sw.js) */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // fallback if payload isn't JSON
    try {
      data = { title: 'Doorbell', body: event.data ? event.data.text() : '' };
    } catch {
      data = {};
    }
  }

  const title = data.title || 'Doorbell';
  const body = data.body || 'Someone is ringing.';
  const url = data.url || '/receiver';

  const options = {
    body,
    data: { url },
    // You can add icon/badge once you have them:
    // icon: '/icon-192.png',
    // badge: '/badge-72.png',
    tag: data.tag || 'doorbell-ring',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/receiver';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // If a tab is already open, focus it
    for (const client of allClients) {
      if ('focus' in client) {
        // If it's already at receiver, focus; otherwise still focus & navigate if possible
        try {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl);
          }
          return;
        } catch {
          // ignore
        }
      }
    }

    // Otherwise open a new window
    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});

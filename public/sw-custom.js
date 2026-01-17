// public/sw-custom.js

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'Doorbell', body: event.data ? event.data.text() : 'Someone rang.' }
  }

  const title = data.title || 'Doorbell'
  const options = {
    body: data.body || 'Someone rang the doorbell.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    data: data.data || { url: '/receiver' },
    tag: data.tag || 'doorbell-ring',
    renotify: true,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url =
    (event.notification && event.notification.data && event.notification.data.url) || '/receiver'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // If your receiver is already open, focus it.
        if (client.url.includes('/receiver') && 'focus' in client) return client.focus()
      }
      // Otherwise open it.
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

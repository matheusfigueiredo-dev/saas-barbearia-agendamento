self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { self.clients.claim() })

self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {}
    const title = data.title || 'Novo agendamento'
    const body = data.body || ''
    const tag = data.tag || 'booking'
    const options = { body, tag, icon: data.icon || undefined, badge: data.badge || undefined, data: data }
    event.waitUntil(self.registration.showNotification(title, options))
  } catch (e) {
    event.waitUntil(self.registration.showNotification('Novo agendamento', { body: 'Você tem um novo agendamento.' }))
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = self.registration.scope // abre a página da PWA
  event.waitUntil(clients.matchAll({ type: 'window' }).then((list) => {
    for (const client of list) { if ('focus' in client) return client.focus() }
    if (clients.openWindow) return clients.openWindow(url)
  }))
})

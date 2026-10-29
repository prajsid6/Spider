self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || 'A nearby person needs help.' };
  }

  const title = payload.title || 'Spider Safety SOS';
  const appUrl = payload.url && payload.url !== '/' ? payload.url : self.registration.scope;
  const options = {
    body: payload.body || 'A nearby person needs urgent help. Open Spider to respond.',
    icon: new URL('favicon.svg', self.registration.scope).href,
    badge: new URL('favicon.svg', self.registration.scope).href,
    tag: payload.tag || 'spider-safety-sos',
    renotify: true,
    actions: payload.mapUrl ? [{ action: 'open-map', title: 'Open map' }] : [],
    data: { url: appUrl, mapUrl: payload.mapUrl || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open-map' && event.notification.data?.mapUrl) {
    event.waitUntil(self.clients.openWindow(event.notification.data.mapUrl));
    return;
  }
  const targetUrl = new URL(event.notification.data?.url || self.registration.scope, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existingClient) {
        existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

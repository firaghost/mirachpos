importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

const parseConfig = () => {
  try {
    const params = new URLSearchParams(self.location.search || '');
    const raw = params.get('config');
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
};

const config = parseConfig();
if (config && config.apiKey) {
  firebase.initializeApp(config);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || 'MirachPOS';
    const body = payload?.notification?.body || '';
    const data = payload?.data || {};

    const options = {
      body,
      icon: '/app.icon.png',
      data,
    };

    self.registration.showNotification(title, options);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const clickAction = event?.notification?.data?.clickAction || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(clickAction);
      return undefined;
    }),
  );
});

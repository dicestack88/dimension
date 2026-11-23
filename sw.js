self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(payload.title || "Dimension").slice(0, 80);
  const options = {
    body: String(payload.body || "You have a new notification.").slice(0, 180),
    icon: "assets/dimension-notification.png",
    badge: "assets/dimension-notification.png",
    tag: String(payload.tag || "dimension-notification").slice(0, 100),
    data: { url: String(payload.url || "notifications.html") },
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "notifications.html", self.registration.scope).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        await client.focus();
        if ("navigate" in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

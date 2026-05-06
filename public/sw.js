// Web Push service worker. Only handles push + notificationclick.
// No offline caching — we rely on Next's own caching strategy.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { title: "Notification", body: event.data.text(), href: null, icon: null, tag: "fallback" };
  }

  const title = typeof payload.title === "string" && payload.title.length > 0
    ? payload.title
    : "New notification";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 240) : "";
  const icon = typeof payload.icon === "string" && payload.icon.length > 0 ? payload.icon : "/favicon.ico";
  const tag = typeof payload.tag === "string" && payload.tag.length > 0 ? payload.tag : "notification";
  const href = typeof payload.href === "string" ? payload.href : null;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      badge: "/favicon.ico",
      data: { href, id: payload.id || null },
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data && event.notification.data.href;
  const targetUrl = typeof href === "string" && href.length > 0
    ? new URL(href, self.location.origin).href
    : self.location.origin + "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client && typeof client.navigate === "function") {
              try {
                await client.navigate(targetUrl);
              } catch (error) {
                // best effort
              }
            }
            return;
          }
        } catch (error) {
          // ignore
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

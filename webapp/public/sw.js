// Phewrunn Service Worker — handles push notifications
// This file is served from the root so it has full-scope access.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Phewrunn", body: event.data.text() };
  }

  const { title = "Phewrunn", body = "", icon, badge, url, tag } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || "/phew-mark.svg",
      badge: badge || "/phew-mark.svg",
      data: { url: url || "/" },
      tag: tag || "phewrunn",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and navigate
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              client.navigate(targetUrl);
            }
            return;
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

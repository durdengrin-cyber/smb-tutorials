// Push only. No caching, no offline shell, no precache manifest.
//
// That is a deliberate limit (spec §7.1): caching a Next.js app carelessly
// serves stale RSC payloads, offline is out of scope for this cycle, and a
// worker that only handles push has almost no failure surface to debug at
// 2am. If offline is ever wanted, it arrives as its own decision.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload must still wake the teacher: userVisibleOnly means
    // a push that shows nothing is a permission violation, and browsers
    // punish it by revoking the subscription.
  }
  const title = data.title || "New session request";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "A student is asking for a session.",
      tag: data.tag || "session-request",
      data: { url: data.url || "/dashboard" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      requireInteraction: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Focus a tab that is already on the dashboard rather than opening a
      // second one — two dashboards means two presence entries and a teacher
      // who cannot tell which is live.
      for (const client of list) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// Fired when the browser rotates a subscription. Handled, but NOT trusted:
// Safari's support is thin, so the real backstop is the re-registration the
// dashboard performs on every mount (spec §8).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : undefined,
      })
      .then((sub) =>
        fetch("/api/devices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        })
      )
      .catch(() => {
        // Nothing to do here. The dashboard's mount-time re-registration
        // repairs it the next time the teacher opens the app.
      })
  );
});

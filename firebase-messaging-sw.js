/* Service Worker de Web Push (Firebase Cloud Messaging) */
/* Recebe notificações em segundo plano e abre o link configurado ao clicar. */
importScripts("./assets/config.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

(function () {
  var cfg = (self.LG_CONFIG && self.LG_CONFIG.firebase) || {};
  if (cfg.apiKey && cfg.projectId && cfg.messagingSenderId && cfg.appId) {
    firebase.initializeApp(cfg);
    var messaging = firebase.messaging();
    messaging.onBackgroundMessage(function (payload) {
      var notif = payload.notification || {};
      var data = payload.data || {};
      var title = notif.title || "Larissa Galvão — Novidade";
      var options = {
        body: notif.body || "",
        icon: notif.icon || "./images/og-image.jpg",
        data: { url: data.url || "./" }
      };
      self.registration.showNotification(title, options);
    });
  }

  self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || "./";
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
    );
  });
})();

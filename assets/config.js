// Configuração pública do site e do painel administrativo.
// Nenhum segredo fica aqui — apenas identificadores públicos do Firebase, GA4 e URL do Worker.
// Preencha após seguir o guia em docs/setup-admin.md.
(function (root) {
  var config = {
    firebase: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: "",
      measurementId: ""
    },
    // Chave pública VAPID do Firebase Cloud Messaging (Configurações do Projeto -> Cloud Messaging -> Certificados Web Push)
    vapidKey: "",
    // URL do Cloudflare Worker responsável pelo upload no R2 e disparo de Web Push (ex.: https://larissagalvao-api.seu-subdominio.workers.dev)
    workerUrl: "",
    // ID de medição do Google Analytics 4 (ex.: G-XXXXXXXXXX). Pode também ser editado no painel.
    gaMeasurementId: "",
    // E-mails super-administradores (apenas conveniência de UI; a autorização real é validada nas firestore.rules e no Worker)
    bootstrapAdmins: []
  };

  root.LG_CONFIG = Object.assign({}, config, root.LG_CONFIG || {});
})(typeof window !== "undefined" ? window : globalThis);

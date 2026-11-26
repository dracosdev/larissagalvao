// Configuração pública do site e do painel administrativo.
// Nenhum segredo fica aqui — apenas identificadores públicos do Firebase, GA4 e URL do Worker.
// Preencha após seguir o guia em docs/setup-admin.md.
(function (root) {
  var config = {
    firebase: {
      apiKey: "AIzaSyBWloVxPT_-AcWQ9flu_31m3_KgtWzCFGc",
      authDomain: "larissa-galvao-site.firebaseapp.com",
      projectId: "larissa-galvao-site",
      storageBucket: "larissa-galvao-site.firebasestorage.app",
      messagingSenderId: "1009158519792",
      appId: "1:1009158519792:web:212cc62b70b726e32f7b35",
      measurementId: "G-SLRE2QH5C0"
    },
    // Chave pública VAPID do Firebase Cloud Messaging (Configurações do Projeto -> Cloud Messaging -> Certificados Web Push)
    vapidKey: "BM7YSZ4B_S_FpTc_F_q4mMBhK2Na08oOv_ZoHwrFNq3C32RaWqK-pPuaL8sqC42RcV48TR2_0p9_ETLR3x_oH6Y",
    // URL do Cloudflare Worker responsável pelo upload no R2 e disparo de Web Push (ex.: https://larissagalvao-api.seu-subdominio.workers.dev)
    workerUrl: "https://larissagalvao-api.diogo-793.workers.dev",
    // ID de medição do Google Analytics 4 (ex.: G-XXXXXXXXXX). Pode também ser editado no painel.
    gaMeasurementId: "G-SLRE2QH5C0",
    // E-mails super-administradores (apenas conveniência de UI; a autorização real é validada nas firestore.rules e no Worker)
    bootstrapAdmins: ["djmacloud@gmail.com"]
  };

  root.LG_CONFIG = Object.assign({}, config, root.LG_CONFIG || {});
})(typeof window !== "undefined" ? window : globalThis);

// Hidratação dinâmica do site público a partir do Firestore (REST API leve, sem peso extra no carregamento),
// rastreamento Google Analytics (GA4), cadastro de newsletter no Firestore e opt-in de Web Push (FCM).
(function () {
  "use strict";

  var CACHE_KEY = "lg_site_content_cache_v1";
  var PUSH_DISMISSED_KEY = "lg_push_dismissed_at";
  var PUSH_SUBSCRIBED_KEY = "lg_push_subscribed_v1";
  var core = window.LG_CMS_CORE;
  var cfg = window.LG_CONFIG || {};

  if (!core) return;

  function siteUrl() {
    return window.LG_SITE_URL || (window.location.origin + window.location.pathname.replace(/[^/]*\.html?$/i, ""));
  }

  // Converte valores da Firestore REST API para objetos JS comuns
  function fromFirestoreValue(val) {
    if (!val || typeof val !== "object") return null;
    if ("stringValue" in val) return val.stringValue;
    if ("booleanValue" in val) return val.booleanValue;
    if ("integerValue" in val) return Number(val.integerValue);
    if ("doubleValue" in val) return Number(val.doubleValue);
    if ("nullValue" in val) return null;
    if ("timestampValue" in val) return val.timestampValue;
    if ("arrayValue" in val) {
      return (val.arrayValue.values || []).map(fromFirestoreValue);
    }
    if ("mapValue" in val) {
      var out = {};
      var fields = val.mapValue.fields || {};
      Object.keys(fields).forEach(function (k) {
        out[k] = fromFirestoreValue(fields[k]);
      });
      return out;
    }
    return null;
  }

  function fromFirestoreDoc(doc) {
    if (!doc || !doc.fields) return null;
    var out = {};
    Object.keys(doc.fields).forEach(function (k) {
      out[k] = fromFirestoreValue(doc.fields[k]);
    });
    return out;
  }

  function isExternalHref(href) {
    return /^https?:/i.test(String(href || ""));
  }

  function renderNavLinks(items, isFooter) {
    var html = "";
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || !item.label) continue;
      var href = core.sanitizeUrl(item.href, { allowHash: true, allowRelative: true }) || "#inicio";
      var external = item.newTab || isExternalHref(href);
      var attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
      html += '<a href="' + core.escapeHtml(href) + '"' + attrs + ">" + core.escapeHtml(item.label) + "</a>";
      if (isFooter && i < list.length - 1) {
        html += '<span class="lg-footer-separator"></span>';
      }
    }
    return html;
  }

  function applyTopMenu(data) {
    if (!data || !Array.isArray(data.items) || !data.items.length) return;
    var desktopNav = document.querySelector('header nav[aria-label="Principal"]');
    var mobileNav = document.querySelector('#lg-mobile-sidebar nav[aria-label="Navegação mobile"]');
    var markup = renderNavLinks(data.items, false);
    if (desktopNav) desktopNav.innerHTML = markup;
    if (mobileNav) mobileNav.innerHTML = markup;
  }

  function applyFooterMenu(data) {
    if (!data || !Array.isArray(data.items) || !data.items.length) return;
    var footerNav = document.querySelector('footer nav[aria-label="Rodapé"]');
    if (footerNav) footerNav.innerHTML = renderNavLinks(data.items, true);
  }

  function applySocialLinks(data) {
    if (!data || !Array.isArray(data.items) || !data.items.length) return;
    var container = document.querySelector('[data-cms="social-links"]');
    if (!container) return;
    var html = "";
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      if (!item || !item.href) continue;
      var href = core.sanitizeUrl(item.href, { allowHash: false, allowRelative: false });
      if (!href) continue;
      var label = item.label || "Rede social";
      var iconHtml = core.renderIconHtml(item, core.SOCIAL_PRESETS, 19);
      html += '<a aria-label="' + core.escapeHtml(label) + '" href="' + core.escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + iconHtml + "</a>";
    }
    if (html) container.innerHTML = html;
  }

  function applyHero(data) {
    if (!data || !data.tagline) return;
    var el = document.querySelector('[data-cms="hero-tagline"]');
    if (!el) return;
    var lines = String(data.tagline).split(/\r?\n/);
    el.innerHTML = lines.map(core.escapeHtml).join("<br/>");
  }

  function applyAuthor(data) {
    if (!data) return;
    var titleEl = document.querySelector('[data-cms="author-title"]');
    var photoEl = document.querySelector('[data-cms="author-photo"]');
    var bioEl = document.querySelector('[data-cms="author-bio"]');
    if (titleEl && data.title) titleEl.textContent = data.title;
    if (photoEl && data.photoUrl) {
      var safePhoto = core.sanitizeUrl(data.photoUrl, { allowHash: false, allowRelative: true });
      if (safePhoto) photoEl.src = safePhoto;
      if (data.photoAlt) photoEl.alt = data.photoAlt;
    }
    if (bioEl && data.bioHtml) {
      var clean = core.sanitizeRichText(data.bioHtml);
      if (clean) bioEl.innerHTML = clean;
    }
  }

  function renderBookCard(book) {
    var title = String(book.title || "").trim();
    var cover = core.sanitizeUrl(book.coverUrl, { allowHash: false, allowRelative: true }) || "images/cover1.jpg";
    var desc = String(book.description || "");
    var tags = Array.isArray(book.tags) ? book.tags.filter(Boolean) : [];
    var buyUrl = core.normalizeAmazonUrl(book.buyUrl || "") || core.sanitizeUrl(book.buyUrl || "", { allowHash: false, allowRelative: false });
    var isComingSoon = Boolean(book.comingSoon) || !buyUrl;
    var buyLabel = String(book.buyLabel || (isComingSoon ? "Em breve" : "Comprar")).trim();

    var tagsHtml = tags.map(function (t) {
      return '<span style="font-size: 11.5px; padding: 3px 10px; border-radius: 999px; background: rgba(214,160,145,.12); border: 1px solid rgba(214,160,145,.22); color: #e2cbc4">' + core.escapeHtml(t) + "</span>";
    }).join("");

    var ctaHtml;
    if (isComingSoon) {
      ctaHtml = '<button type="button" class="lg-out disabled-coming-soon" disabled aria-disabled="true"><span>' + core.escapeHtml(buyLabel) + "</span></button>";
    } else {
      var isAmazon = /amazon\.com/i.test(buyUrl);
      var mark = isAmazon
        ? '<svg class="amazon-mark" viewBox="0 0 42 30" aria-hidden="true" focusable="false"><text x="8" y="20" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" fill="#fff4e8">a</text><path d="M7 23c8 5.2 19.5 5.2 28 .2" fill="none" stroke="#f2a847" stroke-width="2.3" stroke-linecap="round"/><path d="m30.7 20.7 5 2.5-5.4 1.6" fill="none" stroke="#f2a847" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : "";
      ctaHtml = '<a class="lg-out" href="' + core.escapeHtml(buyUrl) + '" rel="noopener noreferrer" target="_blank">' + mark + "<span>" + core.escapeHtml(buyLabel) + "</span></a>";
    }

    var shareTarget = isComingSoon ? siteUrl() : buyUrl;
    var shareText = isComingSoon
      ? "Olá, descobri uma obra interessante de Larissa Galvão: " + title + "\n" + shareTarget
      : "Olá, descobri um livro interessante..... " + title + " de Larissa Galvão:\n" + shareTarget;
    var waHref = "https://wa.me/?text=" + encodeURIComponent(shareText);
    var fbHref = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(shareTarget) + "&quote=" + encodeURIComponent(shareText);

    return '<article class="lg-card" style="display: flex; flex-direction: column; border: 1px solid rgba(214,160,145,.2); border-radius: 8px; background: linear-gradient(180deg, rgba(70,38,50,.42) 0%, rgba(30,16,22,.62) 100%); padding: 12px 14px 14px">' +
      '<img alt="Capa de ' + core.escapeHtml(title) + ', de Larissa Galvão" src="' + core.escapeHtml(cover) + '" style="display: block; width: 74%; aspect-ratio: 171 / 231; object-fit: cover; margin: 0 auto 0; box-shadow: 0 10px 28px rgba(0,0,0,.55)"/>' +
      '<h3 style="margin: 14px 0 0; font-family: \'Cormorant Garamond\', serif; font-weight: 500; font-size: 22px; color: #f0dcd5">' + core.escapeHtml(title) + "</h3>" +
      '<p style="margin: 8px 0 0; font-size: 13.5px; line-height: 1.4; color: #d6c2bc; flex-grow: 1">' + core.escapeHtml(desc) + "</p>" +
      '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px">' + tagsHtml + "</div>" +
      ctaHtml +
      '<div class="book-share-row" style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px">' +
      '<span class="book-share-label" style="display: flex; align-items: center; gap: 6px; color: #d6c2bc"><svg aria-hidden="true" fill="none" height="14" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="14"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"></path></svg>Recomendar</span>' +
      '<span class="book-share-icons" style="display:flex;align-items:center;gap:7px">' +
      '<a aria-label="Recomendar pelo WhatsApp" class="lg-soc social-whatsapp" href="' + core.escapeHtml(waHref) + '" rel="noopener noreferrer" target="_blank"><svg aria-hidden="true" fill="none" height="15" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="15"><path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z"></path><path d="M9.2 8.6c0 3.4 2.8 6.2 6.2 6.2l.9-1.4-1.8-.9-.9.9c-1.1-.5-2.3-1.7-2.8-2.8l.9-.9-.9-1.8z" fill="currentColor" stroke="none"></path></svg></a>' +
      '<a aria-label="Recomendar pelo Facebook" class="lg-soc social-facebook" href="' + core.escapeHtml(fbHref) + '" rel="noopener noreferrer" target="_blank"><svg aria-hidden="true" fill="currentColor" height="13" viewBox="0 0 24 24" width="13"><path d="M14 8.5V6.6c0-.8.4-1.1 1.2-1.1H17V2.2h-2.7C11.6 2.2 10.6 4 10.6 6.3v2.2H8V12h2.6v9.8H14V12h2.6l.5-3.5z"></path></svg></a>' +
      '<button type="button" aria-label="Compartilhar ' + core.escapeHtml(title) + '" title="Compartilhar" class="lg-soc native-share-book social-instagram" style="width:26px;height:26px;border:0;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer"><svg aria-hidden="true" fill="none" height="14" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14"><rect height="17" rx="5" width="17" x="3.5" y="3.5"></rect><circle cx="12" cy="12" r="3.8"></circle><circle cx="17.5" cy="6.8" r=".8" fill="currentColor" stroke="none"></circle></svg></button>' +
      '<button type="button" aria-label="Compartilhar ' + core.escapeHtml(title) + '" title="Compartilhar" class="lg-soc native-share-book social-bookmark" style="width:26px;height:26px;border:0;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer"><svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="M3 4h18v2H3zM3 8h18v2H3zM5 12h14v9l-7-4-7 4z"></path></svg></button>' +
      '<a aria-label="Outras formas de compartilhar" href="#contato" style="display: flex; color: #e2cbc4; padding: 4px"><svg aria-hidden="true" fill="none" height="18" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" width="18"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"></path></svg></a>' +
      "</span></div></article>";
  }

  function applyBooks(data) {
    if (!data) return;
    var heading = document.querySelector("#livros h2");
    if (heading && data.sectionTitle) heading.textContent = data.sectionTitle;
    if (!Array.isArray(data.items) || !data.items.length) return;
    var grid = document.querySelector("#livros .lg-books-grid");
    if (!grid) return;
    grid.innerHTML = data.items.map(renderBookCard).join("");
  }

  function applyThemes(data) {
    if (!data) return;
    var heading = document.querySelector('[data-cms="themes-title"]');
    if (heading && data.sectionTitle) {
      heading.innerHTML = String(data.sectionTitle).split(/\r?\n/).map(core.escapeHtml).join("<br/>");
    }
    if (!Array.isArray(data.items) || !data.items.length) return;
    var list = document.querySelector('[data-cms="themes-list"]');
    if (!list) return;
    list.innerHTML = data.items.map(function (item) {
      var iconHtml = core.renderIconHtml(item, core.THEME_PRESETS, 32);
      return '<li class="lg-theme" style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 78px">' +
        iconHtml +
        '<span style="line-height: 1.1">' + core.escapeHtml(item.label || "") + "</span></li>";
    }).join("");
  }

  function applyContent(bundle) {
    if (!bundle || typeof bundle !== "object") return;
    if (bundle.topMenu) applyTopMenu(bundle.topMenu);
    if (bundle.socialLinks) applySocialLinks(bundle.socialLinks);
    if (bundle.hero) applyHero(bundle.hero);
    if (bundle.author) applyAuthor(bundle.author);
    if (bundle.books) applyBooks(bundle.books);
    if (bundle.themes) applyThemes(bundle.themes);
    if (bundle.footerMenu) applyFooterMenu(bundle.footerMenu);
    if (bundle.settings) {
      if (bundle.settings.gaMeasurementId) initAnalytics(bundle.settings.gaMeasurementId);
      maybeOfferPush(bundle.settings);
    }
  }

  // --- Google Analytics 4 (GA4) ---
  var gaLoadedId = "";
  function initAnalytics(measurementId) {
    var id = String(measurementId || "").trim();
    if (!/^G-[A-Z0-9]+$/i.test(id) || gaLoadedId === id) return false;
    gaLoadedId = id;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id, { anonymize_ip: true });
    if (/^https?:$/i.test(window.location.protocol) && !document.querySelector('script[data-lg-ga="' + id + '"]')) {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
      s.setAttribute("data-lg-ga", id);
      document.head.appendChild(s);
    }
    return true;
  }

  function trackEvent(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params || {});
    }
  }

  document.addEventListener("click", function (event) {
    var buyLink = event.target.closest("#livros .lg-card a.lg-out");
    if (buyLink) {
      var card = buyLink.closest(".lg-card");
      var spanEl = buyLink.querySelector("span");
      trackEvent("book_buy_click", {
        book_title: card && card.querySelector("h3") ? card.querySelector("h3").textContent.trim() : "",
        button_label: (spanEl ? spanEl.textContent : buyLink.textContent).trim(),
        destination_url: buyLink.href
      });
      return;
    }
    var shareEl = event.target.closest(".lg-soc, #lg-share-native");
    if (shareEl) {
      var shareCard = shareEl.closest(".lg-card");
      trackEvent(shareCard ? "book_share_click" : "site_share_click", {
        network: shareEl.getAttribute("aria-label") || shareEl.textContent.trim(),
        book_title: shareCard && shareCard.querySelector("h3") ? shareCard.querySelector("h3").textContent.trim() : ""
      });
    }
  });

  function isLocalTestOrigin() {
    var loc = window.location;
    return loc.protocol === "file:" || loc.hostname === "localhost" || loc.hostname === "127.0.0.1";
  }

  // --- Newsletter -> Firestore ---
  function firestoreProjectId() {
    return (cfg.firebase && cfg.firebase.projectId) ? String(cfg.firebase.projectId).trim() : "";
  }

  async function saveNewsletterToFirestore(email) {
    var projectId = firestoreProjectId();
    if (!projectId) {
      throw new Error("Firebase não configurado em assets/config.js.");
    }
    var nowIso = new Date().toISOString();
    var endpoint = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/databases/(default)/documents/newsletterSubscribers";
    var res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          email: { stringValue: core.normalizeEmail(email) },
          name: { stringValue: "" },
          status: { stringValue: "ativo" },
          notes: { stringValue: "" },
          source: { stringValue: "site" },
          createdAt: { stringValue: nowIso },
          updatedAt: { stringValue: nowIso }
        }
      })
    });
    if (!res.ok) {
      throw new Error("Erro ao salvar inscrição (" + res.status + ").");
    }
    return res.json();
  }

  function wireNewsletterForm() {
    var form = document.getElementById("lg-news");
    if (!form) return;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var input = form.querySelector("#lg-email");
      var feedback = document.getElementById("lg-thanks");
      var submit = form.querySelector('button[type="submit"]');
      var email = core.normalizeEmail(input ? input.value : "");
      if (!core.isValidEmail(email)) {
        if (feedback) {
          feedback.hidden = false;
          feedback.textContent = "Informe um e-mail válido.";
          feedback.style.color = "#e8a09a";
        }
        return;
      }
      if (submit) { submit.disabled = true; submit.style.opacity = ".6"; }
      if (feedback) {
        feedback.hidden = false;
        feedback.textContent = "Enviando seu e-mail...";
        feedback.style.color = "#e8bfb3";
      }
      try {
        if (isLocalTestOrigin() && typeof window.LG_CUSTOM_NEWSLETTER_SAVE === "function") {
          await window.LG_CUSTOM_NEWSLETTER_SAVE(email);
        } else {
          await saveNewsletterToFirestore(email);
        }
        trackEvent("newsletter_signup", { method: "footer_form" });
        if (feedback) {
          feedback.textContent = "Cadastro enviado! Obrigada por acompanhar meu trabalho.";
          feedback.style.color = "#b9d8b8";
        }
        form.reset();
      } catch (err) {
        if (feedback) {
          feedback.textContent = "Não foi possível enviar agora. Tente novamente em instantes.";
          feedback.style.color = "#e8a09a";
        }
      } finally {
        if (submit) { submit.disabled = false; submit.style.opacity = ""; }
      }
    });
  }

  // --- Web Push (Opt-in discreto + FCM + Worker subscribe) ---
  function isPushConfigured() {
    return Boolean(
      cfg.firebase && cfg.firebase.apiKey && cfg.firebase.projectId &&
      cfg.firebase.messagingSenderId && cfg.firebase.appId &&
      cfg.vapidKey && cfg.workerUrl
    );
  }

  async function subscribeToWebPush() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      throw new Error("Seu navegador não suporta notificações push.");
    }
    var permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Permissão de notificações não concedida.");
    }
    var reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    var appMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    var msgMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js");
    var app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(cfg.firebase);
    var messaging = msgMod.getMessaging(app);
    var token = await msgMod.getToken(messaging, {
      vapidKey: cfg.vapidKey,
      serviceWorkerRegistration: reg
    });
    if (!token) throw new Error("Não foi possível gerar token de notificação.");

    var workerBase = String(cfg.workerUrl).replace(/\/+$/, "");
    var subRes = await fetch(workerBase + "/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, topic: "novidades" })
    });
    if (!subRes.ok) throw new Error("Falha ao registrar inscrição de push.");

    // Registra metadados no Firestore para contagem no painel (create-only, sem sobrescrita pública)
    var projectId = firestoreProjectId();
    if (projectId) {
      var nowIso = new Date().toISOString();
      var docId = "sub_" + token.slice(-24).replace(/[^a-zA-Z0-9_-]/g, "");
      fetch("https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/databases/(default)/documents/pushSubscribers?documentId=" + encodeURIComponent(docId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            token: { stringValue: token },
            topic: { stringValue: "novidades" },
            userAgent: { stringValue: navigator.userAgent.slice(0, 180) },
            createdAt: { stringValue: nowIso },
            updatedAt: { stringValue: nowIso }
          }
        })
      }).catch(function () {});
    }

    localStorage.setItem(PUSH_SUBSCRIBED_KEY, "1");
    trackEvent("push_opt_in", { topic: "novidades" });
    return token;
  }

  function showPushBanner(settings) {
    if (document.getElementById("lg-push-banner")) return;
    var s = settings || {};
    var title = s.pushPromptTitle || "Receber avisos de lançamentos?";
    var body = s.pushPromptBody || "Ative as notificações para saber primeiro quando novos livros forem publicados.";

    var banner = document.createElement("aside");
    banner.id = "lg-push-banner";
    banner.setAttribute("aria-label", "Notificações de lançamentos");
    banner.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:1100;max-width:340px;width:calc(100vw - 32px);padding:16px;border-radius:12px;background:rgba(28,15,21,.96);border:1px solid rgba(214,160,145,.38);box-shadow:0 16px 40px rgba(0,0,0,.6);color:#f0dcd5;font-family:'EB Garamond',Georgia,serif;";
    banner.innerHTML =
      '<div style="font-family:\'Cormorant Garamond\',serif;font-size:20px;font-weight:600;color:#f3d6cc">' + core.escapeHtml(title) + "</div>" +
      '<p style="margin:6px 0 12px;font-size:14.5px;line-height:1.4;color:#d6c2bc">' + core.escapeHtml(body) + "</p>" +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" data-push-action="dismiss" style="min-height:36px;padding:6px 14px;border-radius:8px;border:1px solid rgba(214,160,145,.3);background:transparent;color:#d6c2bc;cursor:pointer;font:inherit;font-size:14px">Agora não</button>' +
      '<button type="button" data-push-action="accept" style="min-height:36px;padding:6px 16px;border-radius:8px;border:1px solid #c9a77f;background:linear-gradient(180deg,#76543f,#39251f);color:#f4e4d7;cursor:pointer;font:inherit;font-size:14px;font-weight:600">Ativar</button>' +
      "</div>" +
      '<div data-push-status style="margin-top:8px;font-size:13px;color:#e8bfb3" hidden></div>';

    banner.addEventListener("click", async function (ev) {
      var btn = ev.target.closest("[data-push-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-push-action");
      if (action === "dismiss") {
        try { localStorage.setItem(PUSH_DISMISSED_KEY, String(Date.now())); } catch (e) {}
        banner.remove();
        return;
      }
      if (action === "accept") {
        var statusEl = banner.querySelector("[data-push-status]");
        btn.disabled = true;
        if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Ativando notificações..."; }
        try {
          if (isLocalTestOrigin() && typeof window.LG_CUSTOM_PUSH_SUBSCRIBE === "function") {
            await window.LG_CUSTOM_PUSH_SUBSCRIBE();
          } else {
            await subscribeToWebPush();
          }
          if (statusEl) { statusEl.textContent = "Notificações ativadas com sucesso!"; statusEl.style.color = "#b9d8b8"; }
          setTimeout(function () { banner.remove(); }, 1800);
        } catch (err) {
          btn.disabled = false;
          if (statusEl) { statusEl.textContent = err.message || "Não foi possível ativar."; statusEl.style.color = "#e8a09a"; }
        }
      }
    });

    document.body.appendChild(banner);
  }

  function maybeOfferPush(settings) {
    if (settings && settings.pushEnabled === false) return;
    if (!isPushConfigured()) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (Notification.permission !== "default") return;
    try {
      if (localStorage.getItem(PUSH_SUBSCRIBED_KEY) === "1") return;
      var dismissed = Number(localStorage.getItem(PUSH_DISMISSED_KEY) || "0");
      if (dismissed && (Date.now() - dismissed) < 7 * 24 * 60 * 60 * 1000) return;
    } catch (e) {}
    showPushBanner(settings);
  }

  // --- Carregamento inicial (cache + Firestore REST) ---
  async function loadFromFirestore() {
    var projectId = firestoreProjectId();
    if (!projectId || !/^https?:$/i.test(window.location.protocol)) return null;
    try {
      var res = await fetch("https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/databases/(default)/documents/siteContent?pageSize=30");
      if (!res.ok) return null;
      var data = await res.json();
      var docs = data.documents || [];
      if (!docs.length) return null;
      var bundle = {};
      for (var i = 0; i < docs.length; i++) {
        var nameParts = String(docs[i].name || "").split("/");
        var id = nameParts[nameParts.length - 1];
        bundle[id] = fromFirestoreDoc(docs[i]);
      }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(bundle)); } catch (e) {}
      applyContent(bundle);
      return bundle;
    } catch (e) {
      return null;
    }
  }

  function boot() {
    wireNewsletterForm();
    var initialGa = cfg.gaMeasurementId || (cfg.firebase && cfg.firebase.measurementId) || "";
    if (initialGa) initAnalytics(initialGa);

    // Só lê cache local e Firestore se o projeto Firebase estiver configurado
    if (firestoreProjectId()) {
      try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (cached) applyContent(JSON.parse(cached));
      } catch (e) {}
      loadFromFirestore();
    }
    maybeOfferPush(core.DEFAULT_CONTENT.settings);
  }

  window.LG_SITE_CMS = {
    applyContent: applyContent,
    initAnalytics: initAnalytics,
    trackEvent: trackEvent,
    showPushBanner: showPushBanner,
    loadFromFirestore: loadFromFirestore
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

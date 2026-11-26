// Painel administrativo completo para o site Larissa Galvão.
// Autenticação Google + Firestore (Firebase Spark), upload de mídia no Cloudflare R2 via Worker,
// editor rich text sanitizado, gestão de newsletter (CRUD + CSV), Web Push (FCM) e RBAC por bloco.
(function () {
  "use strict";

  var core = window.LG_CMS_CORE;
  var cfg = window.LG_CONFIG || {};
  if (!core) return;

  var state = {
    adapter: null,
    authUser: null,
    userRecord: null,
    activeBlock: null,
    contentCache: {},
    newsletter: [],
    users: [],
    pushCampaigns: [],
    pushSubscriberCount: 0,
    newsletterFilter: "",
    editingSubscriberId: null,
    editingUserEmail: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = core.escapeHtml;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isFirebaseConfigured() {
    return Boolean(cfg.firebase && cfg.firebase.apiKey && cfg.firebase.authDomain && cfg.firebase.projectId);
  }

  function showToast(message, type) {
    var area = $("toast-area");
    if (!area) return;
    var el = document.createElement("div");
    el.className = "alert " + (type === "error" ? "alert-error" : type === "warn" ? "alert-warn" : "alert-success");
    el.textContent = message;
    area.innerHTML = "";
    area.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 5000);
  }

  function isBootstrapSuperAdmin(email) {
    var list = Array.isArray(cfg.bootstrapAdmins) ? cfg.bootstrapAdmins.map(core.normalizeEmail) : [];
    return list.indexOf(core.normalizeEmail(email)) !== -1;
  }

  function userCanRead(blockId) {
    return core.canRead(state.userRecord, blockId, cfg.bootstrapAdmins);
  }

  function userCanWrite(blockId) {
    return core.canWrite(state.userRecord, blockId, cfg.bootstrapAdmins);
  }

  function userIsSuperAdmin() {
    return Boolean(
      state.userRecord &&
      (state.userRecord.isSuperAdmin === true || isBootstrapSuperAdmin(state.userRecord.email))
    );
  }

  // --- Adapter de Produção (Firebase Auth + Firestore + Cloudflare Worker) ---
  async function createFirebaseAdapter() {
    var base = "https://www.gstatic.com/firebasejs/11.10.0/";
    var appMod = await import(base + "firebase-app.js");
    var authMod = await import(base + "firebase-auth.js");
    var fsMod = await import(base + "firebase-firestore.js");

    var app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(cfg.firebase);
    var auth = authMod.getAuth(app);
    var db = fsMod.getFirestore(app);
    var provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    async function getIdToken() {
      if (!auth.currentUser) throw new Error("Usuário não autenticado.");
      return auth.currentUser.getIdToken();
    }

    return {
      onAuthStateChanged: function (cb) {
        return authMod.onAuthStateChanged(auth, function (u) {
          cb(u ? { uid: u.uid, email: core.normalizeEmail(u.email), displayName: u.displayName || u.email } : null);
        });
      },
      signInWithGoogle: async function () {
        try {
          await authMod.signInWithPopup(auth, provider);
        } catch (err) {
          if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) {
            await authMod.signInWithRedirect(auth, provider);
          } else {
            throw err;
          }
        }
      },
      signOut: function () {
        return authMod.signOut(auth);
      },
      getUserRecord: async function (email) {
        var norm = core.normalizeEmail(email);
        var snap = await fsMod.getDoc(fsMod.doc(db, "adminUsers", norm));
        if (snap.exists()) return Object.assign({ email: norm }, snap.data());
        if (isBootstrapSuperAdmin(norm)) {
          return { email: norm, name: "", isSuperAdmin: true, permissions: core.createEmptyPermissions() };
        }
        return null;
      },
      getContentBlock: async function (docId) {
        var snap = await fsMod.getDoc(fsMod.doc(db, "siteContent", docId));
        return snap.exists() ? snap.data() : null;
      },
      saveContentBlock: async function (docId, data) {
        var payload = Object.assign({}, data, {
          updatedAt: new Date().toISOString(),
          updatedBy: state.authUser ? state.authUser.email : ""
        });
        await fsMod.setDoc(fsMod.doc(db, "siteContent", docId), payload);
        return payload;
      },
      listNewsletter: async function () {
        var q = fsMod.query(fsMod.collection(db, "newsletterSubscribers"), fsMod.orderBy("createdAt", "desc"));
        var snap = await fsMod.getDocs(q);
        return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      },
      createNewsletter: async function (sub) {
        var now = new Date().toISOString();
        var data = {
          email: core.normalizeEmail(sub.email),
          name: String(sub.name || "").trim(),
          status: sub.status || "ativo",
          notes: String(sub.notes || "").trim(),
          source: sub.source || "admin",
          createdAt: sub.createdAt || now,
          updatedAt: now
        };
        var ref = await fsMod.addDoc(fsMod.collection(db, "newsletterSubscribers"), data);
        return Object.assign({ id: ref.id }, data);
      },
      updateNewsletter: async function (id, sub) {
        var data = {
          email: core.normalizeEmail(sub.email),
          name: String(sub.name || "").trim(),
          status: sub.status || "ativo",
          notes: String(sub.notes || "").trim(),
          updatedAt: new Date().toISOString()
        };
        await fsMod.updateDoc(fsMod.doc(db, "newsletterSubscribers", id), data);
        return Object.assign({ id: id }, data);
      },
      deleteNewsletter: async function (id) {
        await fsMod.deleteDoc(fsMod.doc(db, "newsletterSubscribers", id));
      },
      listUsers: async function () {
        var snap = await fsMod.getDocs(fsMod.collection(db, "adminUsers"));
        return snap.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); });
      },
      saveUser: async function (userObj) {
        var norm = core.normalizeEmail(userObj.email);
        var data = {
          email: norm,
          name: String(userObj.name || "").trim(),
          isSuperAdmin: Boolean(userObj.isSuperAdmin),
          permissions: userObj.permissions || core.createEmptyPermissions(),
          updatedAt: new Date().toISOString(),
          updatedBy: state.authUser ? state.authUser.email : ""
        };
        await fsMod.setDoc(fsMod.doc(db, "adminUsers", norm), data);
        return data;
      },
      deleteUser: async function (email) {
        await fsMod.deleteDoc(fsMod.doc(db, "adminUsers", core.normalizeEmail(email)));
      },
      uploadMedia: async function (file, block) {
        var workerBase = String(cfg.workerUrl || "").replace(/\/+$/, "");
        if (!workerBase) throw new Error("URL do Cloudflare Worker (workerUrl) não configurada em assets/config.js.");
        var token = await getIdToken();
        var fd = new FormData();
        fd.append("block", block);
        fd.append("file", file);
        var res = await fetch(workerBase + "/upload", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: fd
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || "Falha no upload para o R2 (" + res.status + ").");
        return body;
      },
      listPushCampaigns: async function () {
        var q = fsMod.query(fsMod.collection(db, "pushCampaigns"), fsMod.orderBy("sentAt", "desc"));
        var snap = await fsMod.getDocs(q);
        return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      },
      countPushSubscribers: async function () {
        var snap = await fsMod.getDocs(fsMod.collection(db, "pushSubscribers"));
        return snap.size;
      },
      sendPush: async function (payload) {
        var workerBase = String(cfg.workerUrl || "").replace(/\/+$/, "");
        if (!workerBase) throw new Error("URL do Cloudflare Worker (workerUrl) não configurada em assets/config.js.");
        var token = await getIdToken();
        var res = await fetch(workerBase + "/push/send", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || "Falha ao enviar Web Push (" + res.status + ").");

        var campaign = {
          title: payload.title,
          body: payload.body,
          url: payload.url || "",
          iconUrl: payload.iconUrl || "",
          topic: payload.topic || "novidades",
          messageId: body.messageId || "",
          sentBy: state.authUser ? state.authUser.email : "",
          sentAt: new Date().toISOString(),
          status: "enviado"
        };
        var ref = await fsMod.addDoc(fsMod.collection(db, "pushCampaigns"), campaign);
        return Object.assign({ id: ref.id }, campaign);
      }
    };
  }

  // --- Navegação e Shell ---
  function getAccessibleBlocks() {
    return core.BLOCKS.filter(function (b) { return userCanRead(b.id); });
  }

  function renderSidebar() {
    var nav = $("sidebar-nav");
    var blocks = getAccessibleBlocks();
    nav.innerHTML = blocks.map(function (b) {
      var write = userCanWrite(b.id);
      var active = state.activeBlock === b.id ? " active" : "";
      var pillClass = write ? "write" : "read";
      var pillText = write ? "Editar" : "Leitura";
      return '<button type="button" class="nav-item' + active + '" data-block="' + esc(b.id) + '">' +
        "<span>" + esc(b.label) + "</span>" +
        '<span class="nav-pill ' + pillClass + '">' + pillText + "</span>" +
        "</button>";
    }).join("");

    $("user-name").textContent = (state.authUser && state.authUser.displayName) || "";
    $("user-email").textContent = (state.authUser && state.authUser.email) || "";
    $("user-role").textContent = userIsSuperAdmin() ? "Super-administrador" : "Usuário autorizado";
  }

  async function openBlock(blockId) {
    if (!userCanRead(blockId)) return;
    state.activeBlock = blockId;
    $("admin-sidebar").classList.remove("open");
    renderSidebar();

    var meta = core.BLOCKS.find(function (b) { return b.id === blockId; });
    $("section-title").textContent = meta ? meta.label : blockId;
    $("section-desc").textContent = meta ? meta.description : "";

    var writable = userCanWrite(blockId);
    var badge = $("perm-badge");
    badge.className = "badge " + (writable ? "badge-write" : "badge-read");
    badge.textContent = writable ? "Leitura e escrita" : "Somente leitura";

    var container = $("panel-content");
    container.innerHTML = '<div class="card">Carregando dados...</div>';

    try {
      if (blockId === "topMenu" || blockId === "footerMenu") {
        await renderMenuSection(blockId, writable);
      } else if (blockId === "socialLinks") {
        await renderSocialSection(writable);
      } else if (blockId === "hero") {
        await renderHeroSection(writable);
      } else if (blockId === "author") {
        await renderAuthorSection(writable);
      } else if (blockId === "books") {
        await renderBooksSection(writable);
      } else if (blockId === "themes") {
        await renderThemesSection(writable);
      } else if (blockId === "newsletter") {
        await renderNewsletterSection(writable);
      } else if (blockId === "analytics") {
        await renderAnalyticsSection(writable);
      } else if (blockId === "push") {
        await renderPushSection(writable);
      } else if (blockId === "users") {
        await renderUsersSection(writable);
      }
    } catch (err) {
      container.innerHTML = '<div class="alert alert-error">Erro ao carregar bloco: ' + esc(err.message || err) + "</div>";
    }
  }

  async function loadContentOrDefault(docId) {
    var remote = await state.adapter.getContentBlock(docId);
    if (remote) {
      state.contentCache[docId] = clone(remote);
      return { data: clone(remote), isFromDb: true };
    }
    var def = clone(core.DEFAULT_CONTENT[docId] || {});
    state.contentCache[docId] = def;
    return { data: def, isFromDb: false };
  }

  function readOnlyNotice(writable) {
    if (writable) return "";
    return '<div class="alert alert-warn">Você tem permissão <strong>somente leitura</strong> neste bloco. As alterações estão desabilitadas.</div>';
  }

  function defaultNotice(isFromDb) {
    if (isFromDb) return "";
    return '<div class="alert alert-warn">Este bloco ainda não foi salvo no Firestore. Os valores exibidos são os atuais do site — clique em <strong>Salvar alterações</strong> para publicá-los no banco.</div>';
  }

  function moveItem(arr, index, delta) {
    var next = index + delta;
    if (next < 0 || next >= arr.length) return;
    var tmp = arr[index];
    arr[index] = arr[next];
    arr[next] = tmp;
  }

  async function handleFileUpload(fileInput, block, onSuccess) {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      showToast("Enviando arquivo para o Cloudflare R2...", "warn");
      var result = await state.adapter.uploadMedia(file, block);
      onSuccess(result.url);
      showToast("Upload concluído no Cloudflare R2.", "success");
    } catch (err) {
      showToast(err.message || "Falha no upload.", "error");
    } finally {
      fileInput.value = "";
    }
  }

  // --- 1 & 7: Menus (Topo e Rodapé) ---
  async function renderMenuSection(blockId, writable) {
    var loaded = await loadContentOrDefault(blockId);
    var items = Array.isArray(loaded.data.items) ? loaded.data.items : [];
    var container = $("panel-content");

    function draw() {
      var dis = writable ? "" : " disabled";
      var rows = items.map(function (it, idx) {
        return '<div class="item-card" data-idx="' + idx + '">' +
          '<div class="item-card-head">' +
          '<span class="item-index">Item #' + (idx + 1) + "</span>" +
          '<div class="row-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="up" data-idx="' + idx + '"' + (idx === 0 || !writable ? " disabled" : "") + ">↑</button>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="down" data-idx="' + idx + '"' + (idx === items.length - 1 || !writable ? " disabled" : "") + ">↓</button>" +
          '<button type="button" class="btn btn-danger btn-sm" data-act="del" data-idx="' + idx + '"' + dis + ">Excluir</button>" +
          "</div></div>" +
          '<div class="grid-2">' +
          '<div class="field"><label>Label do link</label><input type="text" data-field="label" data-idx="' + idx + '" value="' + esc(it.label || "") + '" placeholder="Ex.: Livros"' + dis + " /></div>" +
          '<div class="field"><label>Destino (âncora ou URL)</label><input type="text" data-field="href" data-idx="' + idx + '" value="' + esc(it.href || "") + '" placeholder="Ex.: #livros ou https://..."' + dis + " /></div>" +
          "</div>" +
          '<label class="checkbox-row"><input type="checkbox" data-field="newTab" data-idx="' + idx + '"' + (it.newTab ? " checked" : "") + dis + " /> Abrir em nova aba</label>" +
          "</div>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">Itens do menu (' + items.length + ')</h2>' +
        '<div class="row-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-add-menu"' + dis + ">+ Adicionar item</button>" +
        '<button type="button" class="btn btn-primary" id="btn-save-menu"' + dis + ">Salvar alterações</button>" +
        "</div></div>" +
        (rows || '<p class="field-hint">Nenhum item cadastrado.</p>') +
        "</div>";

      container.querySelectorAll("[data-field]").forEach(function (el) {
        el.addEventListener(el.type === "checkbox" ? "change" : "input", function () {
          var i = Number(el.dataset.idx);
          items[i][el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
        });
      });
      container.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = Number(btn.dataset.idx);
          if (btn.dataset.act === "up") moveItem(items, i, -1);
          if (btn.dataset.act === "down") moveItem(items, i, 1);
          if (btn.dataset.act === "del") items.splice(i, 1);
          draw();
        });
      });
      $("btn-add-menu").addEventListener("click", function () {
        items.push({ label: "", href: "#", newTab: false });
        draw();
      });
      $("btn-save-menu").addEventListener("click", async function () {
        var clean = items
          .map(function (it) {
            return {
              label: String(it.label || "").trim(),
              href: core.sanitizeUrl(it.href, { allowHash: true, allowRelative: true }),
              newTab: Boolean(it.newTab)
            };
          })
          .filter(function (it) { return it.label && it.href; });
        if (!clean.length) {
          showToast("Informe ao menos um item com label e destino válidos.", "error");
          return;
        }
        try {
          await state.adapter.saveContentBlock(blockId, { items: clean });
          loaded.isFromDb = true;
          items = clean;
          showToast("Menu salvo com sucesso.", "success");
          draw();
        } catch (err) {
          showToast("Erro ao salvar: " + (err.message || err), "error");
        }
      });
    }
    draw();
  }

  // --- 2: Redes Sociais do Topo ---
  async function renderSocialSection(writable) {
    var loaded = await loadContentOrDefault("socialLinks");
    var items = Array.isArray(loaded.data.items) ? loaded.data.items : [];
    var container = $("panel-content");

    function presetOptions(selected) {
      return Object.keys(core.SOCIAL_PRESETS).map(function (k) {
        return '<option value="' + esc(k) + '"' + (k === selected ? " selected" : "") + ">" + esc(core.SOCIAL_PRESETS[k].label) + "</option>";
      }).join("");
    }

    function draw() {
      var dis = writable ? "" : " disabled";
      var rows = items.map(function (it, idx) {
        var iconType = it.iconType || "preset";
        var preview = core.renderIconHtml(it, core.SOCIAL_PRESETS, 22);
        return '<div class="item-card" data-idx="' + idx + '">' +
          '<div class="item-card-head">' +
          '<div class="row-actions"><span class="icon-preview">' + preview + '</span><span class="item-index">Rede #' + (idx + 1) + "</span></div>" +
          '<div class="row-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="up" data-idx="' + idx + '"' + (idx === 0 || !writable ? " disabled" : "") + ">↑</button>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="down" data-idx="' + idx + '"' + (idx === items.length - 1 || !writable ? " disabled" : "") + ">↓</button>" +
          '<button type="button" class="btn btn-danger btn-sm" data-act="del" data-idx="' + idx + '"' + dis + ">Excluir</button>" +
          "</div></div>" +
          '<div class="grid-3">' +
          '<div class="field"><label>Nome / Label acessível</label><input type="text" data-field="label" data-idx="' + idx + '" value="' + esc(it.label || "") + '" placeholder="Ex.: Instagram"' + dis + " /></div>" +
          '<div class="field"><label>URL de destino</label><input type="url" data-field="href" data-idx="' + idx + '" value="' + esc(it.href || "") + '" placeholder="https://..."' + dis + " /></div>" +
          '<div class="field"><label>Tipo de ícone</label><select data-field="iconType" data-idx="' + idx + '"' + dis + ">" +
          '<option value="preset"' + (iconType === "preset" ? " selected" : "") + ">Ícone padrão</option>" +
          '<option value="url"' + (iconType === "url" ? " selected" : "") + ">Imagem (Upload R2 / URL)</option>" +
          '<option value="svg"' + (iconType === "svg" ? " selected" : "") + ">SVG personalizado</option>" +
          "</select></div></div>" +
          (iconType === "preset"
            ? '<div class="field"><label>Escolha o ícone</label><select data-field="iconPreset" data-idx="' + idx + '"' + dis + ">" + presetOptions(it.iconPreset || "instagram") + "</select></div>"
            : iconType === "url"
              ? '<div class="field"><label>URL do ícone (ou envie para o Cloudflare R2)</label><div class="upload-row">' +
                '<input type="url" data-field="iconUrl" data-idx="' + idx + '" value="' + esc(it.iconUrl || "") + '" placeholder="https://..."' + dis + " />" +
                '<label class="btn btn-secondary btn-sm">Enviar R2<input type="file" accept="image/*" data-upload-idx="' + idx + '" hidden' + dis + " /></label>" +
                "</div></div>"
              : '<div class="field"><label>Código SVG (&lt;svg ...&gt;...&lt;/svg&gt;)</label><textarea data-field="iconSvg" data-idx="' + idx + '"' + dis + ">" + esc(it.iconSvg || "") + "</textarea></div>"
          ) +
          "</div>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">Redes sociais do topo (' + items.length + ')</h2>' +
        '<div class="row-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-add-social"' + dis + ">+ Adicionar rede</button>" +
        '<button type="button" class="btn btn-primary" id="btn-save-social"' + dis + ">Salvar alterações</button>" +
        "</div></div>" +
        (rows || '<p class="field-hint">Nenhuma rede cadastrada.</p>') +
        "</div>";

      container.querySelectorAll("[data-field]").forEach(function (el) {
        var ev = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(ev, function () {
          var i = Number(el.dataset.idx);
          items[i][el.dataset.field] = el.value;
          if (el.dataset.field === "iconType" || el.dataset.field === "iconPreset") draw();
        });
      });
      container.querySelectorAll("[data-upload-idx]").forEach(function (input) {
        input.addEventListener("change", function () {
          var i = Number(input.dataset.uploadIdx);
          handleFileUpload(input, "socialLinks", function (url) {
            items[i].iconUrl = url;
            items[i].iconType = "url";
            draw();
          });
        });
      });
      container.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = Number(btn.dataset.idx);
          if (btn.dataset.act === "up") moveItem(items, i, -1);
          if (btn.dataset.act === "down") moveItem(items, i, 1);
          if (btn.dataset.act === "del") items.splice(i, 1);
          draw();
        });
      });
      $("btn-add-social").addEventListener("click", function () {
        items.push({ label: "", href: "", iconType: "preset", iconPreset: "globe", iconUrl: "", iconSvg: "" });
        draw();
      });
      $("btn-save-social").addEventListener("click", async function () {
        var clean = items.map(function (it) {
          return {
            label: String(it.label || "").trim(),
            href: core.sanitizeUrl(it.href, { allowHash: false, allowRelative: false }),
            iconType: it.iconType || "preset",
            iconPreset: it.iconPreset || "globe",
            iconUrl: core.sanitizeUrl(it.iconUrl || "", { allowHash: false, allowRelative: true }),
            iconSvg: core.sanitizeSvg(it.iconSvg || "")
          };
        }).filter(function (it) { return it.label && it.href; });
        if (!clean.length) {
          showToast("Informe ao menos uma rede com nome e URL http(s) válidos.", "error");
          return;
        }
        try {
          await state.adapter.saveContentBlock("socialLinks", { items: clean });
          loaded.isFromDb = true;
          items = clean;
          showToast("Redes sociais salvas com sucesso.", "success");
          draw();
        } catch (err) {
          showToast("Erro ao salvar: " + (err.message || err), "error");
        }
      });
    }
    draw();
  }

  // --- 3: Texto de Chamada (Hero) ---
  async function renderHeroSection(writable) {
    var loaded = await loadContentOrDefault("hero");
    var tagline = loaded.data.tagline || "";
    var container = $("panel-content");
    var dis = writable ? "" : " disabled";

    container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
      '<div class="card">' +
      '<div class="card-head"><h2 class="card-title">Texto de chamada principal</h2>' +
      '<button type="button" class="btn btn-primary" id="btn-save-hero"' + dis + ">Salvar alterações</button></div>" +
      '<div class="field"><label for="hero-tagline-input">Frase exibida no topo (use Enter para quebra de linha)</label>' +
      '<textarea id="hero-tagline-input" rows="3"' + dis + ">" + esc(tagline) + "</textarea>" +
      '<span class="field-hint">Cada quebra de linha será exibida exatamente na mesma posição no site.</span></div>' +
      "</div>";

    $("btn-save-hero").addEventListener("click", async function () {
      var val = String($("hero-tagline-input").value || "").trim();
      if (!val) { showToast("O texto de chamada não pode ficar vazio.", "error"); return; }
      try {
        await state.adapter.saveContentBlock("hero", { tagline: val });
        showToast("Texto de chamada salvo com sucesso.", "success");
      } catch (err) {
        showToast("Erro ao salvar: " + (err.message || err), "error");
      }
    });
  }

  // --- 4: Bloco da Autora (Foto + Título + Rich Text) ---
  async function renderAuthorSection(writable) {
    var loaded = await loadContentOrDefault("author");
    var data = Object.assign({ title: "", photoUrl: "", photoAlt: "", bioHtml: "" }, loaded.data);
    var container = $("panel-content");
    var dis = writable ? "" : " disabled";
    var showSource = false;

    container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
      '<div class="card">' +
      '<div class="card-head"><h2 class="card-title">Bloco Sobre a Autora</h2>' +
      '<button type="button" class="btn btn-primary" id="btn-save-author"' + dis + ">Salvar alterações</button></div>" +
      '<div class="row-actions" style="align-items:flex-start;margin-bottom:14px">' +
      '<img id="author-photo-preview" class="avatar-preview" src="' + esc(data.photoUrl || "images/portrait.png") + '" alt="Prévia da foto da autora" />' +
      '<div style="flex:1;min-width:240px">' +
      '<div class="field"><label for="author-photo-url">Foto da autora (URL ou upload para R2)</label>' +
      '<div class="upload-row"><input type="text" id="author-photo-url" value="' + esc(data.photoUrl || "") + '"' + dis + " />" +
      '<label class="btn btn-secondary btn-sm">Enviar R2<input type="file" id="author-photo-file" accept="image/*" hidden' + dis + " /></label></div></div>" +
      '<div class="field"><label for="author-photo-alt">Texto alternativo da foto (acessibilidade)</label>' +
      '<input type="text" id="author-photo-alt" value="' + esc(data.photoAlt || "") + '"' + dis + " /></div>" +
      "</div></div>" +
      '<div class="field"><label for="author-title-input">Título da seção</label>' +
      '<input type="text" id="author-title-input" value="' + esc(data.title || "") + '"' + dis + " /></div>" +
      '<div class="field"><label>Descrição (Rich Text)</label>' +
      '<div class="rt-toolbar" id="author-rt-toolbar">' +
      '<button type="button" class="rt-btn" data-cmd="bold" title="Negrito"' + dis + "><strong>B</strong></button>" +
      '<button type="button" class="rt-btn" data-cmd="italic" title="Itálico"' + dis + "><em>I</em></button>" +
      '<button type="button" class="rt-btn" data-cmd="underline" title="Sublinhado"' + dis + "><u>U</u></button>" +
      '<button type="button" class="rt-btn" data-cmd="insertUnorderedList" title="Lista"' + dis + ">• Lista</button>" +
      '<button type="button" class="rt-btn" data-cmd="insertOrderedList" title="Lista numerada"' + dis + ">1. Lista</button>" +
      '<button type="button" class="rt-btn" data-cmd="formatBlock" data-val="blockquote" title="Citação"' + dis + ">“ Citação</button>" +
      '<button type="button" class="rt-btn" data-cmd="createLink" title="Inserir link"' + dis + ">Link</button>" +
      '<button type="button" class="rt-btn" data-cmd="removeFormat" title="Limpar formatação"' + dis + ">Limpar</button>" +
      '<button type="button" class="rt-btn" id="btn-toggle-html" title="Alternar HTML"' + dis + ">HTML</button>" +
      "</div>" +
      '<div id="author-bio-editor" class="rt-editor" contenteditable="' + (writable ? "true" : "false") + '">' + core.sanitizeRichText(data.bioHtml || "") + "</div>" +
      '<textarea id="author-bio-source" rows="8" hidden' + dis + ">" + esc(core.sanitizeRichText(data.bioHtml || "")) + "</textarea>" +
      '<span class="field-hint">O HTML é sanitizado automaticamente ao salvar e exibir no site para proteção contra XSS.</span>' +
      "</div></div>";

    var editor = $("author-bio-editor");
    var source = $("author-bio-source");
    var photoInput = $("author-photo-url");
    var preview = $("author-photo-preview");

    photoInput.addEventListener("input", function () {
      var safe = core.sanitizeUrl(photoInput.value, { allowHash: false, allowRelative: true });
      if (safe) preview.src = safe;
    });

    $("author-photo-file").addEventListener("change", function () {
      handleFileUpload(this, "author", function (url) {
        photoInput.value = url;
        preview.src = url;
      });
    });

    $("author-rt-toolbar").addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-cmd]");
      if (!btn || !writable) return;
      var cmd = btn.dataset.cmd;
      if (showSource) return;
      editor.focus();
      if (cmd === "createLink") {
        var href = window.prompt("Informe o endereço (https://...):");
        var safe = core.sanitizeUrl(href, { allowHash: true, allowRelative: true });
        if (safe) document.execCommand("createLink", false, safe);
      } else {
        document.execCommand(cmd, false, btn.dataset.val || null);
      }
    });

    $("btn-toggle-html").addEventListener("click", function () {
      showSource = !showSource;
      if (showSource) {
        source.value = core.sanitizeRichText(editor.innerHTML);
        editor.hidden = true;
        source.hidden = false;
      } else {
        editor.innerHTML = core.sanitizeRichText(source.value);
        source.hidden = true;
        editor.hidden = false;
      }
    });

    $("btn-save-author").addEventListener("click", async function () {
      var rawHtml = showSource ? source.value : editor.innerHTML;
      var bioHtml = core.sanitizeRichText(rawHtml);
      var title = String($("author-title-input").value || "").trim();
      var photoUrl = core.sanitizeUrl(photoInput.value, { allowHash: false, allowRelative: true });
      var photoAlt = String($("author-photo-alt").value || "").trim();
      if (!title || !bioHtml) {
        showToast("Informe o título e a descrição da autora.", "error");
        return;
      }
      try {
        await state.adapter.saveContentBlock("author", { title: title, photoUrl: photoUrl, photoAlt: photoAlt, bioHtml: bioHtml });
        editor.innerHTML = bioHtml;
        source.value = bioHtml;
        showToast("Bloco da autora salvo com sucesso.", "success");
      } catch (err) {
        showToast("Erro ao salvar: " + (err.message || err), "error");
      }
    });
  }

  // --- 5: Livros ---
  async function renderBooksSection(writable) {
    var loaded = await loadContentOrDefault("books");
    var sectionTitle = loaded.data.sectionTitle || "Livros em Destaque";
    var items = Array.isArray(loaded.data.items) ? loaded.data.items : [];
    var container = $("panel-content");

    function draw() {
      var dis = writable ? "" : " disabled";
      var cards = items.map(function (book, idx) {
        var tagsStr = Array.isArray(book.tags) ? book.tags.join(", ") : "";
        var pills = (Array.isArray(book.tags) ? book.tags : []).map(function (t) {
          return '<span class="tag-pill">' + esc(t) + "</span>";
        }).join("");
        return '<div class="item-card" data-idx="' + idx + '">' +
          '<div class="item-card-head">' +
          '<span class="item-index">Livro #' + (idx + 1) + (book.title ? " — " + esc(book.title) : "") + "</span>" +
          '<div class="row-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="up" data-idx="' + idx + '"' + (idx === 0 || !writable ? " disabled" : "") + ">↑</button>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="down" data-idx="' + idx + '"' + (idx === items.length - 1 || !writable ? " disabled" : "") + ">↓</button>" +
          '<button type="button" class="btn btn-danger btn-sm" data-act="del" data-idx="' + idx + '"' + dis + ">Excluir</button>" +
          "</div></div>" +
          '<div class="row-actions" style="align-items:flex-start;margin-bottom:10px">' +
          '<img class="thumb-preview" src="' + esc(book.coverUrl || "images/cover1.jpg") + '" alt="Capa" />' +
          '<div style="flex:1;min-width:240px">' +
          '<div class="field"><label>Capa do livro (URL ou upload para R2)</label><div class="upload-row">' +
          '<input type="text" data-field="coverUrl" data-idx="' + idx + '" value="' + esc(book.coverUrl || "") + '"' + dis + " />" +
          '<label class="btn btn-secondary btn-sm">Enviar R2<input type="file" accept="image/*" data-upload-idx="' + idx + '" hidden' + dis + " /></label>" +
          "</div></div>" +
          '<div class="field"><label>Título</label><input type="text" data-field="title" data-idx="' + idx + '" value="' + esc(book.title || "") + '"' + dis + " /></div>" +
          "</div></div>" +
          '<div class="field"><label>Texto / Sinopse</label><textarea data-field="description" data-idx="' + idx + '"' + dis + ">" + esc(book.description || "") + "</textarea></div>" +
          '<div class="field"><label>Tags (separadas por vírgula)</label><input type="text" data-field="tags" data-idx="' + idx + '" value="' + esc(tagsStr) + '" placeholder="Romance, Drama, Poesia"' + dis + " />" +
          '<div class="tag-preview">' + pills + "</div></div>" +
          '<div class="grid-2">' +
          '<div class="field"><label>Rótulo do botão "Comprar"</label><input type="text" data-field="buyLabel" data-idx="' + idx + '" value="' + esc(book.buyLabel || (book.comingSoon ? "Em breve" : "Comprar")) + '" placeholder="Comprar"' + dis + " /></div>" +
          '<div class="field"><label>Link de destino (Amazon ou loja)</label><input type="url" data-field="buyUrl" data-idx="' + idx + '" value="' + esc(book.buyUrl || "") + '" placeholder="https://www.amazon.com.br/dp/..."' + dis + " /></div>" +
          "</div>" +
          '<label class="checkbox-row"><input type="checkbox" data-field="comingSoon" data-idx="' + idx + '"' + (book.comingSoon ? " checked" : "") + dis + " /> Em breve (desabilita o botão de compra e compartilha o endereço do site)</label>" +
          "</div>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">Catálogo de livros (' + items.length + ')</h2>' +
        '<div class="row-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-add-book"' + dis + ">+ Adicionar livro</button>" +
        '<button type="button" class="btn btn-primary" id="btn-save-books"' + dis + ">Salvar alterações</button>" +
        "</div></div>" +
        '<div class="field"><label for="books-section-title">Título da seção</label><input type="text" id="books-section-title" value="' + esc(sectionTitle) + '"' + dis + " /></div>" +
        cards +
        "</div>";

      $("books-section-title").addEventListener("input", function () { sectionTitle = this.value; });

      container.querySelectorAll("[data-field]").forEach(function (el) {
        var ev = el.type === "checkbox" ? "change" : "input";
        el.addEventListener(ev, function () {
          var i = Number(el.dataset.idx);
          var f = el.dataset.field;
          if (f === "comingSoon") {
            items[i].comingSoon = el.checked;
            if (el.checked && (!items[i].buyLabel || items[i].buyLabel === "Comprar")) items[i].buyLabel = "Em breve";
            if (!el.checked && items[i].buyLabel === "Em breve") items[i].buyLabel = "Comprar";
            draw();
          } else if (f === "tags") {
            items[i].tags = el.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
          } else {
            items[i][f] = el.value;
          }
        });
      });
      container.querySelectorAll("[data-upload-idx]").forEach(function (input) {
        input.addEventListener("change", function () {
          var i = Number(input.dataset.uploadIdx);
          handleFileUpload(input, "books", function (url) {
            items[i].coverUrl = url;
            draw();
          });
        });
      });
      container.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = Number(btn.dataset.idx);
          if (btn.dataset.act === "up") moveItem(items, i, -1);
          if (btn.dataset.act === "down") moveItem(items, i, 1);
          if (btn.dataset.act === "del") items.splice(i, 1);
          draw();
        });
      });
      $("btn-add-book").addEventListener("click", function () {
        items.push({ title: "", coverUrl: "", description: "", tags: [], buyLabel: "Comprar", buyUrl: "", comingSoon: false });
        draw();
      });
      $("btn-save-books").addEventListener("click", async function () {
        var clean = items.map(function (b) {
          var normalizedUrl = core.normalizeAmazonUrl(b.buyUrl || "") || core.sanitizeUrl(b.buyUrl || "", { allowHash: false, allowRelative: false });
          return {
            title: String(b.title || "").trim(),
            coverUrl: core.sanitizeUrl(b.coverUrl || "", { allowHash: false, allowRelative: true }),
            description: String(b.description || "").trim(),
            tags: Array.isArray(b.tags) ? b.tags.map(function (t) { return String(t).trim(); }).filter(Boolean) : [],
            buyLabel: String(b.buyLabel || (b.comingSoon ? "Em breve" : "Comprar")).trim(),
            buyUrl: normalizedUrl,
            comingSoon: Boolean(b.comingSoon) || !normalizedUrl
          };
        }).filter(function (b) { return b.title; });
        if (!clean.length) {
          showToast("Informe ao menos um livro com título.", "error");
          return;
        }
        try {
          await state.adapter.saveContentBlock("books", { sectionTitle: String(sectionTitle || "Livros em Destaque").trim(), items: clean });
          loaded.isFromDb = true;
          items = clean;
          showToast("Livros salvos com sucesso.", "success");
          draw();
        } catch (err) {
          showToast("Erro ao salvar: " + (err.message || err), "error");
        }
      });
    }
    draw();
  }

  // --- 6: Temas ---
  async function renderThemesSection(writable) {
    var loaded = await loadContentOrDefault("themes");
    var sectionTitle = loaded.data.sectionTitle || "Temas que você encontra\nnas minhas histórias";
    var items = Array.isArray(loaded.data.items) ? loaded.data.items : [];
    var container = $("panel-content");

    function presetOptions(selected) {
      return Object.keys(core.THEME_PRESETS).map(function (k) {
        return '<option value="' + esc(k) + '"' + (k === selected ? " selected" : "") + ">" + esc(core.THEME_PRESETS[k].label) + "</option>";
      }).join("");
    }

    function draw() {
      var dis = writable ? "" : " disabled";
      var rows = items.map(function (it, idx) {
        var iconType = it.iconType || "preset";
        var preview = core.renderIconHtml(it, core.THEME_PRESETS, 24);
        return '<div class="item-card" data-idx="' + idx + '">' +
          '<div class="item-card-head">' +
          '<div class="row-actions"><span class="icon-preview">' + preview + '</span><span class="item-index">Tema #' + (idx + 1) + "</span></div>" +
          '<div class="row-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="up" data-idx="' + idx + '"' + (idx === 0 || !writable ? " disabled" : "") + ">↑</button>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="down" data-idx="' + idx + '"' + (idx === items.length - 1 || !writable ? " disabled" : "") + ">↓</button>" +
          '<button type="button" class="btn btn-danger btn-sm" data-act="del" data-idx="' + idx + '"' + dis + ">Excluir</button>" +
          "</div></div>" +
          '<div class="grid-2">' +
          '<div class="field"><label>Label do tema</label><input type="text" data-field="label" data-idx="' + idx + '" value="' + esc(it.label || "") + '" placeholder="Ex.: Poesia"' + dis + " /></div>" +
          '<div class="field"><label>Tipo de ícone</label><select data-field="iconType" data-idx="' + idx + '"' + dis + ">" +
          '<option value="preset"' + (iconType === "preset" ? " selected" : "") + ">Ícone padrão</option>" +
          '<option value="url"' + (iconType === "url" ? " selected" : "") + ">Imagem (Upload R2 / URL)</option>" +
          '<option value="svg"' + (iconType === "svg" ? " selected" : "") + ">SVG personalizado</option>" +
          "</select></div></div>" +
          (iconType === "preset"
            ? '<div class="field"><label>Ícone padrão</label><select data-field="iconPreset" data-idx="' + idx + '"' + dis + ">" + presetOptions(it.iconPreset || "heart") + "</select></div>"
            : iconType === "url"
              ? '<div class="field"><label>URL do ícone (ou envie para o R2)</label><div class="upload-row">' +
                '<input type="url" data-field="iconUrl" data-idx="' + idx + '" value="' + esc(it.iconUrl || "") + '"' + dis + " />" +
                '<label class="btn btn-secondary btn-sm">Enviar R2<input type="file" accept="image/*" data-upload-idx="' + idx + '" hidden' + dis + " /></label>" +
                "</div></div>"
              : '<div class="field"><label>SVG personalizado</label><textarea data-field="iconSvg" data-idx="' + idx + '"' + dis + ">" + esc(it.iconSvg || "") + "</textarea></div>"
          ) +
          "</div>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">Temas das histórias (' + items.length + ')</h2>' +
        '<div class="row-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-add-theme"' + dis + ">+ Adicionar tema</button>" +
        '<button type="button" class="btn btn-primary" id="btn-save-themes"' + dis + ">Salvar alterações</button>" +
        "</div></div>" +
        '<div class="field"><label for="themes-section-title">Título da seção (Enter quebra linha)</label><textarea id="themes-section-title" rows="2"' + dis + ">" + esc(sectionTitle) + "</textarea></div>" +
        rows +
        "</div>";

      $("themes-section-title").addEventListener("input", function () { sectionTitle = this.value; });
      container.querySelectorAll("[data-field]").forEach(function (el) {
        var ev = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(ev, function () {
          var i = Number(el.dataset.idx);
          items[i][el.dataset.field] = el.value;
          if (el.dataset.field === "iconType" || el.dataset.field === "iconPreset") draw();
        });
      });
      container.querySelectorAll("[data-upload-idx]").forEach(function (input) {
        input.addEventListener("change", function () {
          var i = Number(input.dataset.uploadIdx);
          handleFileUpload(input, "themes", function (url) {
            items[i].iconUrl = url;
            items[i].iconType = "url";
            draw();
          });
        });
      });
      container.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = Number(btn.dataset.idx);
          if (btn.dataset.act === "up") moveItem(items, i, -1);
          if (btn.dataset.act === "down") moveItem(items, i, 1);
          if (btn.dataset.act === "del") items.splice(i, 1);
          draw();
        });
      });
      $("btn-add-theme").addEventListener("click", function () {
        items.push({ label: "", iconType: "preset", iconPreset: "star", iconUrl: "", iconSvg: "" });
        draw();
      });
      $("btn-save-themes").addEventListener("click", async function () {
        var clean = items.map(function (it) {
          return {
            label: String(it.label || "").trim(),
            iconType: it.iconType || "preset",
            iconPreset: it.iconPreset || "heart",
            iconUrl: core.sanitizeUrl(it.iconUrl || "", { allowHash: false, allowRelative: true }),
            iconSvg: core.sanitizeSvg(it.iconSvg || "")
          };
        }).filter(function (it) { return it.label; });
        if (!clean.length) { showToast("Informe ao menos um tema.", "error"); return; }
        try {
          await state.adapter.saveContentBlock("themes", { sectionTitle: String(sectionTitle || "").trim(), items: clean });
          loaded.isFromDb = true;
          items = clean;
          showToast("Temas salvos com sucesso.", "success");
          draw();
        } catch (err) {
          showToast("Erro ao salvar: " + (err.message || err), "error");
        }
      });
    }
    draw();
  }

  // --- 8: Newsletter (Ver, editar, excluir, importar e baixar CSV) ---
  async function renderNewsletterSection(writable) {
    state.newsletter = await state.adapter.listNewsletter();
    var container = $("panel-content");

    function draw() {
      var dis = writable ? "" : " disabled";
      var q = state.newsletterFilter.trim().toLowerCase();
      var filtered = state.newsletter.filter(function (s) {
        if (!q) return true;
        return (s.email || "").toLowerCase().indexOf(q) !== -1 ||
          (s.name || "").toLowerCase().indexOf(q) !== -1 ||
          (s.status || "").toLowerCase().indexOf(q) !== -1;
      });
      var activeCount = state.newsletter.filter(function (s) { return (s.status || "ativo") === "ativo"; }).length;

      var editing = state.editingSubscriberId
        ? state.newsletter.find(function (s) { return s.id === state.editingSubscriberId; })
        : null;

      var rowsHtml = filtered.map(function (s) {
        var dateStr = s.createdAt ? String(s.createdAt).slice(0, 10) : "—";
        return "<tr>" +
          "<td><strong>" + esc(s.email) + "</strong></td>" +
          "<td>" + esc(s.name || "—") + "</td>" +
          '<td><span class="badge ' + ((s.status || "ativo") === "ativo" ? "badge-write" : "badge-read") + '">' + esc(s.status || "ativo") + "</span></td>" +
          "<td>" + esc(s.notes || "—") + "</td>" +
          "<td>" + esc(dateStr) + "</td>" +
          '<td><div class="row-actions">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-sub-edit="' + esc(s.id) + '"' + dis + ">Editar</button>" +
          '<button type="button" class="btn btn-danger btn-sm" data-sub-del="' + esc(s.id) + '"' + dis + ">Excluir</button>" +
          "</div></td></tr>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) +
        '<div class="stat-row">' +
        '<div class="stat-card"><div class="stat-value">' + state.newsletter.length + '</div><div class="stat-label">Total de inscritos</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + activeCount + '</div><div class="stat-label">Ativos</div></div>' +
        "</div>" +
        (writable
          ? '<div class="card">' +
            '<div class="card-head"><h2 class="card-title">' + (editing ? "Editar inscrito" : "Adicionar inscrito") + "</h2>" +
            (editing ? '<button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-sub">Cancelar edição</button>' : "") + "</div>" +
            '<div class="grid-3">' +
            '<div class="field"><label for="sub-email">E-mail</label><input type="email" id="sub-email" value="' + esc(editing ? editing.email : "") + '" placeholder="leitor@exemplo.com" /></div>' +
            '<div class="field"><label for="sub-name">Nome</label><input type="text" id="sub-name" value="' + esc(editing ? editing.name : "") + '" placeholder="Opcional" /></div>' +
            '<div class="field"><label for="sub-status">Status</label><select id="sub-status">' +
            '<option value="ativo"' + (!editing || editing.status === "ativo" ? " selected" : "") + ">Ativo</option>" +
            '<option value="inativo"' + (editing && editing.status === "inativo" ? " selected" : "") + ">Inativo</option>" +
            "</select></div></div>" +
            '<div class="field"><label for="sub-notes">Observações</label><input type="text" id="sub-notes" value="' + esc(editing ? editing.notes : "") + '" placeholder="Origem, interesse, etc." /></div>' +
            '<button type="button" class="btn btn-primary" id="btn-save-sub">' + (editing ? "Atualizar inscrito" : "Adicionar inscrito") + "</button>" +
            "</div>"
          : "") +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">Lista de inscritos (' + filtered.length + ')</h2>' +
        '<div class="row-actions">' +
        '<input type="text" id="sub-search" value="' + esc(state.newsletterFilter) + '" placeholder="Filtrar por e-mail ou nome..." style="background:#140b10;border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text)" />' +
        '<button type="button" class="btn btn-secondary" id="btn-export-csv">Baixar CSV</button>' +
        (writable ? '<label class="btn btn-secondary">Importar CSV<input type="file" id="input-import-csv" accept=".csv,text/csv" hidden /></label>' : "") +
        "</div></div>" +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>E-mail</th><th>Nome</th><th>Status</th><th>Observações</th><th>Cadastro</th><th>Ações</th></tr></thead><tbody>' +
        (rowsHtml || '<tr><td colspan="6" style="color:var(--muted)">Nenhum inscrito encontrado.</td></tr>') +
        "</tbody></table></div></div>";

      $("sub-search").addEventListener("input", function () {
        state.newsletterFilter = this.value;
        draw();
        var sEl = $("sub-search");
        if (sEl) { sEl.focus(); sEl.setSelectionRange(sEl.value.length, sEl.value.length); }
      });

      $("btn-export-csv").addEventListener("click", function () {
        var csv = core.toCsv(filtered);
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "newsletter-inscritos-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showToast("Arquivo CSV gerado (" + filtered.length + " registros).", "success");
      });

      if (writable) {
        if ($("btn-cancel-sub")) {
          $("btn-cancel-sub").addEventListener("click", function () {
            state.editingSubscriberId = null;
            draw();
          });
        }
        $("btn-save-sub").addEventListener("click", async function () {
          var email = core.normalizeEmail($("sub-email").value);
          if (!core.isValidEmail(email)) { showToast("Informe um e-mail válido.", "error"); return; }
          var payload = {
            email: email,
            name: $("sub-name").value,
            status: $("sub-status").value,
            notes: $("sub-notes").value
          };
          try {
            if (state.editingSubscriberId) {
              await state.adapter.updateNewsletter(state.editingSubscriberId, payload);
              state.editingSubscriberId = null;
              showToast("Inscrito atualizado.", "success");
            } else {
              await state.adapter.createNewsletter(payload);
              showToast("Inscrito adicionado.", "success");
            }
            state.newsletter = await state.adapter.listNewsletter();
            draw();
          } catch (err) {
            showToast("Erro ao salvar inscrito: " + (err.message || err), "error");
          }
        });

        $("input-import-csv").addEventListener("change", async function () {
          var file = this.files && this.files[0];
          if (!file) return;
          try {
            var text = await file.text();
            var parsed = core.parseNewsletterCsv(text);
            var existing = {};
            state.newsletter.forEach(function (s) { existing[core.normalizeEmail(s.email)] = true; });
            var imported = 0;
            for (var i = 0; i < parsed.length; i++) {
              if (existing[parsed[i].email]) continue;
              await state.adapter.createNewsletter(Object.assign({}, parsed[i], { source: "csv_import" }));
              existing[parsed[i].email] = true;
              imported++;
            }
            state.newsletter = await state.adapter.listNewsletter();
            showToast("Importação concluída: " + imported + " novo(s) inscrito(s) adicionado(s).", "success");
            draw();
          } catch (err) {
            showToast("Erro ao importar CSV: " + (err.message || err), "error");
          } finally {
            this.value = "";
          }
        });

        container.querySelectorAll("[data-sub-edit]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            state.editingSubscriberId = btn.dataset.subEdit;
            draw();
          });
        });
        container.querySelectorAll("[data-sub-del]").forEach(function (btn) {
          btn.addEventListener("click", async function () {
            if (!window.confirm("Excluir este inscrito da newsletter?")) return;
            try {
              await state.adapter.deleteNewsletter(btn.dataset.subDel);
              state.newsletter = await state.adapter.listNewsletter();
              showToast("Inscrito excluído.", "success");
              draw();
            } catch (err) {
              showToast("Erro ao excluir: " + (err.message || err), "error");
            }
          });
        });
      }
    }
    draw();
  }

  // --- 9a: Analytics (GA4) e Configurações de Push ---
  async function renderAnalyticsSection(writable) {
    var loaded = await loadContentOrDefault("settings");
    var data = Object.assign({
      gaMeasurementId: cfg.gaMeasurementId || "",
      pushEnabled: true,
      pushPromptTitle: "Receber avisos de lançamentos?",
      pushPromptBody: "Ative as notificações para saber primeiro quando novos livros forem publicados."
    }, loaded.data);
    var container = $("panel-content");
    var dis = writable ? "" : " disabled";

    container.innerHTML = readOnlyNotice(writable) + defaultNotice(loaded.isFromDb) +
      '<div class="card">' +
      '<div class="card-head"><h2 class="card-title">Google Analytics (GA4) e Convite de Web Push</h2>' +
      '<button type="button" class="btn btn-primary" id="btn-save-settings"' + dis + ">Salvar configurações</button></div>" +
      '<div class="field"><label for="ga-id-input">ID de medição GA4</label>' +
      '<input type="text" id="ga-id-input" value="' + esc(data.gaMeasurementId || "") + '" placeholder="G-XXXXXXXXXX"' + dis + " />" +
      '<span class="field-hint">O site rastreia automaticamente visualizações de página, cliques em Comprar, compartilhamentos, inscrições na newsletter e opt-in de push.</span></div>' +
      '<label class="checkbox-row"><input type="checkbox" id="push-enabled-input"' + (data.pushEnabled !== false ? " checked" : "") + dis + " /> Exibir convite para ativar notificações Web Push no site</label>" +
      '<div class="grid-2">' +
      '<div class="field"><label for="push-prompt-title">Título do convite no site</label><input type="text" id="push-prompt-title" value="' + esc(data.pushPromptTitle || "") + '"' + dis + " /></div>" +
      '<div class="field"><label for="push-prompt-body">Texto do convite no site</label><input type="text" id="push-prompt-body" value="' + esc(data.pushPromptBody || "") + '"' + dis + " /></div>" +
      "</div></div>";

    $("btn-save-settings").addEventListener("click", async function () {
      var gaId = String($("ga-id-input").value || "").trim();
      if (gaId && !/^G-[A-Z0-9]+$/i.test(gaId)) {
        showToast("ID do GA4 inválido. Use o formato G-XXXXXXXXXX.", "error");
        return;
      }
      try {
        await state.adapter.saveContentBlock("settings", {
          gaMeasurementId: gaId,
          pushEnabled: $("push-enabled-input").checked,
          pushPromptTitle: String($("push-prompt-title").value || "").trim(),
          pushPromptBody: String($("push-prompt-body").value || "").trim()
        });
        showToast("Configurações de Analytics e Push salvas.", "success");
      } catch (err) {
        showToast("Erro ao salvar: " + (err.message || err), "error");
      }
    });
  }

  // --- 9b: Envio de Web Push ---
  async function renderPushSection(writable) {
    state.pushCampaigns = await state.adapter.listPushCampaigns();
    state.pushSubscriberCount = await state.adapter.countPushSubscribers();
    var container = $("panel-content");
    var dis = writable ? "" : " disabled";

    function draw() {
      var historyRows = state.pushCampaigns.map(function (c) {
        return "<tr>" +
          "<td><strong>" + esc(c.title) + "</strong><div class=\"field-hint\">" + esc(c.body) + "</div></td>" +
          "<td>" + (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">Abrir</a>' : "—") + "</td>" +
          "<td>" + esc(c.sentBy || "—") + "</td>" +
          "<td>" + esc(c.sentAt ? String(c.sentAt).replace("T", " ").slice(0, 16) : "—") + "</td>" +
          "</tr>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) +
        '<div class="stat-row">' +
        '<div class="stat-card"><div class="stat-value">' + state.pushSubscriberCount + '</div><div class="stat-label">Dispositivos inscritos</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + state.pushCampaigns.length + '</div><div class="stat-label">Campanhas enviadas</div></div>' +
        "</div>" +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">Enviar nova notificação Web Push</h2></div>' +
        '<div class="grid-2">' +
        '<div class="field"><label for="push-title">Título (até 120 caracteres)</label><input type="text" id="push-title" maxlength="120" placeholder="Ex.: Novo livro disponível na Amazon!"' + dis + " /></div>" +
        '<div class="field"><label for="push-url">URL ao clicar (opcional)</label><input type="url" id="push-url" placeholder="https://www.amazon.com.br/dp/..."' + dis + " /></div>" +
        "</div>" +
        '<div class="field"><label for="push-body">Mensagem (até 300 caracteres)</label><textarea id="push-body" maxlength="300" placeholder="Confira o lançamento da trilogia As Ruínas da Alma."' + dis + "></textarea></div>" +
        '<div class="field"><label for="push-icon">Ícone da notificação (URL ou upload no R2, opcional)</label><div class="upload-row">' +
        '<input type="url" id="push-icon" placeholder="https://..."' + dis + " />" +
        '<label class="btn btn-secondary btn-sm">Enviar R2<input type="file" id="push-icon-file" accept="image/*" hidden' + dis + " /></label>" +
        "</div></div>" +
        '<button type="button" class="btn btn-primary" id="btn-send-push"' + dis + ">Disparar notificação agora</button>" +
        "</div>" +
        '<div class="card"><div class="card-head"><h2 class="card-title">Histórico de envios</h2></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Notificação</th><th>Link</th><th>Enviado por</th><th>Data</th></tr></thead><tbody>' +
        (historyRows || '<tr><td colspan="4" style="color:var(--muted)">Nenhuma notificação enviada ainda.</td></tr>') +
        "</tbody></table></div></div>";

      if (writable) {
        $("push-icon-file").addEventListener("change", function () {
          handleFileUpload(this, "push", function (url) { $("push-icon").value = url; });
        });
        $("btn-send-push").addEventListener("click", async function () {
          var title = String($("push-title").value || "").trim();
          var body = String($("push-body").value || "").trim();
          var url = String($("push-url").value || "").trim();
          var iconUrl = String($("push-icon").value || "").trim();
          if (!title || !body) {
            showToast("Preencha o título e a mensagem da notificação.", "error");
            return;
          }
          var btn = this;
          btn.disabled = true;
          try {
            await state.adapter.sendPush({ title: title, body: body, url: url, iconUrl: iconUrl, topic: "novidades" });
            state.pushCampaigns = await state.adapter.listPushCampaigns();
            showToast("Notificação Web Push enviada com sucesso.", "success");
            draw();
          } catch (err) {
            btn.disabled = false;
            showToast("Erro ao enviar Web Push: " + (err.message || err), "error");
          }
        });
      }
    }
    draw();
  }

  // --- 9c: Gestão de Usuários e Permissões Granulares ---
  async function renderUsersSection(writable) {
    state.users = await state.adapter.listUsers();
    var container = $("panel-content");
    var superAdmin = userIsSuperAdmin();

    function draw() {
      var dis = writable ? "" : " disabled";
      var editing = state.editingUserEmail
        ? state.users.find(function (u) { return core.normalizeEmail(u.email) === core.normalizeEmail(state.editingUserEmail); })
        : null;
      var formPerms = Object.assign(core.createEmptyPermissions(), editing && editing.permissions ? editing.permissions : {});

      var permRows = core.BLOCKS.map(function (b) {
        var val = formPerms[b.id] || "none";
        return '<div class="perm-row"><span>' + esc(b.label) + '</span>' +
          '<select data-perm-block="' + esc(b.id) + '"' + dis + ">" +
          '<option value="none"' + (val === "none" ? " selected" : "") + ">Sem acesso</option>" +
          '<option value="read"' + (val === "read" ? " selected" : "") + ">Somente leitura</option>" +
          '<option value="write"' + (val === "write" ? " selected" : "") + ">Leitura e escrita</option>" +
          "</select></div>";
      }).join("");

      var userRows = state.users.map(function (u) {
        var summary = u.isSuperAdmin
          ? '<span class="badge badge-write">Super-admin (acesso total)</span>'
          : core.BLOCKS.filter(function (b) { return u.permissions && u.permissions[b.id] && u.permissions[b.id] !== "none"; })
              .map(function (b) {
                var lvl = u.permissions[b.id];
                return '<span class="tag-pill">' + esc(b.label) + ": " + (lvl === "write" ? "E" : "L") + "</span>";
              }).join(" ") || '<span class="field-hint">Sem blocos</span>';

        var canEditRow = writable && (superAdmin || !u.isSuperAdmin);
        return "<tr>" +
          "<td><strong>" + esc(u.email) + "</strong><div class=\"field-hint\">" + esc(u.name || "") + "</div></td>" +
          '<td><div class="tag-preview">' + summary + "</div></td>" +
          '<td><div class="row-actions">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-user-edit="' + esc(u.email) + '"' + (canEditRow ? "" : " disabled") + ">Editar</button>" +
          '<button type="button" class="btn btn-danger btn-sm" data-user-del="' + esc(u.email) + '"' + (canEditRow ? "" : " disabled") + ">Remover</button>" +
          "</div></td></tr>";
      }).join("");

      container.innerHTML = readOnlyNotice(writable) +
        (writable
          ? '<div class="card">' +
            '<div class="card-head"><h2 class="card-title">' + (editing ? "Editar permissões: " + esc(editing.email) : "Autorizar nova conta Google") + "</h2>" +
            (editing ? '<button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-user">Cancelar</button>' : "") + "</div>" +
            '<div class="grid-2">' +
            '<div class="field"><label for="u-email">E-mail da conta Google</label><input type="email" id="u-email" value="' + esc(editing ? editing.email : "") + '"' + (editing ? " disabled" : "") + ' placeholder="usuario@gmail.com" /></div>' +
            '<div class="field"><label for="u-name">Nome</label><input type="text" id="u-name" value="' + esc(editing ? editing.name : "") + '" placeholder="Nome do colaborador" /></div>' +
            "</div>" +
            (superAdmin
              ? '<label class="checkbox-row"><input type="checkbox" id="u-super"' + (editing && editing.isSuperAdmin ? " checked" : "") + " /> Super-administrador (leitura e escrita em todos os blocos)</label>"
              : "") +
            '<div class="row-actions" style="margin:8px 0 12px">' +
            '<span class="field-hint">Atalhos:</span>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-perm-preset="read">Todos leitura</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-perm-preset="write">Todos escrita</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-perm-preset="none">Limpar</button>' +
            "</div>" +
            '<div class="perm-grid">' + permRows + "</div>" +
            '<div style="margin-top:14px"><button type="button" class="btn btn-primary" id="btn-save-user">' + (editing ? "Salvar permissões" : "Autorizar usuário") + "</button></div>" +
            "</div>"
          : "") +
        '<div class="card"><div class="card-head"><h2 class="card-title">Usuários autorizados (' + state.users.length + ')</h2></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Conta Google</th><th>Permissões (L = Leitura, E = Escrita)</th><th>Ações</th></tr></thead><tbody>' +
        (userRows || '<tr><td colspan="3" style="color:var(--muted)">Nenhum usuário cadastrado no Firestore ainda.</td></tr>') +
        "</tbody></table></div></div>";

      if (writable) {
        if ($("btn-cancel-user")) {
          $("btn-cancel-user").addEventListener("click", function () { state.editingUserEmail = null; draw(); });
        }
        container.querySelectorAll("[data-perm-preset]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var preset = btn.dataset.permPreset;
            container.querySelectorAll("[data-perm-block]").forEach(function (sel) { sel.value = preset; });
          });
        });
        $("btn-save-user").addEventListener("click", async function () {
          var email = core.normalizeEmail($("u-email").value);
          if (!core.isValidEmail(email)) { showToast("Informe um e-mail Google válido.", "error"); return; }
          var perms = core.createEmptyPermissions();
          container.querySelectorAll("[data-perm-block]").forEach(function (sel) {
            perms[sel.dataset.permBlock] = sel.value;
          });
          var isSuper = superAdmin && $("u-super") ? $("u-super").checked : false;
          try {
            await state.adapter.saveUser({
              email: email,
              name: $("u-name").value,
              isSuperAdmin: isSuper,
              permissions: perms
            });
            state.editingUserEmail = null;
            state.users = await state.adapter.listUsers();
            showToast("Permissões salvas para " + email + ".", "success");
            draw();
          } catch (err) {
            showToast("Erro ao salvar usuário: " + (err.message || err), "error");
          }
        });
        container.querySelectorAll("[data-user-edit]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            state.editingUserEmail = btn.dataset.userEdit;
            draw();
          });
        });
        container.querySelectorAll("[data-user-del]").forEach(function (btn) {
          btn.addEventListener("click", async function () {
            var targetEmail = btn.dataset.userDel;
            if (!window.confirm("Remover acesso de " + targetEmail + "?")) return;
            try {
              await state.adapter.deleteUser(targetEmail);
              state.users = await state.adapter.listUsers();
              showToast("Acesso removido.", "success");
              draw();
            } catch (err) {
              showToast("Erro ao remover: " + (err.message || err), "error");
            }
          });
        });
      }
    }
    draw();
  }

  // --- Controle de Sessão ---
  async function handleAuthChange(user) {
    state.authUser = user;
    $("auth-error").hidden = true;
    if (!user) {
      $("auth-screen").hidden = false;
      $("denied-screen").hidden = true;
      $("admin-shell").hidden = true;
      return;
    }
    try {
      state.userRecord = await state.adapter.getUserRecord(user.email);
    } catch (err) {
      $("auth-error").textContent = "Não foi possível consultar suas permissões: " + (err.message || err);
      $("auth-error").hidden = false;
      return;
    }

    var blocks = getAccessibleBlocks();
    if (!blocks.length) {
      $("auth-screen").hidden = true;
      $("admin-shell").hidden = true;
      $("denied-email").textContent = user.email;
      $("denied-screen").hidden = false;
      return;
    }

    $("auth-screen").hidden = true;
    $("denied-screen").hidden = true;
    $("admin-shell").hidden = false;
    var initial = blocks.some(function (b) { return b.id === state.activeBlock; }) ? state.activeBlock : blocks[0].id;
    await openBlock(initial);
  }

  function wireShellEvents() {
    $("sidebar-nav").addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-block]");
      if (btn) openBlock(btn.dataset.block);
    });
    $("btn-sidebar-open").addEventListener("click", function () {
      $("admin-sidebar").classList.add("open");
    });
    $("btn-sidebar-close").addEventListener("click", function () {
      $("admin-sidebar").classList.remove("open");
    });
    $("btn-logout").addEventListener("click", function () {
      if (state.adapter) state.adapter.signOut();
    });
    $("btn-denied-logout").addEventListener("click", function () {
      if (state.adapter) state.adapter.signOut();
    });
    $("btn-google-login").addEventListener("click", async function () {
      $("auth-error").hidden = true;
      if (!state.adapter) {
        $("auth-error").textContent = "Configure o Firebase em assets/config.js antes de fazer login.";
        $("auth-error").hidden = false;
        return;
      }
      try {
        await state.adapter.signInWithGoogle();
      } catch (err) {
        $("auth-error").textContent = "Falha no login Google: " + (err.message || err);
        $("auth-error").hidden = false;
      }
    });
  }

  async function init() {
    wireShellEvents();
    if (window.LG_ADMIN_ADAPTER) {
      state.adapter = window.LG_ADMIN_ADAPTER;
      state.adapter.onAuthStateChanged(handleAuthChange);
      return;
    }
    if (!isFirebaseConfigured()) {
      $("config-warning").hidden = false;
      $("btn-google-login").disabled = true;
      return;
    }
    try {
      state.adapter = await createFirebaseAdapter();
      state.adapter.onAuthStateChanged(handleAuthChange);
    } catch (err) {
      $("auth-error").textContent = "Erro ao inicializar Firebase: " + (err.message || err);
      $("auth-error").hidden = false;
    }
  }

  window.LG_ADMIN_APP = { openBlock: openBlock, getState: function () { return state; } };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// Lógica compartilhada entre o site público (index.html), o painel admin (admin.html) e os testes.
// Sem dependências externas; compatível com navegador (window.LG_CMS_CORE) e Node (module.exports).
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LG_CMS_CORE = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var BLOCKS = [
    { id: "topMenu", label: "Menu do topo", description: "Labels e links da navegação superior e do menu mobile." },
    { id: "socialLinks", label: "Redes sociais do topo", description: "Ícones e destinos das redes sociais no cabeçalho." },
    { id: "hero", label: "Texto de chamada", description: "Frase principal abaixo do nome da autora no topo." },
    { id: "author", label: "Bloco da autora", description: "Foto, título e descrição com texto formatado (rich text)." },
    { id: "books", label: "Livros", description: "Capas, títulos, sinopses, tags, link e rótulo do botão Comprar." },
    { id: "themes", label: "Temas", description: "Ícones e rótulos da seção de temas das histórias." },
    { id: "footerMenu", label: "Menu do rodapé", description: "Labels e links da navegação inferior." },
    { id: "newsletter", label: "Newsletter", description: "Visualizar, editar, excluir, importar e baixar inscritos." },
    { id: "analytics", label: "Analytics e Push (Config)", description: "ID do Google Analytics (GA4) e prompt de notificações." },
    { id: "push", label: "Envio de Web Push", description: "Enviar notificações para usuários inscritos e ver histórico." },
    { id: "users", label: "Usuários e permissões", description: "Autorizar contas Google e definir leitura/escrita por bloco." }
  ];

  var SOCIAL_PRESETS = {
    instagram: {
      label: "Instagram",
      svg: '<svg aria-hidden="true" fill="none" height="19" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" width="19"><rect height="18" rx="5" width="18" x="3" y="3"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" fill="currentColor" r=".6"></circle></svg>'
    },
    substack: {
      label: "Substack",
      svg: '<svg aria-hidden="true" fill="currentColor" height="19" viewBox="0 0 24 24" width="19"><path d="M3 4h18v2H3zM3 8h18v2H3zM5 12h14v9l-7-4-7 4z"></path></svg>'
    },
    facebook: {
      label: "Facebook",
      svg: '<svg aria-hidden="true" fill="currentColor" height="19" viewBox="0 0 24 24" width="19"><path d="M14 8.5V6.6c0-.8.4-1.1 1.2-1.1H17V2.2h-2.7C11.6 2.2 10.6 4 10.6 6.3v2.2H8V12h2.6v9.8H14V12h2.6l.5-3.5z"></path></svg>'
    },
    whatsapp: {
      label: "WhatsApp",
      svg: '<svg aria-hidden="true" fill="none" height="19" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" width="19"><path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z"></path><path d="M9.2 8.6c0 3.4 2.8 6.2 6.2 6.2l.9-1.4-1.8-.9-.9.9c-1.1-.5-2.3-1.7-2.8-2.8l.9-.9-.9-1.8z" fill="currentColor" stroke="none"></path></svg>'
    },
    tiktok: {
      label: "TikTok",
      svg: '<svg aria-hidden="true" fill="currentColor" height="19" viewBox="0 0 24 24" width="19"><path d="M16.5 3h-2.6v11.1a2.9 2.9 0 1 1-2.1-2.8V8.6a5.5 5.5 0 1 0 4.7 5.4V8.4a6.4 6.4 0 0 0 3.5 1.1V7a3.8 3.8 0 0 1-3.5-4z"></path></svg>'
    },
    youtube: {
      label: "YouTube",
      svg: '<svg aria-hidden="true" fill="none" height="19" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" width="19"><rect x="2.5" y="5.5" width="19" height="13" rx="3.5"></rect><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"></path></svg>'
    },
    twitter: {
      label: "X / Twitter",
      svg: '<svg aria-hidden="true" fill="currentColor" height="19" viewBox="0 0 24 24" width="19"><path d="M18.2 3h3l-6.6 7.5L22.3 21h-6.1l-4.7-6.2L6 21H3l7-8L2.7 3H9l4.3 5.7L18.2 3zm-1 16.2h1.7L7.9 4.7H6.1l11.1 14.5z"></path></svg>'
    },
    book: {
      label: "Amazon / Livros",
      svg: '<svg aria-hidden="true" fill="none" height="19" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" width="19"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"></path><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"></path></svg>'
    },
    mail: {
      label: "E-mail",
      svg: '<svg aria-hidden="true" fill="none" height="19" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" width="19"><rect height="14" rx="2" width="18" x="3" y="5"></rect><path d="M3 7l9 6 9-6"></path></svg>'
    },
    globe: {
      label: "Site / Link",
      svg: '<svg aria-hidden="true" fill="none" height="19" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" width="19"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"></path></svg>'
    }
  };

  var THEME_PRESETS = {
    heart: {
      label: "Coração",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"></path></svg>'
    },
    feather: {
      label: "Pena / Poesia",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M20 3C12 4.5 7 10 5.5 19L4 21"></path><path d="M20 3c-1 6-5 11-12 14 2-4 4-7 6-9-3 3-5 6-6.5 9C9 10 13 5.5 20 3z"></path></svg>'
    },
    eye: {
      label: "Olho / Suspense",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="34"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
    },
    skull: {
      label: "Crânio / Terror",
      svg: '<svg aria-hidden="true" fill="#d2a79c" height="32" viewBox="0 0 24 24" width="32"><path d="M12 3a7.5 7.5 0 0 0-4.5 13.5V19a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2.5A7.5 7.5 0 0 0 12 3zm-3 7.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm6 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM11 15.5l1-1.8 1 1.8z" fill-rule="evenodd"></path></svg>'
    },
    crown: {
      label: "Coroa / Medieval",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="34"><path d="M3 18h18M4 18L3 8l5 4 4-7 4 7 5-4-1 10"></path><circle cx="12" cy="14.5" r="1"></circle><circle cx="7.5" cy="15" r=".8"></circle><circle cx="16.5" cy="15" r=".8"></circle></svg>'
    },
    brain: {
      label: "Mente / Psicologia",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M11 4.5A3 3 0 0 0 6 6.6a3 3 0 0 0-2.4 4.6A3 3 0 0 0 5 16.5a3 3 0 0 0 4.5 2.8A2.4 2.4 0 0 0 11 20V4.5zM13 4.5a3 3 0 0 1 5 2.1 3 3 0 0 1 2.4 4.6 3 3 0 0 1-1.4 5.3 3 3 0 0 1-4.5 2.8A2.4 2.4 0 0 1 13 20V4.5z"></path><path d="M8 9.5c1 0 2 .6 2 1.8M16 9.5c-1 0-2 .6-2 1.8M7.5 14c1 .4 2 .2 2.6-.6M16.5 14c-1 .4-2 .2-2.6-.6"></path></svg>'
    },
    moon: {
      label: "Lua",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M18.5 14.5A7.5 7.5 0 0 1 9.5 5.5a7.5 7.5 0 1 0 9 9z"></path></svg>'
    },
    star: {
      label: "Estrela",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 16.6 6.6 19.6l1.2-6.1-4.5-4.2 6.1-.7z"></path></svg>'
    },
    book: {
      label: "Livro",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"></path><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"></path></svg>'
    },
    flame: {
      label: "Chama",
      svg: '<svg aria-hidden="true" fill="none" height="32" stroke="#d2a79c" stroke-width="1.1" viewBox="0 0 24 24" width="32"><path d="M12 3c2.8 3.2 5 6.2 5 9.8a5 5 0 1 1-10 0c0-2.5 1.3-4.9 3-6.8.2 1.7 1.1 2.7 2 3.2-.2-2-.1-4 0-6.2z"></path></svg>'
    }
  };

  var DEFAULT_CONTENT = {
    topMenu: {
      items: [
        { label: "Início", href: "#inicio", newTab: false },
        { label: "Sobre a Autora", href: "#sobre", newTab: false },
        { label: "Livros", href: "#livros", newTab: false },
        { label: "Temas", href: "#temas", newTab: false },
        { label: "Newsletter", href: "#contato", newTab: false }
      ]
    },
    socialLinks: {
      items: [
        { label: "Instagram", href: "https://www.instagram.com/larissagalvao.escreve", iconType: "preset", iconPreset: "instagram", iconUrl: "", iconSvg: "" },
        { label: "Substack", href: "https://substack.com/@larissagalvao", iconType: "preset", iconPreset: "substack", iconUrl: "", iconSvg: "" }
      ]
    },
    hero: {
      tagline: "Histórias que mergulham na mente,\nno coração e nos lugares mais sombrios da alma."
    },
    author: {
      title: "Sobre a Autora",
      photoUrl: "images/portrait.png",
      photoAlt: "Retrato artístico de Larissa Galvão em moldura ornamental",
      bioHtml: "<p>Larissa Galvão é escritora, poeta e estudante de Psicologia. Desde muito jovem, encontrou na literatura uma maneira de explorar a complexidade da existência humana, transformando sentimentos, inquietações e experiências em palavras. Sua escrita transita entre a poesia, o conto, o ensaio, o romance, o terror psicológico, o drama e a ficção, frequentemente abordando temas como a melancolia, a memória, a identidade, a morte, o amor, a fragilidade humana e os aspectos mais obscuros da mente. Autora de obras independentes publicadas na Amazon, também compartilha seus escritos no Substack, onde constrói uma comunidade de leitores interessados em literatura e reflexões sobre a condição humana. Amante da literatura, da psicologia, dos animais e de tudo aquilo que desperta questionamentos sobre a existência, Larissa acredita na escrita como uma forma de dar linguagem ao indizível e eternizar aquilo que, de outra maneira, poderia se perder.</p>"
    },
    books: {
      sectionTitle: "Livros em Destaque",
      items: [
        {
          title: "Tudo que Ficou de Nós",
          coverUrl: "images/cover1.jpg",
          description: "Elvira perdeu quase tudo: o casamento, a proximidade da filha e Hélio, o grande amor de sua vida, que está entre a vida e a morte. Ao encontrar cartas guardadas por três décadas, ela é lançada a pesadelos que a levam de volta a outras épocas, a amores e feridas antigas. Entre memória e mistério, uma história comovente sobre culpa, perdão e segundas chances — e sobre um amor que talvez nem o tempo consiga separar.",
          tags: ["Romance", "Drama", "Suspense psicológico", "Memória", "Segundas chances", "Amor"],
          buyLabel: "Comprar",
          buyUrl: "https://www.amazon.com.br/dp/B0HS653SFG",
          comingSoon: false
        },
        {
          title: "O Reino dos Que Nunca Morrem",
          coverUrl: "images/cover2.jpg",
          description: "Aprisionado há séculos no Santuário dos Vampiros, Elliot foge para o mundo humano e encontra Coraline, uma princesa presa às obrigações da coroa. Entre vampiros, bruxas, sereias, dragões e uma guerra entre dois mundos, nasce um amor proibido que desafia o destino e a própria eternidade. Uma fantasia romântica sombria sobre liberdade, pertencimento e o preço de amar quem deveria ser seu inimigo.",
          tags: ["Fantasia romântica", "Vampiros", "Medieval", "Amor proibido", "Magia", "Aventura"],
          buyLabel: "Comprar",
          buyUrl: "https://www.amazon.com.br/dp/B0HS95TVWG",
          comingSoon: false
        },
        {
          title: "As Ruínas da Alma — Parte I: O Inventário de Tudo o que Dói",
          coverUrl: "images/cover_ruinas_parte1.jpeg",
          description: "O começo da travessia: um catálogo íntimo das dores que moram no peito. A tristeza ao amanhecer, a mãe que nunca enxergou a filha e o amor que fere e cura se transformam em versos — até a descoberta de que, mesmo no fundo do abismo, tudo é arte.",
          tags: ["Poesia", "Infância", "Dor", "Amor", "18+"],
          buyLabel: "Comprar",
          buyUrl: "https://www.amazon.com.br/dp/B0HSQK58HX",
          comingSoon: false
        },
        {
          title: "As Ruínas da Alma — Parte II: O Museu das Coisas que Morreram",
          coverUrl: "images/cover_ruinas_parte2.jpeg",
          description: "Uma viagem pelas galerias da memória: o toque que nunca foi embora, a infância que partiu sem se despedir, a avó que segurou a mão da neta e os amores que viraram retratos congelados no tempo. Poemas sobre o luto daquilo que existiu e do que nunca chegou a existir.",
          tags: ["Poesia", "Memória", "Luto", "Saudade", "18+"],
          buyLabel: "Comprar",
          buyUrl: "https://www.amazon.com.br/dp/B0HSQQ27PK",
          comingSoon: false
        },
        {
          title: "As Ruínas da Alma — Parte III: A Última Anatomia do Sofrimento",
          coverUrl: "images/cover_ruinas_parte3.jpeg",
          description: "O mergulho final — e o mais corajoso. A dor é dissecada até o osso em poemas de imagens brutais e catárticas que enfrentam o trauma, o abuso e a culpa de frente. Um encerramento devastador e libertador, que termina como toda grande travessia: com um adeus.",
          tags: ["Poesia", "Trauma", "Abuso", "Catarse", "18+"],
          buyLabel: "Em breve",
          buyUrl: "",
          comingSoon: true
        }
      ]
    },
    themes: {
      sectionTitle: "Temas que você encontra\nnas minhas histórias",
      items: [
        { label: "Sentimentos e Emoção", iconType: "preset", iconPreset: "heart", iconUrl: "", iconSvg: "" },
        { label: "Poesia", iconType: "preset", iconPreset: "feather", iconUrl: "", iconSvg: "" },
        { label: "Suspense", iconType: "preset", iconPreset: "eye", iconUrl: "", iconSvg: "" },
        { label: "Terror", iconType: "preset", iconPreset: "skull", iconUrl: "", iconSvg: "" },
        { label: "Medieval", iconType: "preset", iconPreset: "crown", iconUrl: "", iconSvg: "" },
        { label: "Questões Psicológicas", iconType: "preset", iconPreset: "brain", iconUrl: "", iconSvg: "" },
        { label: "Romance", iconType: "preset", iconPreset: "heart", iconUrl: "", iconSvg: "" }
      ]
    },
    footerMenu: {
      items: [
        { label: "Início", href: "#inicio", newTab: false },
        { label: "Sobre a Autora", href: "#sobre", newTab: false },
        { label: "Livros", href: "#livros", newTab: false },
        { label: "Temas", href: "#temas", newTab: false },
        { label: "Newsletter", href: "#contato", newTab: false }
      ]
    },
    settings: {
      gaMeasurementId: "",
      pushEnabled: true,
      pushPromptTitle: "Receber avisos de lançamentos?",
      pushPromptBody: "Ative as notificações para saber primeiro quando novos livros forem publicados."
    }
  };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeUrl(url, opts) {
    var options = opts || {};
    var allowHash = options.allowHash !== false;
    var allowRelative = options.allowRelative !== false;
    var raw = String(url == null ? "" : url).trim();
    if (!raw) return "";
    // Remove control characters / whitespace obfuscation before checking protocol
    var compact = raw.replace(/[\u0000-\u001F\u007F\s]+/g, "");
    if (allowHash && raw.charAt(0) === "#") {
      return /^#[A-Za-z0-9_-]+$/.test(raw) ? raw : "";
    }
    if (/^(https?:|mailto:)/i.test(compact)) {
      try {
        var parsed = new URL(raw);
        if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
          return raw;
        }
      } catch (e) {
        return "";
      }
      return "";
    }
    if (allowRelative && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(compact) && !raw.startsWith("//")) {
      return raw;
    }
    return "";
  }

  function normalizeAmazonUrl(url) {
    var clean = sanitizeUrl(url, { allowHash: false, allowRelative: false });
    if (!clean) return "";
    return clean.replace(/(https?:\/\/(?:www\.)?amazon\.com(?:\.br)?)\/gp\/product\/([A-Z0-9]{10})(?:[/?#].*)?$/i, "$1/dp/$2");
  }

  var ALLOWED_RICH_TAGS = {
    P: true, BR: true, STRONG: true, B: true, EM: true, I: true, U: true, S: true,
    UL: true, OL: true, LI: true, BLOCKQUOTE: true, A: true, H3: true, H4: true, SPAN: true, DIV: true
  };

  function sanitizeRichTextDom(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString("<div>" + String(html == null ? "" : html) + "</div>", "text/html");
    var rootEl = doc.body.firstChild;

    function walk(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === 3) continue; // text node
        if (child.nodeType !== 1) {
          node.removeChild(child);
          continue;
        }
        var tag = child.tagName.toUpperCase();
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED" || tag === "FORM") {
          node.removeChild(child);
          continue;
        }
        if (!ALLOWED_RICH_TAGS[tag]) {
          // Unwrap unknown tag keeping its sanitized children
          walk(child);
          while (child.firstChild) {
            node.insertBefore(child.firstChild, child);
          }
          node.removeChild(child);
          continue;
        }
        // Strip all attributes except safe href on <a>
        var attrs = Array.prototype.slice.call(child.attributes);
        var safeHref = "";
        for (var j = 0; j < attrs.length; j++) {
          var attrName = attrs[j].name.toLowerCase();
          if (tag === "A" && attrName === "href") {
            safeHref = sanitizeUrl(attrs[j].value, { allowHash: true, allowRelative: true });
          }
          child.removeAttribute(attrs[j].name);
        }
        if (tag === "A") {
          if (safeHref) {
            child.setAttribute("href", safeHref);
            if (/^https?:/i.test(safeHref)) {
              child.setAttribute("target", "_blank");
              child.setAttribute("rel", "noopener noreferrer");
            }
          } else {
            walk(child);
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            continue;
          }
        }
        walk(child);
      }
    }

    walk(rootEl);
    return rootEl.innerHTML.trim();
  }

  function sanitizeRichTextFallback(html) {
    // Fallback determinístico para Node (sem DOMParser)
    var out = String(html == null ? "" : html);
    out = out.replace(/<\s*(script|style|iframe|object|embed|form|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
    out = out.replace(/<\s*(script|style|iframe|object|embed|form)[^>]*\/?>/gi, "");
    out = out.replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, function (match, tagName, attrs) {
      var upper = tagName.toUpperCase();
      if (!ALLOWED_RICH_TAGS[upper]) return "";
      if (match.charAt(1) === "/") return "</" + tagName.toLowerCase() + ">";
      if (upper === "BR") return "<br>";
      if (upper === "A") {
        var hrefMatch = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
        var rawHref = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || "") : "";
        var safeHref = sanitizeUrl(rawHref, { allowHash: true, allowRelative: true });
        if (!safeHref) return "<span>";
        var extra = /^https?:/i.test(safeHref) ? ' target="_blank" rel="noopener noreferrer"' : "";
        return '<a href="' + escapeHtml(safeHref) + '"' + extra + ">";
      }
      return "<" + tagName.toLowerCase() + ">";
    });
    return out.trim();
  }

  function sanitizeRichText(html) {
    if (typeof DOMParser !== "undefined") {
      return sanitizeRichTextDom(html);
    }
    return sanitizeRichTextFallback(html);
  }

  function sanitizeSvg(svg) {
    var raw = String(svg == null ? "" : svg).trim();
    if (!raw || !/^<svg\b/i.test(raw) || !/<\/svg>\s*$/i.test(raw)) return "";
    // Strip dangerous elements and event handlers
    var cleaned = raw
      .replace(/<\s*(script|foreignObject|iframe|object|embed|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*(script|foreignObject|iframe|object|embed|style)[^>]*\/?>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+(?:xlink:)?href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    if (/javascript:/i.test(cleaned)) return "";
    return cleaned;
  }

  function createEmptyPermissions() {
    var perms = {};
    for (var i = 0; i < BLOCKS.length; i++) {
      perms[BLOCKS[i].id] = "none";
    }
    return perms;
  }

  function normalizeEmail(email) {
    return String(email == null ? "" : email).trim().toLowerCase();
  }

  function canRead(userRecord, blockId, bootstrapAdmins) {
    if (!userRecord) return false;
    var email = normalizeEmail(userRecord.email);
    if (Array.isArray(bootstrapAdmins) && bootstrapAdmins.map(normalizeEmail).indexOf(email) !== -1) {
      return true;
    }
    if (userRecord.isSuperAdmin === true) return true;
    var level = userRecord.permissions && userRecord.permissions[blockId];
    return level === "read" || level === "write";
  }

  function canWrite(userRecord, blockId, bootstrapAdmins) {
    if (!userRecord) return false;
    var email = normalizeEmail(userRecord.email);
    if (Array.isArray(bootstrapAdmins) && bootstrapAdmins.map(normalizeEmail).indexOf(email) !== -1) {
      return true;
    }
    if (userRecord.isSuperAdmin === true) return true;
    var level = userRecord.permissions && userRecord.permissions[blockId];
    return level === "write";
  }

  function escapeCsvCell(value) {
    var str = String(value == null ? "" : value);
    // Proteção contra Formula Injection em planilhas (Excel/Sheets)
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function toCsv(subscribers) {
    var header = ["email", "nome", "status", "observacoes", "criado_em"];
    var lines = [header.join(",")];
    var list = Array.isArray(subscribers) ? subscribers : [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      lines.push([
        escapeCsvCell(s.email || ""),
        escapeCsvCell(s.name || ""),
        escapeCsvCell(s.status || "ativo"),
        escapeCsvCell(s.notes || ""),
        escapeCsvCell(s.createdAt || "")
      ].join(","));
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  function parseCsvLine(line) {
    var result = [];
    var cur = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"' && line.charAt(i + 1) === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === "," || ch === ";") {
          result.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    result.push(cur.trim());
    return result;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
  }

  function parseNewsletterCsv(csvText) {
    var text = String(csvText == null ? "" : csvText).replace(/^\uFEFF/, "");
    var rawLines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (!rawLines.length) return [];
    var firstCols = parseCsvLine(rawLines[0]).map(function (c) { return c.toLowerCase(); });
    var hasHeader = firstCols.some(function (c) { return c.indexOf("email") !== -1 || c.indexOf("e-mail") !== -1; });
    var emailIdx = 0;
    var nameIdx = 1;
    var statusIdx = 2;
    var notesIdx = 3;
    if (hasHeader) {
      emailIdx = firstCols.findIndex(function (c) { return c.indexOf("email") !== -1 || c.indexOf("e-mail") !== -1; });
      if (emailIdx < 0) emailIdx = 0;
      nameIdx = firstCols.findIndex(function (c) { return c === "nome" || c === "name"; });
      statusIdx = firstCols.findIndex(function (c) { return c === "status"; });
      notesIdx = firstCols.findIndex(function (c) { return c.indexOf("obs") !== -1 || c === "notes"; });
    }
    var seen = {};
    var items = [];
    for (var i = hasHeader ? 1 : 0; i < rawLines.length; i++) {
      var cols = parseCsvLine(rawLines[i]);
      var email = normalizeEmail(cols[emailIdx] || "");
      if (!isValidEmail(email) || seen[email]) continue;
      seen[email] = true;
      items.push({
        email: email,
        name: nameIdx >= 0 ? (cols[nameIdx] || "") : "",
        status: statusIdx >= 0 && cols[statusIdx] ? cols[statusIdx] : "ativo",
        notes: notesIdx >= 0 ? (cols[notesIdx] || "") : ""
      });
    }
    return items;
  }

  function renderIconHtml(item, presetMap, sizePx) {
    var size = sizePx || 19;
    if (item && item.iconType === "url") {
      var safeImg = sanitizeUrl(item.iconUrl, { allowHash: false, allowRelative: true });
      if (safeImg) {
        return '<img src="' + escapeHtml(safeImg) + '" alt="" aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;display:block">';
      }
    }
    if (item && item.iconType === "svg") {
      var safeSvg = sanitizeSvg(item.iconSvg);
      if (safeSvg) return safeSvg;
    }
    var preset = item && item.iconPreset && presetMap[item.iconPreset];
    if (preset) return preset.svg;
    var firstKey = Object.keys(presetMap)[0];
    return presetMap[firstKey].svg;
  }

  return {
    BLOCKS: BLOCKS,
    SOCIAL_PRESETS: SOCIAL_PRESETS,
    THEME_PRESETS: THEME_PRESETS,
    DEFAULT_CONTENT: DEFAULT_CONTENT,
    escapeHtml: escapeHtml,
    sanitizeUrl: sanitizeUrl,
    normalizeAmazonUrl: normalizeAmazonUrl,
    sanitizeRichText: sanitizeRichText,
    sanitizeSvg: sanitizeSvg,
    createEmptyPermissions: createEmptyPermissions,
    normalizeEmail: normalizeEmail,
    canRead: canRead,
    canWrite: canWrite,
    escapeCsvCell: escapeCsvCell,
    toCsv: toCsv,
    parseNewsletterCsv: parseNewsletterCsv,
    isValidEmail: isValidEmail,
    renderIconHtml: renderIconHtml
  };
});

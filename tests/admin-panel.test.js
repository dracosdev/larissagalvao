// Valida o painel administrativo (admin.html): login Google, tela de acesso negado,
// RBAC granular por bloco (sem acesso / leitura / leitura e escrita), CRUD de todos os blocos,
// rich text da autora, upload R2, newsletter CRUD + CSV, Web Push e gestão de usuários.
// Uso: node tests/admin-panel.test.js   (requer Playwright + Chromium)
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

function buildMockInitScript(scenario) {
  return `
    window.__mockStore = {
      content: {},
      newsletter: [
        { id: 'n1', email: 'ana@exemplo.com', name: 'Ana', status: 'ativo', notes: 'Instagram', createdAt: '2026-11-20T10:00:00Z' }
      ],
      users: [
        { email: 'admin@gmail.com', name: 'Admin', isSuperAdmin: true, permissions: {} },
        { email: 'leitor@gmail.com', name: 'Leitor', isSuperAdmin: false, permissions: { books: 'read', hero: 'write', newsletter: 'read', users: 'write' } }
      ],
      pushCampaigns: [
        { id: 'p0', title: 'Legado XSS', body: 'Teste link malicioso', url: 'javascript:window.__pushXss=1', sentBy: 'editor@gmail.com', sentAt: '2026-11-24T12:00:00Z' }
      ],
      uploads: [],
      pushSubscriberCount: 42
    };
    window.__authCb = null;
    window.LG_ADMIN_ADAPTER = {
      onAuthStateChanged(cb) {
        window.__authCb = cb;
        cb(${JSON.stringify(scenario.user)});
      },
      async signInWithGoogle() {},
      async signOut() { if (window.__authCb) window.__authCb(null); },
      async getUserRecord(email) {
        return window.__mockStore.users.find(u => u.email === email) || null;
      },
      async getContentBlock(docId) { return window.__mockStore.content[docId] || null; },
      async saveContentBlock(docId, data) { window.__mockStore.content[docId] = data; return data; },
      async listNewsletter() { return [...window.__mockStore.newsletter]; },
      async createNewsletter(sub) {
        const item = { id: 'n' + (window.__mockStore.newsletter.length + 1), ...sub, createdAt: '2026-11-25T12:00:00Z' };
        window.__mockStore.newsletter.unshift(item);
        return item;
      },
      async updateNewsletter(id, sub) {
        const idx = window.__mockStore.newsletter.findIndex(x => x.id === id);
        if (idx >= 0) window.__mockStore.newsletter[idx] = { ...window.__mockStore.newsletter[idx], ...sub };
        return window.__mockStore.newsletter[idx];
      },
      async deleteNewsletter(id) {
        window.__mockStore.newsletter = window.__mockStore.newsletter.filter(x => x.id !== id);
      },
      async listUsers() { return [...window.__mockStore.users]; },
      async saveUser(u) {
        const idx = window.__mockStore.users.findIndex(x => x.email === u.email);
        if (idx >= 0) window.__mockStore.users[idx] = u;
        else window.__mockStore.users.push(u);
        return u;
      },
      async deleteUser(email) {
        window.__mockStore.users = window.__mockStore.users.filter(x => x.email !== email);
      },
      async uploadMedia(file, block) {
        const url = 'https://pub-mock.r2.dev/' + block + '/' + file.name;
        window.__mockStore.uploads.push({ block, name: file.name, url });
        return { key: block + '/' + file.name, url };
      },
      async listPushCampaigns() { return [...window.__mockStore.pushCampaigns]; },
      async countPushSubscribers() { return window.__mockStore.pushSubscriberCount; },
      async sendPush(payload) {
        const c = { id: 'p1', ...payload, sentBy: 'admin@gmail.com', sentAt: '2026-11-25T15:00:00Z', messageId: 'msg-1' };
        window.__mockStore.pushCampaigns.unshift(c);
        return c;
      }
    };
  `;
}

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'admin.html');
  const browser = await chromium.launch();

  // Caso 1: Usuário Google sem autorização -> tela de acesso negado
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(buildMockInitScript({ user: { uid: 'u0', email: 'estranho@gmail.com', displayName: 'Estranho' } }));
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForSelector('#denied-screen:not([hidden])');
    const txt = await page.textContent('#denied-email');
    assert.strictEqual(txt.trim(), 'estranho@gmail.com');
    await ctx.close();
  }

  // Caso 2: Usuário restrito (books: read, hero: write, newsletter: read, demais: none)
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(buildMockInitScript({ user: { uid: 'u2', email: 'leitor@gmail.com', displayName: 'Leitor' } }));
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForSelector('#admin-shell:not([hidden])');

    const visibleBlocks = await page.$$eval('#sidebar-nav [data-block]', bs => bs.map(b => b.dataset.block));
    assert.deepStrictEqual(visibleBlocks, ['hero', 'books', 'newsletter'], 'RBAC na sidebar incorreto');

    // Hero tem escrita -> edita e salva
    await page.fill('#hero-tagline-input', 'Frase editada pelo colaborador');
    await page.click('#btn-save-hero');
    const savedHero = await page.evaluate(() => window.__mockStore.content.hero.tagline);
    assert.strictEqual(savedHero, 'Frase editada pelo colaborador');

    // Books é somente leitura -> botão salvar desabilitado e badge "Somente leitura"
    await page.click('#sidebar-nav [data-block="books"]');
    assert.strictEqual(await page.textContent('#perm-badge'), 'Somente leitura');
    assert.strictEqual(await page.isDisabled('#btn-save-books'), true);
    assert.strictEqual(await page.isDisabled('#btn-add-book'), true);

    // Newsletter é somente leitura -> pode baixar CSV, não pode adicionar/excluir
    await page.click('#sidebar-nav [data-block="newsletter"]');
    assert.strictEqual(await page.$('#btn-save-sub'), null);
    assert.strictEqual(await page.isDisabled('#btn-export-csv'), false);
    await ctx.close();
  }

  // Caso 3: Super-administrador -> testa todos os blocos, rich text, upload R2, newsletter, push e usuários
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(buildMockInitScript({ user: { uid: 'u1', email: 'admin@gmail.com', displayName: 'Admin' } }));
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(url);
    await page.waitForSelector('#admin-shell:not([hidden])');

    const allBlocks = await page.$$eval('#sidebar-nav [data-block]', bs => bs.map(b => b.dataset.block));
    assert.strictEqual(allBlocks.length, 11, 'Super-admin deveria ver todos os 11 blocos');

    // Menu do topo: adiciona e salva
    await page.click('#btn-add-menu');
    const inputs = await page.$$('[data-field="label"]');
    await inputs[inputs.length - 1].fill('Novidades');
    const hrefs = await page.$$('[data-field="href"]');
    await hrefs[hrefs.length - 1].fill('#livros');
    await page.click('#btn-save-menu');
    const savedMenu = await page.evaluate(() => window.__mockStore.content.topMenu.items);
    assert(savedMenu.some(i => i.label === 'Novidades'));

    // Autora: upload foto R2 + rich text com sanitização XSS
    await page.click('#sidebar-nav [data-block="author"]');
    await page.setInputFiles('#author-photo-file', { name: 'nova-autora.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) });
    await page.waitForFunction(() => document.getElementById('author-photo-url').value.includes('nova-autora.png'));
    await page.evaluate(() => {
      document.getElementById('author-bio-editor').innerHTML = '<p>Biografia <strong>atualizada</strong><script>alert(1)</script></p>';
    });
    await page.click('#btn-save-author');
    const savedAuthor = await page.evaluate(() => window.__mockStore.content.author);
    assert(savedAuthor.photoUrl.endsWith('/author/nova-autora.png'));
    assert(savedAuthor.bioHtml.includes('<strong>atualizada</strong>') && !savedAuthor.bioHtml.includes('<script'));

    // Livros: muda rótulo do botão "Comprar" e salva
    await page.click('#sidebar-nav [data-block="books"]');
    await page.fill('[data-field="buyLabel"][data-idx="0"]', 'Garantir exemplar');
    await page.click('#btn-save-books');
    const savedBooks = await page.evaluate(() => window.__mockStore.content.books.items);
    assert.strictEqual(savedBooks[0].buyLabel, 'Garantir exemplar');

    // Newsletter: adiciona inscrito e verifica tabela
    await page.click('#sidebar-nav [data-block="newsletter"]');
    await page.fill('#sub-email', 'novo@leitor.com');
    await page.fill('#sub-name', 'Carlos');
    await page.click('#btn-save-sub');
    await page.waitForFunction(() => window.__mockStore.newsletter.length === 2);

    // Analytics (GA4)
    await page.click('#sidebar-nav [data-block="analytics"]');
    await page.fill('#ga-id-input', 'G-ABC123XYZ');
    await page.click('#btn-save-settings');
    const savedSettings = await page.evaluate(() => window.__mockStore.content.settings);
    assert.strictEqual(savedSettings.gaMeasurementId, 'G-ABC123XYZ');

    // Web Push: link malicioso no histórico é neutralizado e novo envio aparece no histórico
    await page.click('#sidebar-nav [data-block="push"]');
    const unsafePushLinks = await page.$$eval('#panel-content table a', as => as.filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length);
    assert.strictEqual(unsafePushLinks, 0, 'Link javascript: no histórico de push deveria ter sido bloqueado');
    await page.fill('#push-title', 'Novo livro no ar');
    await page.fill('#push-body', 'Confira agora na Amazon.');
    await page.fill('#push-url', 'https://www.amazon.com.br/dp/B0HSQK58HX');
    await page.click('#btn-send-push');
    await page.waitForFunction(() => window.__mockStore.pushCampaigns.length === 2);

    // SVG sanitizer via DOMParser no navegador bloqueia vetores avançados
    const svgCheck = await page.evaluate(() => {
      const cleaned = window.LG_CMS_CORE.sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="window.__svgXss=1"><script>window.__svgXss=2</script><style>body{display:none}</style><animate attributeName="href" values="javascript:alert(1)"/><a href="javascript:alert(2)"><rect width="10" height="10"/></a><circle cx="12" cy="12" r="5"/></svg>'
      );
      return cleaned;
    });
    assert(!svgCheck.includes('onload') && !svgCheck.includes('<script') && !svgCheck.includes('<style') && !svgCheck.includes('<animate') && !svgCheck.includes('href'), 'DOMParser SVG sanitizer falhou no navegador');
    assert(svgCheck.includes('<circle'), 'DOMParser SVG sanitizer removeu elemento seguro');

    // Usuários: cadastra novo usuário com permissão granular (users sempre desabilitado para não-superadmins)
    await page.click('#sidebar-nav [data-block="users"]');
    assert.strictEqual(await page.isDisabled('[data-perm-block="users"]'), true, 'permissão users deve ficar desabilitada para colaboradores');
    await page.fill('#u-email', 'marketing@gmail.com');
    await page.fill('#u-name', 'Equipe MKT');
    await page.selectOption('[data-perm-block="newsletter"]', 'write');
    await page.selectOption('[data-perm-block="books"]', 'read');
    await page.click('#btn-save-user');
    const mktUser = await page.evaluate(() => window.__mockStore.users.find(u => u.email === 'marketing@gmail.com'));
    assert.strictEqual(mktUser.permissions.newsletter, 'write');
    assert.strictEqual(mktUser.permissions.books, 'read');
    assert.strictEqual(mktUser.permissions.users, 'none');

    await ctx.close();
  }

  await browser.close();
  console.log('OK — painel admin validado (acesso negado, RBAC por bloco, CRUD completo, R2, CSV, Push, SVG DOMParser e Usuários)');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

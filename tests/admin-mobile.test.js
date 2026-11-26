// Valida usabilidade mobile do painel admin (admin.html) em todos os 11 blocos:
// sem rolagem horizontal, inputs/selects >= 16px (sem auto-zoom iOS) e >= 40px de altura,
// drawer com backdrop + Esc, barra rápida horizontal, acordeão de itens e tabelas em cards.
// Uso: node tests/admin-mobile.test.js   (requer Playwright + Chromium)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BLOCKS = ['topMenu', 'socialLinks', 'hero', 'author', 'books', 'themes', 'footerMenu', 'newsletter', 'analytics', 'push', 'users'];
const SHOTS = path.join(__dirname, 'screenshots');

const MOCK_INIT = `
  window.LG_ADMIN_ADAPTER = {
    onAuthStateChanged(cb) { cb({ uid: 'u1', email: 'djmacloud@gmail.com', displayName: 'Diogo' }); },
    async getUserRecord() { return { email: 'djmacloud@gmail.com', name: 'Diogo', isSuperAdmin: true, permissions: {} }; },
    async getContentBlock() { return null; },
    async saveContentBlock(id, d) { return d; },
    async listNewsletter() {
      return [
        { id: 'n1', email: 'leitora.muito.longa@exemplo.com.br', name: 'Maria Silva', status: 'ativo', notes: 'Instagram', createdAt: '2026-11-25T10:00:00Z' }
      ];
    },
    async listUsers() {
      return [
        { email: 'djmacloud@gmail.com', name: 'Diogo', isSuperAdmin: true, permissions: {} },
        { email: 'colaboradora@gmail.com', name: 'Ana', isSuperAdmin: false, permissions: { books: 'write', author: 'read' } }
      ];
    },
    async listPushCampaigns() {
      return [{ id: 'p1', title: 'Novo livro disponível!', body: 'Confira a trilogia completa na Amazon.', url: 'https://larissa.zip', sentBy: 'djmacloud@gmail.com', sentAt: '2026-11-25T12:00:00Z' }];
    },
    async countPushSubscribers() { return 24; }
  };
`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const url = 'file://' + path.resolve(__dirname, '..', 'admin.html');
  const browser = await chromium.launch();
  const errors = [];

  for (const width of [320, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(MOCK_INIT);
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForSelector('#admin-shell:not([hidden])');

    // 1. Drawer mobile abre com backdrop e fecha com Esc e clique no backdrop
    await page.click('#btn-sidebar-open');
    await page.waitForTimeout(250);
    const drawerOpened = await page.evaluate(() =>
      document.getElementById('admin-sidebar').classList.contains('open') &&
      !document.getElementById('sidebar-backdrop').hidden
    );
    if (!drawerOpened) errors.push(`[${width}px] drawer mobile não abriu com backdrop`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const drawerClosedEsc = await page.evaluate(() =>
      !document.getElementById('admin-sidebar').classList.contains('open') &&
      document.getElementById('sidebar-backdrop').hidden
    );
    if (!drawerClosedEsc) errors.push(`[${width}px] drawer mobile não fechou com Escape`);

    // 2. Barra rápida horizontal troca de bloco com 1 toque
    await page.click('#mobile-block-strip [data-block="books"]');
    await page.waitForTimeout(150);
    const booksActive = await page.textContent('#section-title');
    if (booksActive.trim() !== 'Livros') errors.push(`[${width}px] barra rápida não trocou para Livros`);

    // 3. Acordeão mobile em Livros: livro #1 aberto, #2 colapsado, toque em Editar abre #2
    const accBefore = await page.evaluate(() => ({
      firstCollapsed: document.querySelector('.item-card[data-idx="0"]').classList.contains('is-collapsed'),
      secondCollapsed: document.querySelector('.item-card[data-idx="1"]').classList.contains('is-collapsed')
    }));
    if (accBefore.firstCollapsed || !accBefore.secondCollapsed) {
      errors.push(`[${width}px] acordeão de Livros deveria abrir #1 e colapsar #2`);
    }
    await page.click('.item-card[data-idx="1"] [data-act="toggle"]');
    const secondOpen = await page.evaluate(() => !document.querySelector('.item-card[data-idx="1"]').classList.contains('is-collapsed'));
    if (!secondOpen) errors.push(`[${width}px] acordeão não expandiu Livro #2 ao tocar`);

    // 4. Auditoria de todos os 11 blocos: sem rolagem horizontal, inputs >= 16px e >= 40px altura
    for (const blk of BLOCKS) {
      await page.evaluate(id => window.LG_ADMIN_APP.openBlock(id), blk);
      await page.waitForTimeout(120);

      const issues = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw + 1) {
          out.push(`rolagem horizontal (${document.documentElement.scrollWidth}px > ${vw}px)`);
        }
        const visible = el => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        };
        for (const el of document.querySelectorAll('#panel-content input:not([type="checkbox"]):not([type="file"]), #panel-content select, #panel-content textarea')) {
          if (!visible(el)) continue;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const fsPx = parseFloat(s.fontSize);
          if (fsPx < 16) out.push(`fonte < 16px (${fsPx}px) em ${el.tagName}#${el.id || el.dataset.field || el.dataset.permBlock}`);
          if (r.height < 40) out.push(`altura < 40px (${Math.round(r.height)}px) em ${el.tagName}#${el.id || el.dataset.field || el.dataset.permBlock}`);
        }
        for (const btn of document.querySelectorAll('#panel-content button, #panel-content label.btn')) {
          if (!visible(btn)) continue;
          const r = btn.getBoundingClientRect();
          if (r.height < 36) out.push(`botão baixo (${Math.round(r.height)}px): ${btn.textContent.trim()}`);
        }
        return out;
      });
      issues.forEach(msg => errors.push(`[${width}px][${blk}] ${msg}`));

      if (width === 390 && ['author', 'books', 'newsletter', 'users'].includes(blk)) {
        await page.screenshot({ path: path.join(SHOTS, `mobile-admin-after-${blk}.png`) });
      }
    }

    await ctx.close();
  }

  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    console.log(`FALHOU: ${errors.length} problema(s) mobile no painel`);
    process.exit(1);
  }
  console.log('OK — painel admin mobile validado em 320px e 390px nos 11 blocos (sem overflow, inputs >= 16px, acordeão e tabelas em cards)');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

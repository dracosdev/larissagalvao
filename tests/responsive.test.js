// Auditoria de responsividade e usabilidade em vários tamanhos de tela.
// Uso: node tests/responsive.test.js   (requer Playwright + Chromium)
// Gera screenshots de página inteira em tests/screenshots/ (ignorado pelo git).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WIDTHS = [320, 360, 375, 390, 414, 600, 768, 820, 900, 1024, 1100, 1280, 1366, 1440, 1920];
const SHOTS = path.join(__dirname, 'screenshots');

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  let total = 0;

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: width < 700 ? 800 : 900 } });
    await page.goto(url);
    await page.waitForTimeout(300);

    const issues = await page.evaluate(() => {
      const out = [];
      const vw = document.documentElement.clientWidth;
      const visible = e => {
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const label = e => `${e.tagName.toLowerCase()} "${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;

      // 1. Sem rolagem horizontal e nada para fora da tela
      if (document.documentElement.scrollWidth > vw) out.push(`rolagem horizontal (${document.documentElement.scrollWidth}px > ${vw}px)`);
      for (const e of document.querySelectorAll('body *')) {
        if (!visible(e) || e.closest('.lg-mobile-sidebar') || getComputedStyle(e).position === 'fixed') continue;
        const r = e.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) out.push(`fora da tela: ${label(e)}`);
      }

      // 2. Nenhum texto solto como "\n" visível na página
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) {
        const tag = n.parentElement.tagName;
        if (tag !== 'SCRIPT' && tag !== 'STYLE' && n.textContent.includes('\\n')) out.push('texto "\\n" literal visível');
      }

      // 3. Cards de livros: largura legível, "Recomendar" e ícones sem sobreposição nem corte
      for (const card of document.querySelectorAll('#livros .lg-card')) {
        const cr = card.getBoundingClientRect();
        if (cr.width < 200) out.push(`card estreito demais (${Math.round(cr.width)}px): ${card.querySelector('h3').textContent.slice(0, 25)}`);
        const lbl = card.querySelector('.book-share-label'), icons = card.querySelector('.book-share-icons');
        if (!lbl || !icons) { out.push('card sem .book-share-label/.book-share-icons'); continue; }
        const lr = lbl.getBoundingClientRect(), ir = icons.getBoundingClientRect();
        const overlap = lr.right > ir.left + 1 && lr.bottom > ir.top + 1 && ir.bottom > lr.top + 1;
        if (overlap) out.push(`"Recomendar" sobreposto aos ícones: ${card.querySelector('h3').textContent.slice(0, 25)}`);
        if (lbl.scrollWidth > lbl.clientWidth + 1) out.push(`"Recomendar" cortado: ${card.querySelector('h3').textContent.slice(0, 25)}`);
        if (ir.right > cr.right + 1 || ir.left < cr.left - 1) out.push(`ícones saem do card: ${card.querySelector('h3').textContent.slice(0, 25)}`);
      }

      // 4. Alvos de toque com no mínimo 24x24 px (WCAG 2.2 AA)
      for (const e of document.querySelectorAll('a, button, input, select, textarea')) {
        if (!visible(e) || e.closest('.lg-mobile-sidebar')) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) out.push(`alvo de toque pequeno ${Math.round(r.width)}x${Math.round(r.height)}: ${label(e)}`);
      }
      return [...new Set(out)];
    });

    // 5. Menu mobile: abre, links e botão fechar com 44px de altura, fecha com Esc
    if (width <= 820) {
      await page.click('.lg-mobile-menu-toggle');
      await page.waitForTimeout(350);
      const menu = await page.evaluate(() => {
        const sb = document.getElementById('lg-mobile-sidebar');
        const r = sb.getBoundingClientRect();
        const small = [...sb.querySelectorAll('a, button')].filter(e => e.getBoundingClientRect().height < 44).map(e => e.textContent.trim());
        return { open: r.left >= -1 && r.right <= document.documentElement.clientWidth + 1, small };
      });
      if (!menu.open) issues.push('menu mobile não abriu dentro da tela');
      menu.small.forEach(t => issues.push(`item do menu mobile com menos de 44px: "${t}"`));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      if (await page.getAttribute('.lg-mobile-menu-toggle', 'aria-expanded') !== 'false') issues.push('menu mobile não fechou com Esc');
    }

    await page.screenshot({ path: path.join(SHOTS, `${width}.png`), fullPage: true });
    console.log(`${issues.length ? '✗' : '✓'} ${width}px${issues.length ? '\n    ' + issues.join('\n    ') : ''}`);
    total += issues.length;
    await page.close();
  }

  await browser.close();
  console.log(total ? `FALHOU: ${total} problema(s)` : `OK — ${WIDTHS.length} larguras verificadas (screenshots em tests/screenshots/)`);
  process.exit(total ? 1 : 0);
})();

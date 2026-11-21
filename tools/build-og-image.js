// Gera images/og-image.jpg (1200x630), a imagem que aparece na prévia do link no
// WhatsApp, Facebook etc. Rode de novo ao trocar capas ou textos em tools/og-image.html.
// Uso: node tools/build-og-image.js   (requer Playwright + Chromium)
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('file://' + path.join(__dirname, 'og-image.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const out = path.join(__dirname, '..', 'images', 'og-image.jpg');
  await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
  await browser.close();
  console.log('Gerado:', out);
})();

// Verifica que todos os cards de livros (disponíveis e "Em breve") exibem
// os mesmos ícones de compartilhamento, com as mesmas cores e tamanhos.
// Uso: node tests/book-share-icons.test.js   (requer Playwright + Chromium)
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  let failed = false;
  for (const [name, width] of [['desktop', 1400], ['tablet', 820], ['celular', 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url);
    const cards = await page.$$eval('#livros .lg-card', cs => cs.map(c => ({
      soon: !!c.querySelector('.disabled-coming-soon'),
      icons: [...c.querySelectorAll('.lg-soc, a[href="#contato"]')].map(e => {
        const s = getComputedStyle(e);
        return [e.getAttribute('aria-label').startsWith('Compartilhar') ? 'share' : e.getAttribute('aria-label'),
          s.width, s.height, s.backgroundColor, s.backgroundImage].join(' | ');
      }),
    })));
    const ref = cards.find(c => !c.soon);
    if (!ref || !cards.some(c => c.soon)) { console.error(`[${name}] cards de referência ausentes`); failed = true; }
    cards.forEach((c, i) => {
      if (JSON.stringify(c.icons) !== JSON.stringify(ref.icons)) {
        failed = true;
        console.error(`[${name}] card ${i} (${c.soon ? 'Em breve' : 'disponível'}) difere:\n  esperado ${JSON.stringify(ref.icons)}\n  obtido   ${JSON.stringify(c.icons)}`);
      }
      if (c.icons.some(x => x.includes('rgb(239, 239, 239)'))) {
        failed = true; console.error(`[${name}] card ${i} tem botão sem cor (cinza padrão)`);
      }
    });
    console.log(`[${name}] ${cards.length} cards verificados`);
    await page.close();
  }
  await browser.close();
  console.log(failed ? 'FALHOU' : 'OK');
  process.exit(failed ? 1 : 0);
})();

// Valida hidratação dinâmica do site (index.html) via LG_SITE_CMS, sanitização de rich text,
// rastreio GA4 (dataLayer), newsletter e banner de opt-in de Web Push.
// Uso: node tests/site-cms-hydration.test.js   (requer Playwright + Chromium)
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);

  // 1. Aplica conteúdo dinâmico em todos os 7 blocos + GA4
  await page.evaluate(() => {
    window.LG_SITE_CMS.applyContent({
      topMenu: {
        items: [
          { label: 'Home Nova', href: '#inicio', newTab: false },
          { label: 'Catálogo', href: '#livros', newTab: false },
          { label: 'Blog Externo', href: 'https://substack.com/@larissagalvao', newTab: true }
        ]
      },
      socialLinks: {
        items: [
          { label: 'YouTube', href: 'https://youtube.com/@larissa', iconType: 'preset', iconPreset: 'youtube' },
          { label: 'Ícone R2', href: 'https://instagram.com/larissa', iconType: 'url', iconUrl: 'images/portrait.png' }
        ]
      },
      hero: {
        tagline: 'Nova frase de impacto,\nem duas linhas.'
      },
      author: {
        title: 'Quem escreve',
        photoUrl: 'images/cover1.jpg',
        photoAlt: 'Nova foto da autora',
        bioHtml: '<p>Texto em <strong>negrito</strong> e <em>itálico</em>.</p><script>window.__xss=1</script><img src=x onerror="window.__xss=2"><p><a href="https://substack.com/@larissagalvao">Leia no Substack</a></p>'
      },
      books: {
        sectionTitle: 'Obras Publicadas',
        items: [
          {
            title: 'Livro Dinâmico 1',
            coverUrl: 'images/cover1.jpg',
            description: 'Sinopse atualizada.',
            tags: ['Poesia', 'Novidade'],
            buyLabel: 'Comprar na Amazon',
            buyUrl: 'https://www.amazon.com.br/gp/product/B0HSQQ27PK',
            comingSoon: false
          },
          {
            title: 'Livro Futuro',
            coverUrl: 'images/cover2.jpg',
            description: 'Em preparação.',
            tags: ['Suspense'],
            buyLabel: 'Aguarde',
            buyUrl: '',
            comingSoon: true
          }
        ]
      },
      themes: {
        sectionTitle: 'Universos\ndas histórias',
        items: [
          { label: 'Mistério', iconType: 'preset', iconPreset: 'moon' },
          { label: 'Magia', iconType: 'preset', iconPreset: 'star' }
        ]
      },
      footerMenu: {
        items: [
          { label: 'Topo', href: '#inicio', newTab: false },
          { label: 'Obras', href: '#livros', newTab: false }
        ]
      },
      settings: {
        gaMeasurementId: 'G-TEST123456',
        pushEnabled: true,
        pushPromptTitle: 'Ativar avisos?',
        pushPromptBody: 'Receba alertas de novos livros.'
      }
    });
  });

  const checks = await page.evaluate(() => {
    const desktopMenu = [...document.querySelectorAll('header nav[aria-label="Principal"] a')].map(a => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target }));
    const mobileMenu = [...document.querySelectorAll('#lg-mobile-sidebar nav a')].map(a => a.textContent);
    const socials = [...document.querySelectorAll('[data-cms="social-links"] a')].map(a => ({ label: a.getAttribute('aria-label'), href: a.getAttribute('href'), hasImg: !!a.querySelector('img') }));
    const heroHtml = document.querySelector('[data-cms="hero-tagline"]').innerHTML;
    const authorTitle = document.querySelector('[data-cms="author-title"]').textContent;
    const authorBioHtml = document.querySelector('[data-cms="author-bio"]').innerHTML;
    const authorPhoto = document.querySelector('[data-cms="author-photo"]').getAttribute('src');
    const books = [...document.querySelectorAll('#livros .lg-card')].map(c => ({
      title: c.querySelector('h3').textContent,
      cta: c.querySelector('.lg-out span').textContent.trim(),
      href: c.querySelector('a.lg-out')?.getAttribute('href') || null,
      disabled: !!c.querySelector('button.disabled-coming-soon')
    }));
    const themes = [...document.querySelectorAll('[data-cms="themes-list"] li')].map(li => li.textContent.trim());
    const footerMenu = [...document.querySelectorAll('footer nav[aria-label="Rodapé"] a')].map(a => a.textContent);
    const footerSeps = document.querySelectorAll('footer nav[aria-label="Rodapé"] .lg-footer-separator').length;
    return { desktopMenu, mobileMenu, socials, heroHtml, authorTitle, authorBioHtml, authorPhoto, books, themes, footerMenu, footerSeps, xss: window.__xss || 0, hasDataLayer: Array.isArray(window.dataLayer) && window.dataLayer.length >= 2 };
  });

  assert.strictEqual(checks.desktopMenu.length, 3);
  assert.strictEqual(checks.desktopMenu[2].target, '_blank');
  assert.deepStrictEqual(checks.mobileMenu, ['Home Nova', 'Catálogo', 'Blog Externo']);
  assert.strictEqual(checks.socials.length, 2);
  assert.strictEqual(checks.socials[1].hasImg, true);
  assert(checks.heroHtml.includes('Nova frase de impacto,<br>em duas linhas.'));
  assert.strictEqual(checks.authorTitle, 'Quem escreve');
  assert.strictEqual(checks.authorPhoto, 'images/cover1.jpg');
  assert.strictEqual(checks.xss, 0, 'XSS não foi bloqueado!');
  assert(!checks.authorBioHtml.includes('<script') && !checks.authorBioHtml.includes('onerror'));
  assert(checks.authorBioHtml.includes('<strong>negrito</strong>'));
  assert.strictEqual(checks.books.length, 2);
  assert.strictEqual(checks.books[0].cta, 'Comprar na Amazon');
  assert.strictEqual(checks.books[0].href, 'https://www.amazon.com.br/dp/B0HSQQ27PK');
  assert.strictEqual(checks.books[1].disabled, true);
  assert.strictEqual(checks.books[1].cta, 'Aguarde');
  assert.deepStrictEqual(checks.themes, ['Mistério', 'Magia']);
  assert.deepStrictEqual(checks.footerMenu, ['Topo', 'Obras']);
  assert.strictEqual(checks.footerSeps, 1);
  assert.strictEqual(checks.hasDataLayer, true, 'GA4 não inicializou dataLayer');

  // 2. Newsletter grava via handler e dispara evento GA4
  await page.evaluate(() => {
    window.__savedEmails = [];
    window.LG_CUSTOM_NEWSLETTER_SAVE = async (email) => { window.__savedEmails.push(email); };
  });
  await page.fill('#lg-email', 'Leitora@Exemplo.com');
  await page.click('#lg-news button[type="submit"]');
  await page.waitForFunction(() => window.__savedEmails.length === 1);
  const savedEmail = await page.evaluate(() => window.__savedEmails[0]);
  assert.strictEqual(savedEmail, 'leitora@exemplo.com');

  // 3. Banner de Web Push: renderização, alvos de toque >= 24px e fluxo de aceite
  await page.evaluate(() => {
    window.__pushAccepted = false;
    window.LG_CUSTOM_PUSH_SUBSCRIBE = async () => { window.__pushAccepted = true; };
    window.LG_SITE_CMS.showPushBanner({ pushPromptTitle: 'Novidades?', pushPromptBody: 'Ative o push.' });
  });
  const btnSizes = await page.$$eval('#lg-push-banner button', bs => bs.map(b => {
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }));
  assert(btnSizes.length === 2 && btnSizes.every(s => s.w >= 24 && s.h >= 24), 'botões do banner de push menores que 24px');
  await page.click('#lg-push-banner [data-push-action="accept"]');
  await page.waitForFunction(() => window.__pushAccepted === true);

  await browser.close();
  console.log('OK — hidratação CMS, sanitização XSS, GA4, newsletter e Web Push verificados');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

// Valida os botões de compartilhamento (livros e site) e que o endereço compartilhado é sempre
// o endereço onde o site está rodando — GitHub Pages hoje, domínio próprio amanhã — sem configuração.
// Uso: node tests/share-links.test.js   (requer Playwright + Chromium; não acessa a internet)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

// [endereço aberto no navegador, pasta em que o site é servido, endereço esperado nos compartilhamentos]
const CASES = [
  ['https://dracosdev.github.io/larissagalvao/', '/larissagalvao/', 'https://dracosdev.github.io/larissagalvao/'],
  ['https://dracosdev.github.io/larissagalvao/index.html?utm_source=x#livros', '/larissagalvao/', 'https://dracosdev.github.io/larissagalvao/'],
  ['https://www.dominio-oficial.com.br/', '/', 'https://www.dominio-oficial.com.br/'],
  ['https://dominio-oficial.com.br/index.html#contato', '/', 'https://dominio-oficial.com.br/'],
  ['http://localhost:8080/', '/', 'http://localhost:8080/'],
];

function serve(page, mount) {
  return page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith(mount) || /googleapis|gstatic/.test(u.host)) return route.abort();
    let rel = decodeURIComponent(u.pathname.slice(mount.length)) || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  });
}

const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };

(async () => {
  const browser = await chromium.launch();

  for (const [openUrl, mount, expected] of CASES) {
    const tag = `[${openUrl}]`;
    const enc = encodeURIComponent(expected);
    const ctx = await browser.newContext();
    // Captura o que seria enviado ao menu nativo de compartilhamento do celular
    await ctx.addInitScript(() => {
      window.__shared = [];
      navigator.share = data => { window.__shared.push(data); return Promise.resolve(); };
    });
    const page = await ctx.newPage();
    await serve(page, mount);
    await page.goto(openUrl);

    check(await page.evaluate(() => window.LG_SITE_URL) === expected, `${tag} endereço detectado ${await page.evaluate(() => window.LG_SITE_URL)} ≠ ${expected}`);

    const links = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, raw: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.getAttribute('aria-label') || a.textContent.trim(), card: a.closest('.lg-card')?.querySelector('h3')?.textContent.trim() || null, amazon: a.closest('.lg-card')?.querySelector('a[href*="amazon.com.br/dp/"]')?.href || null })));

    // Nenhum resto de placeholder nem domínio fixo no HTML
    check(!links.some(l => l.href.includes('__SITE_URL')), `${tag} placeholder __SITE_URL não substituído`);
    check(!(await page.content()).includes('larissagalvao.com.br'), `${tag} domínio fixo larissagalvao.com.br no HTML`);

    // Compartilhamento por link (WhatsApp / Facebook)
    const shareLinks = links.filter(l => /wa\.me|facebook\.com\/sharer/.test(l.href));
    check(shareLinks.length === 12, `${tag} esperados 12 links WhatsApp/Facebook, achados ${shareLinks.length}`);
    for (const l of shareLinks) {
      const target = l.amazon || expected; // livro disponível → página da Amazon; demais → o site
      const u = new URL(l.href);
      const text = u.searchParams.get('text') || '';
      const shared = u.host === 'wa.me' ? text : u.searchParams.get('u');
      check(shared && shared.includes(target), `${tag} ${l.label} (${l.card || 'site'}) não leva a ${target}: ${shared}`);
      check(!text.includes('\\n'), `${tag} ${l.label} (${l.card || 'site'}) tem "\\n" literal no texto`);
      check(l.target === '_blank' && /noopener/.test(l.rel), `${tag} ${l.label} deveria abrir em nova aba com rel=noopener`);
    }

    // Links externos abrem em nova aba; âncoras internas apontam para seções que existem
    for (const l of links) {
      if (/^https?:/.test(l.raw)) check(l.target === '_blank' && /noopener/.test(l.rel), `${tag} link externo sem _blank/noopener: ${l.raw}`);
      if (l.raw.startsWith('#')) check(await page.$(l.raw) !== null, `${tag} âncora sem destino: ${l.raw}`);
    }

    // Botões de compartilhamento nativo (Instagram, Substack, Outras redes) — livros e site
    const buttons = await page.$$('.native-share-book, .native-share-site, #lg-share-native');
    check(buttons.length === 13, `${tag} esperados 13 botões de compartilhamento nativo, achados ${buttons.length}`);
    for (const b of buttons) {
      const info = await b.evaluate(el => ({ card: el.closest('.lg-card')?.querySelector('h3')?.textContent.trim() || null, amazon: el.closest('.lg-card')?.querySelector('a[href*="amazon.com.br/dp/"]')?.href || null }));
      await page.evaluate(() => { window.__shared = []; });
      await b.click();
      const got = await page.evaluate(() => window.__shared);
      const target = info.amazon || expected;
      check(got.length === 1 && got[0].url === target, `${tag} botão nativo (${info.card || 'site'}) compartilhou ${JSON.stringify(got)}; esperado ${target}`);
      if (got[0]) check(got[0].text.includes(target) && got[0].title, `${tag} botão nativo (${info.card || 'site'}) sem título/texto com o link`);
    }

    // Imagens carregam (caminhos relativos funcionam na subpasta e na raiz)
    const broken = await page.$$eval('img', imgs => imgs.filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')));
    check(broken.length === 0, `${tag} imagens quebradas: ${broken.join(', ')}`);

    await ctx.close();
  }

  // Sem menu nativo (desktop): copia texto + link para a área de transferência
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined });
    window.__copied = null; window.__alert = null;
    navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); };
    window.alert = m => { window.__alert = m; };
  });
  const page = await ctx.newPage();
  await serve(page, '/');
  await page.goto('https://dominio-oficial.com.br/');
  await page.click('#lg-share-native');
  await page.waitForFunction(() => window.__copied !== null);
  const copied = await page.evaluate(() => window.__copied);
  check(copied.includes('https://dominio-oficial.com.br/'), `[desktop] texto copiado sem o link do site: ${copied}`);
  check(!!(await page.evaluate(() => window.__alert)), '[desktop] usuário não foi avisado de que o texto foi copiado');
  await ctx.close();

  // Arquivo aberto direto do disco: usa o endereço público de fallback
  const p2 = await browser.newPage();
  await p2.goto('file://' + path.join(ROOT, 'index.html'));
  const fallback = await p2.evaluate(() => window.LG_SITE_URL);
  check(/^https:\/\//.test(fallback), `[file://] fallback deveria ser um endereço https público: ${fallback}`);

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); console.log(`FALHOU: ${errors.length} problema(s)`); process.exit(1); }
  console.log(`OK — ${CASES.length} endereços, 12 links e 13 botões de compartilhamento verificados em cada`);
})();

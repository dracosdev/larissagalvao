// Valida as tags de prévia do link (og:*) e o script de deploy que grava o endereço publicado.
// Uso: node tests/site-url-deploy.test.js   (só Node; não acessa a internet)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'set-site-url.js');
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };

const meta = (html, prop) => (html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1];
const canonical = html => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
const fallback = html => (html.match(/var FALLBACK_SITE_URL = "([^"]+)";/) || [])[1];

// 1. index.html do repositório: tags completas e coerentes com o endereço padrão
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const base = fallback(html);
check(base && /^https:\/\/.+\/$/.test(base), `FALLBACK_SITE_URL ausente ou sem barra final: ${base}`);
for (const p of ['og:type', 'og:locale', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt', 'twitter:card']) {
  check(meta(html, p), `tag ${p} ausente`);
}
check(meta(html, 'og:url') === base && canonical(html) === base, 'og:url/canonical diferentes do endereço padrão');
check(meta(html, 'og:image') === base + 'images/og-image.jpg', `og:image deveria ser absoluta: ${meta(html, 'og:image')}`);

// 2. A imagem de prévia existe, é JPEG 1200x630 e leve (WhatsApp ignora imagens grandes)
const img = fs.readFileSync(path.join(ROOT, 'images', 'og-image.jpg'));
check(img[0] === 0xff && img[1] === 0xd8, 'og-image.jpg não é JPEG');
let w = 0, h = 0;
for (let i = 2; i < img.length;) { // lê o marcador SOF do JPEG
  const marker = img[i + 1], len = img.readUInt16BE(i + 2);
  if (marker >= 0xc0 && marker <= 0xc2) { h = img.readUInt16BE(i + 5); w = img.readUInt16BE(i + 7); break; }
  i += 2 + len;
}
check(w === 1200 && h === 630, `og-image.jpg deveria ter 1200x630, tem ${w}x${h}`);
check(img.length < 300 * 1024, `og-image.jpg grande demais (${Math.round(img.length / 1024)} KB)`);

// 3. Script de deploy: grava o endereço publicado em tudo, com ou sem barra final e em subpasta
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-deploy-'));
for (const [input, expected] of [
  ['https://www.dominio-oficial.com.br', 'https://www.dominio-oficial.com.br/'],
  ['https://dominio-oficial.com.br/', 'https://dominio-oficial.com.br/'],
  ['https://outra-conta.github.io/outro-repo', 'https://outra-conta.github.io/outro-repo/'],
]) {
  const file = path.join(tmp, 'index.html');
  fs.copyFileSync(path.join(ROOT, 'index.html'), file);
  execFileSync('node', [SCRIPT, input, file], { stdio: 'pipe' });
  const out = fs.readFileSync(file, 'utf8');
  check(!out.includes(base), `[${input}] ainda contém ${base}`);
  check(meta(out, 'og:url') === expected && canonical(out) === expected && fallback(out) === expected, `[${input}] og:url/canonical/fallback ≠ ${expected}`);
  check(meta(out, 'og:image') === expected + 'images/og-image.jpg', `[${input}] og:image errada: ${meta(out, 'og:image')}`);
  // Rodar de novo com o mesmo endereço não pode duplicar nem estragar nada
  execFileSync('node', [SCRIPT, input, file], { stdio: 'pipe' });
  check(fs.readFileSync(file, 'utf8') === out, `[${input}] rodar duas vezes mudou o arquivo`);
}

// 4. Endereço inválido falha em vez de publicar algo quebrado
for (const bad of ['', 'dominio.com.br', 'ftp://x.com/']) {
  const file = path.join(tmp, 'index.html');
  fs.copyFileSync(path.join(ROOT, 'index.html'), file);
  let failed = false;
  try { execFileSync('node', [SCRIPT, bad, file], { stdio: 'pipe' }); } catch { failed = true; }
  check(failed, `endereço inválido "${bad}" deveria falhar`);
  check(fs.readFileSync(file, 'utf8') === html, `endereço inválido "${bad}" alterou o arquivo`);
}
fs.rmSync(tmp, { recursive: true, force: true });

if (errors.length) { console.error(errors.join('\n')); console.log(`FALHOU: ${errors.length} problema(s)`); process.exit(1); }
console.log('OK — tags de prévia, imagem 1200x630 e script de deploy verificados');

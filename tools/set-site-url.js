// Troca o endereço padrão do site (FALLBACK_SITE_URL do index.html) pelo endereço publicado,
// em todo o arquivo: tags de prévia (og:url, og:image, canonical) e fallback do script.
// Usado no deploy (.github/workflows/pages.yml) com o endereço informado pelo GitHub Pages,
// que já é o domínio próprio quando ele estiver configurado.
// Uso: node tools/set-site-url.js https://meu-dominio.com.br/ caminho/index.html
const fs = require('fs');

const [, , rawUrl, file = 'index.html'] = process.argv;
if (!rawUrl) { console.error('Uso: node tools/set-site-url.js <url> [index.html]'); process.exit(1); }

let url;
try { url = new URL(rawUrl); } catch { console.error(`URL inválida: ${rawUrl}`); process.exit(1); }
if (!/^https?:$/.test(url.protocol)) { console.error(`A URL precisa ser http(s): ${rawUrl}`); process.exit(1); }
const site = url.origin + url.pathname.replace(/\/*$/, '/'); // sempre termina com uma barra

let html = fs.readFileSync(file, 'utf8');
const m = html.match(/var FALLBACK_SITE_URL = "([^"]+)";/);
if (!m) { console.error(`FALLBACK_SITE_URL não encontrado em ${file}`); process.exit(1); }
const current = m[1];

const count = html.split(current).length - 1;
html = html.split(current).join(site);
fs.writeFileSync(file, html);
console.log(`${file}: ${current} → ${site} (${count} ocorrências)`);

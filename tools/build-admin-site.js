#!/usr/bin/env node
// Monta o diretório estático _admin/ para publicar o painel em subdomínio próprio
// (ex.: admin.larissa.zip no Cloudflare Pages), mantendo admin.html como index.html.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_admin');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'admin.html'), path.join(OUT, 'index.html'));
copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));
copyDir(path.join(ROOT, 'images'), path.join(OUT, 'images'));

// Impede indexação do subdomínio administrativo por buscadores
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
fs.writeFileSync(path.join(OUT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n', 'utf8');

console.log('OK — _admin/ gerado para deploy no Cloudflare Pages');

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

// Impede indexação e aplica cabeçalhos de segurança HTTP no subdomínio administrativo
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
const csp = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data: blob:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://*.workers.dev https://api.larissa.zip https://securetoken.googleapis.com",
  "frame-src https://*.firebaseapp.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join('; ');

const headers = [
  '/*',
  '  X-Robots-Tag: noindex, nofollow',
  '  X-Frame-Options: DENY',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
  '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
  `  Content-Security-Policy: ${csp}`,
  ''
].join('\n');
fs.writeFileSync(path.join(OUT, '_headers'), headers, 'utf8');

console.log('OK — _admin/ gerado para deploy no Cloudflare Pages');

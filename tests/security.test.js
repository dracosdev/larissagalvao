// Valida controles de segurança de infraestrutura, regras Firestore, cabeçalhos HTTP,
// isolamento do painel admin, CORS de produção, Service Worker e integridade do HTML.
// Uso: node tests/security.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// 1. firestore.rules: gestão de usuários restrita a super-admins + limites em escrita pública
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const adminUsersBlock = rules.slice(rules.indexOf('match /adminUsers/{email}'), rules.indexOf('match /pushCampaigns/{docId}'));
assert(adminUsersBlock.includes('allow list: if isSuperAdmin();'), 'adminUsers list deve ser exclusivo de super-admin');
assert(adminUsersBlock.includes('allow create, update: if isSuperAdmin()'), 'adminUsers create/update deve ser exclusivo de super-admin');
assert(adminUsersBlock.includes('allow delete: if isSuperAdmin();'), 'adminUsers delete deve ser exclusivo de super-admin');
assert(!adminUsersBlock.includes("hasPerm('users'"), 'adminUsers não deve delegar via hasPerm(users)');

const pushSubBlock = rules.slice(rules.indexOf('match /pushSubscribers/{docId}'));
assert(pushSubBlock.includes('allow create: if isValidPushSubscriberWrite();'), 'pushSubscribers deve permitir apenas create público');
assert(!pushSubBlock.includes('allow create, update: if isValidPushSubscriberWrite()'), 'pushSubscribers não pode permitir update público');
assert(rules.includes('request.resource.data.notes.size() == 0'), 'newsletter create público deve bloquear notes arbitrários');
assert(rules.includes("request.resource.data.url.matches('^https://.*')"), 'pushCampaigns deve exigir URL https://');

// 2. wrangler.toml: produção sem localhost nem dracosdev.github.io em ALLOWED_ORIGINS
const wranglerToml = fs.readFileSync(path.join(ROOT, 'worker', 'wrangler.toml'), 'utf8');
const prodSection = wranglerToml.split('[env.dev.vars]')[0];
assert(!prodSection.includes('localhost'), 'wrangler.toml produção não deve incluir localhost');
assert(!prodSection.includes('127.0.0.1'), 'wrangler.toml produção não deve incluir 127.0.0.1');
assert(!prodSection.includes('dracosdev.github.io'), 'wrangler.toml produção não deve incluir dracosdev.github.io');
assert(prodSection.includes('https://larissa.zip') && prodSection.includes('https://admin.larissa.zip'), 'wrangler.toml deve permitir larissa.zip e admin.larissa.zip');

// 3. pages.yml: admin.html não deve ser publicado junto com o site público + actions pinadas por SHA
const pagesYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
const deploySection = pagesYml.slice(pagesYml.indexOf('deploy:'));
assert(!deploySection.includes('cp index.html admin.html'), 'pages.yml não deve copiar admin.html para o site público');
assert(!/uses:\s+actions\/[a-z-]+@v\d+\s*$/m.test(pagesYml), 'pages.yml deve pinar Actions por commit SHA');

// 4. infra.yml: permissions explícitas, actions pinadas por SHA, npm ci isolado de segredos e lockfile presente
const infraYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'infra.yml'), 'utf8');
assert(infraYml.includes('permissions:\n  contents: read'), 'infra.yml deve declarar permissions: contents: read');
assert(!/uses:\s+actions\/[a-z-]+@v\d+\s*$/m.test(infraYml), 'infra.yml deve pinar Actions por commit SHA');
assert(infraYml.includes('npm ci --no-audit --no-fund'), 'infra.yml deve usar npm ci com lockfile');
assert(fs.existsSync(path.join(ROOT, 'worker', 'package-lock.json')), 'worker/package-lock.json deve existir');

// 5. build-admin-site.js gera _admin/_headers com CSP, anti-clickjacking, HSTS e no-referrer
execFileSync('node', [path.join(ROOT, 'tools', 'build-admin-site.js')], { stdio: 'pipe' });
const adminHeaders = fs.readFileSync(path.join(ROOT, '_admin', '_headers'), 'utf8');
assert(adminHeaders.includes('X-Frame-Options: DENY'), '_admin/_headers sem X-Frame-Options: DENY');
assert(adminHeaders.includes('X-Content-Type-Options: nosniff'), '_admin/_headers sem nosniff');
assert(adminHeaders.includes('Referrer-Policy: no-referrer'), '_admin/_headers sem Referrer-Policy');
assert(adminHeaders.includes('Content-Security-Policy:'), '_admin/_headers sem CSP');
assert(adminHeaders.includes("frame-ancestors 'none'"), '_admin/_headers CSP sem frame-ancestors none');
assert(adminHeaders.includes('Strict-Transport-Security:'), '_admin/_headers sem HSTS');

// 6. index.html e admin.html: estrutura válida e meta tags de segurança
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(indexHtml.includes('http-equiv="Content-Security-Policy"'), 'index.html sem meta CSP');
assert(indexHtml.includes('name="referrer"'), 'index.html sem meta referrer');
assert((indexHtml.match(/<\/html>/gi) || []).length === 1, 'index.html deve ter exatamente uma tag </html>');
assert(/<\/body>\s*<\/html>\s*$/i.test(indexHtml), 'index.html não deve ter conteúdo após </body></html>');

const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
assert(adminHtml.includes('name="referrer" content="no-referrer"'), 'admin.html sem meta referrer no-referrer');

// 7. firebase-messaging-sw.js valida URL antes de clients.openWindow
const swCode = fs.readFileSync(path.join(ROOT, 'firebase-messaging-sw.js'), 'utf8');
assert(swCode.includes('safeNotificationUrl') && swCode.includes('resolved.protocol === "https:"'), 'firebase-messaging-sw.js deve validar protocolo da URL');

console.log('OK — controles de segurança (Firestore rules, Worker CORS, CI/CD, _headers, HTML e SW) validados');

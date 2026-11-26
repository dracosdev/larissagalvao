// Valida utilitários compartilhados do CMS: sanitização XSS, URLs, SVG, RBAC por bloco e CSV.
// Uso: node tests/cms-core.test.js
const assert = require('assert');
const core = require('../assets/cms-core.js');

// 1. Sanitização de Rich Text (XSS)
const dirty = '<p>Olá <strong>mundo</strong> <script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">ruim</a><a href="https://amazon.com.br/dp/B0HSQK58HX" onclick="evil()">bom</a><iframe src="https://evil.com"></iframe></p>';
const clean = core.sanitizeRichText(dirty);
assert(!clean.includes('<script'), 'script não removido');
assert(!clean.includes('onerror'), 'onerror não removido');
assert(!clean.includes('onclick'), 'onclick não removido');
assert(!clean.includes('javascript:'), 'javascript: não removido');
assert(!clean.includes('<iframe'), 'iframe não removido');
assert(clean.includes('<strong>mundo</strong>'), 'tag segura removida');
assert(clean.includes('href="https://amazon.com.br/dp/B0HSQK58HX"'), 'link seguro removido');
assert(clean.includes('rel="noopener noreferrer"'), 'link externo sem rel noopener noreferrer');

// 2. Sanitização de URL e normalização Amazon
assert.strictEqual(core.sanitizeUrl('javascript:alert(1)'), '');
assert.strictEqual(core.sanitizeUrl('  java\nscript:alert(1)'), '');
assert.strictEqual(core.sanitizeUrl('#livros'), '#livros');
assert.strictEqual(core.sanitizeUrl('https://www.amazon.com.br/dp/B0HSQK58HX'), 'https://www.amazon.com.br/dp/B0HSQK58HX');
assert.strictEqual(
  core.normalizeAmazonUrl('https://www.amazon.com.br/gp/product/B0HSQQ27PK'),
  'https://www.amazon.com.br/dp/B0HSQQ27PK'
);

// 3. Sanitização de SVG
const badSvg = '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><foreignObject>x</foreignObject><circle cx="12" cy="12" r="5"/></svg>';
const safeSvg = core.sanitizeSvg(badSvg);
assert(!safeSvg.includes('<script'), 'script em SVG não removido');
assert(!safeSvg.includes('onload'), 'onload em SVG não removido');
assert(!safeSvg.includes('foreignObject'), 'foreignObject em SVG não removido');
assert(safeSvg.includes('<circle'), 'conteúdo válido do SVG removido');
assert.strictEqual(core.sanitizeSvg('<div>não é svg</div>'), '');

// 4. Permissões RBAC por bloco
const reader = { email: 'colab@gmail.com', isSuperAdmin: false, permissions: { books: 'read', hero: 'write', users: 'none' } };
assert.strictEqual(core.canRead(reader, 'books'), true);
assert.strictEqual(core.canWrite(reader, 'books'), false);
assert.strictEqual(core.canRead(reader, 'hero'), true);
assert.strictEqual(core.canWrite(reader, 'hero'), true);
assert.strictEqual(core.canRead(reader, 'users'), false);
assert.strictEqual(core.canWrite(reader, 'users'), false);

const superUser = { email: 'boss@gmail.com', isSuperAdmin: true, permissions: {} };
assert.strictEqual(core.canWrite(superUser, 'users'), true);
assert.strictEqual(core.canWrite({ email: 'boot@gmail.com', permissions: {} }, 'push', ['BOOT@gmail.com']), true);

// 5. CSV export (BOM + proteção contra formula injection) e import
const csv = core.toCsv([
  { email: 'leitora@exemplo.com', name: '=HYPERLINK("http://evil")', status: 'ativo', notes: 'Veio do "Instagram", ok', createdAt: '2026-11-25' }
]);
assert(csv.startsWith('\uFEFFemail,nome,status,observacoes,criado_em'), 'CSV sem BOM ou cabeçalho');
assert(csv.includes("'=HYPERLINK"), 'CSV vulnerável a formula injection');
assert(csv.includes('"Veio do ""Instagram"", ok"'), 'CSV não escapou aspas/vírgula');

const imported = core.parseNewsletterCsv('email;nome;status\nA@teste.com;Ana;ativo\na@teste.com;Duplicado;ativo\ninvalido;X;ativo\nb@teste.com;Bia;inativo');
assert.strictEqual(imported.length, 2);
assert.strictEqual(imported[0].email, 'a@teste.com');
assert.strictEqual(imported[1].status, 'inativo');

console.log('OK — cms-core validado (XSS, URLs, SVG, RBAC e CSV)');

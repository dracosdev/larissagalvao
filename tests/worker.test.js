// Valida o Cloudflare Worker: criptografia JWT real (RS256), CORS, RBAC Firestore,
// validação/upload/exclusão no R2 e inscrição/envio de Web Push via FCM HTTP v1.
// Uso: node tests/worker.test.js
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const authMod = await import(pathToFileURL(path.resolve(__dirname, '../worker/src/auth.js')).href);
  const workerMod = await import(pathToFileURL(path.resolve(__dirname, '../worker/src/index.js')).href);

  // Gera um par de chaves RSA real para testar assinatura e verificação RS256
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  publicJwk.kid = 'test-key-1';
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privPem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(pkcs8).toString('base64') + '\n-----END PRIVATE KEY-----';

  async function signTestJwt(payload, headerOverrides = {}) {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1', ...headerOverrides };
    const h = authMod.uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const p = authMod.uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${authMod.uint8ArrayToBase64Url(new Uint8Array(sig))}`;
  }

  const PROJECT_ID = 'larissa-test-proj';
  const nowSec = Math.floor(Date.now() / 1000);
  const validPayload = {
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: 'uid-123',
    email: 'editor@gmail.com',
    email_verified: true,
    auth_time: nowSec - 60,
    iat: nowSec - 60,
    exp: nowSec + 3600
  };
  const validToken = await signTestJwt(validPayload);
  const expiredToken = await signTestJwt({ ...validPayload, exp: nowSec - 10 });
  const futureAuthToken = await signTestJwt({ ...validPayload, auth_time: nowSec + 600 });
  const unverifiedToken = await signTestJwt({ ...validPayload, email_verified: false });

  // 1. Verificação real do JWT Firebase
  const verified = await authMod.verifyFirebaseIdToken(validToken, PROJECT_ID, { jwks: [publicJwk] });
  assert.strictEqual(verified.email, 'editor@gmail.com');

  await assert.rejects(() => authMod.verifyFirebaseIdToken(expiredToken, PROJECT_ID, { jwks: [publicJwk] }), /expirado/);
  await assert.rejects(() => authMod.verifyFirebaseIdToken(futureAuthToken, PROJECT_ID, { jwks: [publicJwk] }), /auth_time/);
  await assert.rejects(() => authMod.verifyFirebaseIdToken(unverifiedToken, PROJECT_ID, { jwks: [publicJwk] }), /verificado/);
  await assert.rejects(() => authMod.verifyFirebaseIdToken(validToken + 'x', PROJECT_ID, { jwks: [publicJwk] }), /Assinatura/);
  await assert.rejects(() => authMod.verifyFirebaseIdToken('not.valid.jwt', PROJECT_ID, { jwks: [publicJwk] }), /malformado/);

  // 2. Mock de R2, Firestore REST e FCM/OAuth2
  const r2Store = new Map();
  const fcmCalls = [];
  const mockBucket = {
    async put(key, bytes, opts) { r2Store.set(key, { bytes: new Uint8Array(bytes), opts }); },
    async delete(key) { r2Store.delete(key); }
  };

  let userPermissions = { books: 'write', author: 'read', push: 'write' };
  let failUpstream = false;
  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'cache-control': 'max-age=3600' } });
    }
    if (u.includes('firestore.googleapis.com')) {
      const fields = {};
      for (const [k, v] of Object.entries(userPermissions)) fields[k] = { stringValue: v };
      return new Response(JSON.stringify({
        fields: { isSuperAdmin: { booleanValue: false }, permissions: { mapValue: { fields } } }
      }), { status: 200 });
    }
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-oauth-token', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('iid.googleapis.com') || u.includes('fcm.googleapis.com')) {
      if (failUpstream) {
        return new Response(JSON.stringify({ error: { message: 'INTERNAL_SECRET_DETAIL' } }), { status: 500 });
      }
      fcmCalls.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ name: 'projects/larissa-test-proj/messages/msg-999' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  const env = {
    MEDIA_BUCKET: mockBucket,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    R2_PUBLIC_URL: 'https://pub-test.r2.dev',
    ALLOWED_ORIGINS: 'https://larissa.zip,https://admin.larissa.zip',
    BOOTSTRAP_ADMINS: 'super@gmail.com',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fcm@test.iam.gserviceaccount.com', private_key: privPem })
  };

  authMod.resetCaches();
  const worker = workerMod.createWorker({ fetchFn: mockFetch });

  // Health + CORS fail-closed + Security Headers
  const healthRes = await worker.fetch(new Request('https://api.test/health', { headers: { Origin: 'https://larissa.zip' } }), env);
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.headers.get('Access-Control-Allow-Origin'), 'https://larissa.zip');
  assert.strictEqual(healthRes.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.strictEqual(healthRes.headers.get('Cache-Control'), 'no-store');
  assert(healthRes.headers.get('Content-Security-Policy').includes("default-src 'none'"));

  const evilCorsRes = await worker.fetch(new Request('https://api.test/health', { headers: { Origin: 'https://evil.example' } }), env);
  assert.strictEqual(evilCorsRes.headers.get('Access-Control-Allow-Origin'), null, 'CORS deveria falhar fechado para origem não autorizada');

  const emptyCorsRes = await worker.fetch(new Request('https://api.test/health', { headers: { Origin: 'https://evil.example' } }), { ...env, ALLOWED_ORIGINS: '' });
  assert.strictEqual(emptyCorsRes.headers.get('Access-Control-Allow-Origin'), null, 'CORS vazio não pode fazer fallback para *');

  const evilPreflight = await worker.fetch(new Request('https://api.test/upload', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
  assert.strictEqual(evilPreflight.status, 403);

  // Upload sem autenticação rejeitado ANTES de ler formData -> 401 mesmo com corpo não-multipart
  const unauthRawRes = await worker.fetch(new Request('https://api.test/upload', { method: 'POST', body: 'not-multipart' }), env);
  assert.strictEqual(unauthRawRes.status, 401);

  // Upload em bloco somente leitura (author: 'read') -> 403
  const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const fd2 = new FormData();
  fd2.append('block', 'author');
  fd2.append('file', new File([validPng], 'foto.png', { type: 'image/png' }));
  const forbidRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fd2
  }), env);
  assert.strictEqual(forbidRes.status, 403);

  // Upload de tipo não permitido -> 400
  const fdBad = new FormData();
  fdBad.append('block', 'books');
  fdBad.append('file', new File(['alert(1)'], 'evil.html', { type: 'text/html' }));
  const badMimeRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fdBad
  }), env);
  assert.strictEqual(badMimeRes.status, 400);

  // Upload com MIME falsificado (magic bytes não batem com JPEG) -> 400
  const fdFakeJpg = new FormData();
  fdFakeJpg.append('block', 'books');
  fdFakeJpg.append('file', new File(['<html>not a jpeg</html>'], 'fake.jpg', { type: 'image/jpeg' }));
  const fakeJpgRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fdFakeJpg
  }), env);
  assert.strictEqual(fakeJpgRes.status, 400, 'JPEG falsificado deveria ser rejeitado por magic bytes');

  // Upload válido de capa (books: 'write') -> 201 + gravado no R2
  const fdOk = new FormData();
  fdOk.append('block', 'books');
  fdOk.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'Minha Capa.jpg', { type: 'image/jpeg' }));
  const okRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fdOk
  }), env);
  assert.strictEqual(okRes.status, 201);
  const okBody = await okRes.json();
  assert(okBody.url.startsWith('https://pub-test.r2.dev/books/'));
  assert(r2Store.has(okBody.key), 'arquivo não foi gravado no R2');
  assert.strictEqual(r2Store.get(okBody.key).opts.httpMetadata.cacheControl, 'public, max-age=86400');

  // Upload SVG sanitiza vetores avançados antes de salvar no R2 (allowlist)
  const fdSvg = new FormData();
  fdSvg.append('block', 'books');
  fdSvg.append('file', new File([
    '<svg/onload="x()" viewBox="0 0 24 24"><script>bad()</script><style>x{}</style><animate attributeName="href" values="javascript:x"/><a xlink:href="&#106;avascript:x"><path d="M0 0"/></a><circle cx="12" cy="12" r="4"/></svg>'
  ], 'icon.svg', { type: 'image/svg+xml' }));
  const svgRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fdSvg
  }), env);
  assert.strictEqual(svgRes.status, 201);
  const svgBody = await svgRes.json();
  const savedSvg = new TextDecoder().decode(r2Store.get(svgBody.key).bytes);
  assert(!savedSvg.includes('<script') && !savedSvg.includes('onload') && !savedSvg.includes('<style') && !savedSvg.includes('<animate') && !savedSvg.includes('href'), 'SVG salvo com elementos/atributos perigosos');
  assert(savedSvg.includes('<circle'), 'SVG válido perdeu elemento geométrico');

  // Exclusão de mídia: path traversal e '..' bloqueados (400) e exclusão válida (200)
  for (const badKey of ['../secret/file.jpg', 'books/..evil.jpg']) {
    const badDel = await worker.fetch(new Request('https://api.test/media', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: badKey })
    }), env);
    assert.strictEqual(badDel.status, 400, `chave ${badKey} deveria ser bloqueada`);
  }

  const okDel = await worker.fetch(new Request('https://api.test/media', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: okBody.key })
  }), env);
  assert.strictEqual(okDel.status, 200);
  assert(!r2Store.has(okBody.key), 'arquivo não foi removido do R2');

  // Inscrição Web Push (público): exige Origin permitido (403 sem/com origem inválida, 200 com origem válida)
  const subNoOrigin = await worker.fetch(new Request('https://api.test/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fcm_token_example_1234567890abcdef', topic: 'novidades' })
  }), env);
  assert.strictEqual(subNoOrigin.status, 403);

  const subRes = await worker.fetch(new Request('https://api.test/push/subscribe', {
    method: 'POST',
    headers: { Origin: 'https://larissa.zip', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fcm_token_example_1234567890abcdef', topic: 'novidades' })
  }), env);
  assert.strictEqual(subRes.status, 200);
  assert(fcmCalls.some(c => c.url.includes('batchAdd') && c.body.to === '/topics/novidades'));

  // Erro upstream não vaza detalhe interno
  failUpstream = true;
  const subErrRes = await worker.fetch(new Request('https://api.test/push/subscribe', {
    method: 'POST',
    headers: { Origin: 'https://larissa.zip', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fcm_token_example_1234567890abcdef', topic: 'novidades' })
  }), env);
  assert.strictEqual(subErrRes.status, 502);
  const subErrText = await subErrRes.text();
  assert(!subErrText.includes('INTERNAL_SECRET_DETAIL'), 'erro upstream vazou detalhe interno');
  failUpstream = false;

  // Envio Web Push: bloqueia http:// (400) e aceita https:// (200)
  const pushHttpRes = await worker.fetch(new Request('https://api.test/push/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Teste', body: 'Link inseguro', url: 'http://example.com' })
  }), env);
  assert.strictEqual(pushHttpRes.status, 400);

  const pushRes = await worker.fetch(new Request('https://api.test/push/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Lançamento', body: 'Novo livro disponível!', url: 'https://www.amazon.com.br/dp/B0HSQK58HX' })
  }), env);
  assert.strictEqual(pushRes.status, 200);
  const pushData = await pushRes.json();
  assert.strictEqual(pushData.messageId, 'projects/larissa-test-proj/messages/msg-999');

  // Envio Web Push sem permissão -> 403
  userPermissions = { push: 'read' };
  const pushForbid = await worker.fetch(new Request('https://api.test/push/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Teste', body: 'Bloqueado' })
  }), env);
  assert.strictEqual(pushForbid.status, 403);

  console.log('OK — Worker validado (JWT RS256/auth_time, CORS fail-closed, headers, magic bytes, SVG allowlist, R2 e Web Push)');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

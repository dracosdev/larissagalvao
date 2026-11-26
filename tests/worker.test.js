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
    iat: nowSec - 60,
    exp: nowSec + 3600
  };
  const validToken = await signTestJwt(validPayload);
  const expiredToken = await signTestJwt({ ...validPayload, exp: nowSec - 10 });
  const unverifiedToken = await signTestJwt({ ...validPayload, email_verified: false });

  // 1. Verificação real do JWT Firebase
  const verified = await authMod.verifyFirebaseIdToken(validToken, PROJECT_ID, { jwks: [publicJwk] });
  assert.strictEqual(verified.email, 'editor@gmail.com');

  await assert.rejects(() => authMod.verifyFirebaseIdToken(expiredToken, PROJECT_ID, { jwks: [publicJwk] }), /expirado/);
  await assert.rejects(() => authMod.verifyFirebaseIdToken(unverifiedToken, PROJECT_ID, { jwks: [publicJwk] }), /verificado/);
  await assert.rejects(() => authMod.verifyFirebaseIdToken(validToken + 'x', PROJECT_ID, { jwks: [publicJwk] }), /Assinatura/);

  // 2. Mock de R2, Firestore REST e FCM/OAuth2
  const r2Store = new Map();
  const fcmCalls = [];
  const mockBucket = {
    async put(key, bytes, opts) { r2Store.set(key, { bytes: new Uint8Array(bytes), opts }); },
    async delete(key) { r2Store.delete(key); }
  };

  let userPermissions = { books: 'write', author: 'read', push: 'write' };
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
      fcmCalls.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ name: 'projects/larissa-test-proj/messages/msg-999' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  const env = {
    MEDIA_BUCKET: mockBucket,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    R2_PUBLIC_URL: 'https://pub-test.r2.dev',
    ALLOWED_ORIGINS: 'https://dracosdev.github.io,http://localhost:8080',
    BOOTSTRAP_ADMINS: 'super@gmail.com',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fcm@test.iam.gserviceaccount.com', private_key: privPem })
  };

  authMod.resetCaches();
  const worker = workerMod.createWorker({ fetchFn: mockFetch });

  // Health + CORS
  const healthRes = await worker.fetch(new Request('https://api.test/health', { headers: { Origin: 'https://dracosdev.github.io' } }), env);
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.headers.get('Access-Control-Allow-Origin'), 'https://dracosdev.github.io');

  // Upload sem autenticação -> 401
  const fd1 = new FormData();
  fd1.append('block', 'books');
  fd1.append('file', new File([new Uint8Array([1, 2, 3])], 'capa.jpg', { type: 'image/jpeg' }));
  const unauthRes = await worker.fetch(new Request('https://api.test/upload', { method: 'POST', body: fd1 }), env);
  assert.strictEqual(unauthRes.status, 401);

  // Upload em bloco somente leitura (author: 'read') -> 403
  const fd2 = new FormData();
  fd2.append('block', 'author');
  fd2.append('file', new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' }));
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

  // Upload válido de capa (books: 'write') -> 201 + gravado no R2
  const fdOk = new FormData();
  fdOk.append('block', 'books');
  fdOk.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'Minha Capa.jpg', { type: 'image/jpeg' }));
  const okRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fdOk
  }), env);
  assert.strictEqual(okRes.status, 201);
  const okBody = await okRes.json();
  assert(okBody.url.startsWith('https://pub-test.r2.dev/books/'));
  assert(r2Store.has(okBody.key), 'arquivo não foi gravado no R2');

  // Upload SVG sanitiza script antes de salvar no R2
  const fdSvg = new FormData();
  fdSvg.append('block', 'books');
  fdSvg.append('file', new File(['<svg onload="x()"><script>bad()</script><path d="M0 0"/></svg>'], 'icon.svg', { type: 'image/svg+xml' }));
  const svgRes = await worker.fetch(new Request('https://api.test/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${validToken}` },
    body: fdSvg
  }), env);
  assert.strictEqual(svgRes.status, 201);
  const svgBody = await svgRes.json();
  const savedSvg = new TextDecoder().decode(r2Store.get(svgBody.key).bytes);
  assert(!savedSvg.includes('<script') && !savedSvg.includes('onload'), 'SVG salvo sem sanitização');

  // Exclusão de mídia: path traversal bloqueado (400) e exclusão válida (200)
  const badDel = await worker.fetch(new Request('https://api.test/media', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: '../secret/file.jpg' })
  }), env);
  assert.strictEqual(badDel.status, 400);

  const okDel = await worker.fetch(new Request('https://api.test/media', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: okBody.key })
  }), env);
  assert.strictEqual(okDel.status, 200);
  assert(!r2Store.has(okBody.key), 'arquivo não foi removido do R2');

  // Inscrição Web Push (público) -> 200 + chamada batchAdd no FCM
  const subRes = await worker.fetch(new Request('https://api.test/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fcm_token_example_1234567890abcdef', topic: 'novidades' })
  }), env);
  assert.strictEqual(subRes.status, 200);
  assert(fcmCalls.some(c => c.url.includes('batchAdd') && c.body.to === '/topics/novidades'));

  // Envio Web Push autorizado -> 200 + chamada FCM HTTP v1
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

  console.log('OK — Worker validado (JWT RS256, CORS, RBAC, R2 upload/delete e Web Push FCM)');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

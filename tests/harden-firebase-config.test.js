// Valida tools/harden-firebase-config.js: Authorized Domains, restrições da Web API Key
// (referrers incluindo firebaseapp.com + APIs mínimas) e fallback gracioso em HTTP 403.
// Uso: node tests/harden-firebase-config.test.js
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const mod = require('../tools/harden-firebase-config.js');

(async () => {
  // 1. Leitura da config pública
  const pubCfg = mod.loadPublicConfig(path.resolve(__dirname, '..', 'assets', 'config.js'));
  assert(pubCfg.projectId, 'projectId não encontrado em assets/config.js');
  assert(pubCfg.apiKey && pubCfg.apiKey.startsWith('AIza'), 'apiKey não encontrada em assets/config.js');

  // 2. Domínios e Referrers gerados sem localhost nem github.io, preservando firebaseapp.com para OAuth
  const domains = mod.buildAuthorizedDomains('meu-proj');
  assert(domains.includes('larissa.zip') && domains.includes('admin.larissa.zip'));
  assert(domains.includes('meu-proj.firebaseapp.com'));
  assert(!domains.some(d => d.includes('localhost') || d.includes('github.io')), 'domínios de dev não devem entrar em produção');

  const referrers = mod.buildAllowedReferrers('meu-proj');
  assert(referrers.includes('https://larissa.zip/*'));
  assert(referrers.includes('https://www.larissa.zip/*'));
  assert(referrers.includes('https://admin.larissa.zip/*'));
  assert(referrers.includes('https://meu-proj.firebaseapp.com/*'), 'firebaseapp.com/* é obrigatório para login Google popup/redirect');

  // 3. Execução completa com chave RSA real + mock das APIs Google
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const calls = [];
  let force403OnApiKeys = false;

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-sa-token', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('identitytoolkit.googleapis.com/admin/v2/projects/meu-proj/config')) {
      const parsed = JSON.parse(init.body);
      return new Response(JSON.stringify({ authorizedDomains: parsed.authorizedDomains }), { status: 200 });
    }
    if (u.includes('apikeys.googleapis.com/v2/keys:lookupKey')) {
      if (force403OnApiKeys) {
        return new Response(JSON.stringify({ error: { message: 'Permission denied' } }), { status: 403 });
      }
      return new Response(JSON.stringify({ name: 'projects/12345/locations/global/keys/key-abc' }), { status: 200 });
    }
    if (u.includes('apikeys.googleapis.com/v2/projects/12345/locations/global/keys/key-abc')) {
      return new Response(JSON.stringify({ name: 'operations/op-1', done: true }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  const sa = { project_id: 'meu-proj', client_email: 'ci@meu-proj.iam.gserviceaccount.com', private_key: privPem };
  const res = await mod.hardenFirebaseConfig({
    serviceAccountJson: sa,
    projectId: 'meu-proj',
    apiKey: 'AIzaTestKey123456',
    fetchFn: mockFetch
  });

  assert.strictEqual(res.authResult.ok, true);
  assert.strictEqual(res.keyResult.ok, true);
  assert.strictEqual(res.keyResult.keyName, 'projects/12345/locations/global/keys/key-abc');

  const keyPatchCall = calls.find(c => c.method === 'PATCH' && c.url.includes('keys/key-abc'));
  assert(keyPatchCall, 'PATCH de restrições da API Key não foi chamado');
  const patchPayload = JSON.parse(keyPatchCall.body);
  assert(patchPayload.restrictions.browserKeyRestrictions.allowedReferrers.includes('https://admin.larissa.zip/*'));
  assert(patchPayload.restrictions.apiTargets.some(t => t.service === 'firestore.googleapis.com'));
  assert(patchPayload.restrictions.apiTargets.some(t => t.service === 'identitytoolkit.googleapis.com'));

  // 4. Fallback gracioso quando a conta de serviço não tem role API Keys Admin (403)
  force403OnApiKeys = true;
  const res403 = await mod.hardenFirebaseConfig({
    serviceAccountJson: sa,
    projectId: 'meu-proj',
    apiKey: 'AIzaTestKey123456',
    fetchFn: mockFetch
  });
  assert.strictEqual(res403.authResult.ok, true);
  assert.strictEqual(res403.keyResult.ok, false);
  assert.strictEqual(res403.keyResult.skipped, true);
  assert.strictEqual(res403.keyResult.status, 403);

  console.log('OK — harden-firebase-config validado (Authorized Domains, Web API Key restrictions e fallback 403)');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

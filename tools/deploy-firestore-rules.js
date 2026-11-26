#!/usr/bin/env node
// Publica firestore.rules diretamente pela Firebase Security Rules REST API
// usando a conta de serviço padrão do Firebase Admin SDK (sem depender de serviceusage.services.get).
// Uso: FIREBASE_SERVICE_ACCOUNT_JSON='...' node tools/deploy-firestore-rules.js [caminho-rules]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RULES_API_BASE = 'https://firebaserules.googleapis.com/v1';

function toBase64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa, fetchFn = fetch) {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = toBase64Url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform',
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key);
  const assertion = `${unsigned}.${toBase64Url(sig)}`;

  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Falha ao autenticar conta de serviço (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function deployRules({ serviceAccountJson, rulesContent, projectId, fetchFn = fetch }) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const targetProject = projectId || sa.project_id;
  if (!targetProject || !sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON inválido (project_id, client_email ou private_key ausente).');
  }
  if (!rulesContent || !rulesContent.includes('service cloud.firestore')) {
    throw new Error('Arquivo firestore.rules vazio ou inválido.');
  }

  const accessToken = await getAccessToken(sa, fetchFn);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  // 1. Cria novo ruleset (valida sintaxe no servidor do Firebase)
  const createRes = await fetchFn(`${RULES_API_BASE}/projects/${encodeURIComponent(targetProject)}/rulesets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: {
        files: [{ name: 'firestore.rules', content: rulesContent }]
      }
    })
  });
  const ruleset = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !ruleset.name) {
    throw new Error(`Erro ao criar ruleset (${createRes.status}): ${JSON.stringify(ruleset)}`);
  }

  // 2. Atualiza o release cloud.firestore apontando para o novo ruleset
  const releaseName = `projects/${targetProject}/releases/cloud.firestore`;
  const patchRes = await fetchFn(`${RULES_API_BASE}/${releaseName}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      release: {
        name: releaseName,
        rulesetName: ruleset.name
      },
      updateMask: 'rulesetName'
    })
  });
  const release = await patchRes.json().catch(() => ({}));
  if (!patchRes.ok) {
    throw new Error(`Erro ao publicar release cloud.firestore (${patchRes.status}): ${JSON.stringify(release)}`);
  }

  return { projectId: targetProject, rulesetName: ruleset.name, releaseName: release.name || releaseName };
}

if (require.main === module) {
  (async () => {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saJson) {
      console.error('FIREBASE_SERVICE_ACCOUNT_JSON não definido.');
      process.exit(1);
    }
    const rulesPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'firestore.rules'));
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');
    const result = await deployRules({
      serviceAccountJson: saJson,
      rulesContent,
      projectId: process.env.FIREBASE_PROJECT_ID || undefined
    });
    console.log(`OK — firestore.rules publicado em ${result.projectId} (${result.rulesetName})`);
  })().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { deployRules, getAccessToken };

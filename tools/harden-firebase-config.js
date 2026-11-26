#!/usr/bin/env node
// Sincroniza de forma idempotente as configurações de segurança do Firebase/GCP:
// 1) Firebase Auth -> Authorized Domains (mantém apenas domínios de produção)
// 2) GCP Web API Key -> restrições de HTTP Referrers e APIs permitidas
// Reutiliza o mesmo fluxo OAuth2 RS256 de tools/deploy-firestore-rules.js (zero dependências).
// Uso: FIREBASE_SERVICE_ACCOUNT_JSON='...' node tools/harden-firebase-config.js
const fs = require('fs');
const path = require('path');
const { getAccessToken } = require('./deploy-firestore-rules.js');

const IDENTITY_TOOLKIT_BASE = 'https://identitytoolkit.googleapis.com/admin/v2';
const API_KEYS_BASE = 'https://apikeys.googleapis.com/v2';

const DEFAULT_PROD_DOMAINS = [
  'larissa.zip',
  'www.larissa.zip',
  'admin.larissa.zip'
];

const REQUIRED_API_TARGETS = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'fcm.googleapis.com',
  'fcmregistrations.googleapis.com',
  'firebase.googleapis.com'
];

function loadPublicConfig(configPath = path.join(__dirname, '..', 'assets', 'config.js')) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const apiKeyMatch = raw.match(/apiKey:\s*"([^"]+)"/);
  const projectIdMatch = raw.match(/projectId:\s*"([^"]+)"/);
  return {
    apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
    projectId: projectIdMatch ? projectIdMatch[1] : ''
  };
}

function buildAuthorizedDomains(projectId, extraDomains = DEFAULT_PROD_DOMAINS) {
  const set = new Set(extraDomains.map(d => String(d).trim().toLowerCase()).filter(Boolean));
  if (projectId) {
    set.add(`${projectId}.firebaseapp.com`);
    set.add(`${projectId}.web.app`);
  }
  return Array.from(set);
}

function buildAllowedReferrers(projectId, prodDomains = DEFAULT_PROD_DOMAINS) {
  const set = new Set();
  for (const d of prodDomains) {
    const clean = String(d).trim().toLowerCase();
    if (clean) set.add(`https://${clean}/*`);
  }
  if (projectId) {
    // Necessário para o handler OAuth do Firebase Auth (signInWithPopup / signInWithRedirect)
    set.add(`https://${projectId}.firebaseapp.com/*`);
  }
  return Array.from(set);
}

async function syncAuthorizedDomains({ projectId, accessToken, domains, fetchFn = fetch }) {
  const authorizedDomains = domains || buildAuthorizedDomains(projectId);
  const url = `${IDENTITY_TOOLKIT_BASE}/projects/${encodeURIComponent(projectId)}/config?updateMask=authorizedDomains`;
  const res = await fetchFn(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ authorizedDomains })
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 404) {
    return { ok: false, skipped: true, status: res.status, reason: data.error?.message || 'Permissão ausente ou Identity Toolkit API desabilitada.' };
  }
  if (!res.ok) {
    throw new Error(`Erro ao atualizar Authorized Domains (${res.status}): ${JSON.stringify(data)}`);
  }
  return { ok: true, skipped: false, authorizedDomains: data.authorizedDomains || authorizedDomains };
}

async function syncWebApiKeyRestrictions({ projectId, apiKey, accessToken, referrers, apiTargets, fetchFn = fetch }) {
  if (!apiKey) {
    return { ok: false, skipped: true, status: 0, reason: 'Web API Key não informada.' };
  }
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  // 1. Resolve o nome completo do recurso da API Key no GCP
  const lookupRes = await fetchFn(`${API_KEYS_BASE}/keys:lookupKey?keyString=${encodeURIComponent(apiKey)}`, {
    method: 'GET',
    headers
  });
  const lookupData = await lookupRes.json().catch(() => ({}));
  if (lookupRes.status === 403 || lookupRes.status === 404) {
    return {
      ok: false,
      skipped: true,
      status: lookupRes.status,
      reason: lookupData.error?.message || 'Sem permissão API Keys Admin ou apikeys.googleapis.com desabilitada.'
    };
  }
  if (!lookupRes.ok || !lookupData.name) {
    throw new Error(`Erro ao localizar Web API Key (${lookupRes.status}): ${JSON.stringify(lookupData)}`);
  }

  // 2. Aplica restrições de HTTP Referrers e APIs permitidas
  const allowedReferrers = referrers || buildAllowedReferrers(projectId);
  const targets = (apiTargets || REQUIRED_API_TARGETS).map(service => ({ service }));
  const patchRes = await fetchFn(`${API_KEYS_BASE}/${lookupData.name}?updateMask=restrictions`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      restrictions: {
        browserKeyRestrictions: { allowedReferrers },
        apiTargets: targets
      }
    })
  });
  const patchData = await patchRes.json().catch(() => ({}));
  if (patchRes.status === 403) {
    return {
      ok: false,
      skipped: true,
      status: 403,
      reason: patchData.error?.message || 'Sem permissão para editar restrições da API Key.'
    };
  }
  if (!patchRes.ok) {
    throw new Error(`Erro ao restringir Web API Key (${patchRes.status}): ${JSON.stringify(patchData)}`);
  }
  return {
    ok: true,
    skipped: false,
    keyName: lookupData.name,
    allowedReferrers,
    apiTargets: targets.map(t => t.service)
  };
}

async function hardenFirebaseConfig({ serviceAccountJson, projectId, apiKey, fetchFn = fetch }) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const targetProject = projectId || (sa && sa.project_id);
  if (!targetProject || !sa || !sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON inválido (project_id, client_email ou private_key ausente).');
  }
  const accessToken = await getAccessToken(sa, fetchFn);
  const authResult = await syncAuthorizedDomains({ projectId: targetProject, accessToken, fetchFn });
  const keyResult = await syncWebApiKeyRestrictions({ projectId: targetProject, apiKey, accessToken, fetchFn });
  return { projectId: targetProject, authResult, keyResult };
}

if (require.main === module) {
  (async () => {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saJson) {
      console.log('::notice::FIREBASE_SERVICE_ACCOUNT_JSON não definido — pulando hardening automático do Firebase/GCP.');
      process.exit(0);
    }
    const pubCfg = loadPublicConfig();
    const projectId = process.env.FIREBASE_PROJECT_ID || pubCfg.projectId;
    const apiKey = process.env.FIREBASE_WEB_API_KEY || pubCfg.apiKey;
    const { authResult, keyResult } = await hardenFirebaseConfig({
      serviceAccountJson: saJson,
      projectId,
      apiKey
    });

    if (authResult.ok) {
      console.log(`OK — Firebase Auth Authorized Domains sincronizados (${authResult.authorizedDomains.join(', ')})`);
    } else {
      console.log(`::warning::Firebase Auth Authorized Domains não atualizado (HTTP ${authResult.status}): ${authResult.reason}`);
    }

    if (keyResult.ok) {
      console.log(`OK — Restrições da Web API Key aplicadas (${keyResult.keyName})`);
    } else {
      console.log(`::warning::Restrições da Web API Key não aplicadas via CI (HTTP ${keyResult.status}): ${keyResult.reason}. Configure a role "API Keys Admin" ou restrinja manualmente no GCP Console.`);
    }
  })().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  loadPublicConfig,
  buildAuthorizedDomains,
  buildAllowedReferrers,
  syncAuthorizedDomains,
  syncWebApiKeyRestrictions,
  hardenFirebaseConfig,
  REQUIRED_API_TARGETS
};

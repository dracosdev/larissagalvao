// Criptografia Web Crypto (zero dependências): validação de Firebase ID Token (RS256),
// consulta de permissões no Firestore REST e emissão de OAuth2 token para FCM HTTP v1.

const GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml"
]);
const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg"
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

let jwksCache = { keys: null, expiresAt: 0 };
let oauthCache = { token: null, expiresAt: 0, keyId: "" };

export function resetCaches() {
  jwksCache = { keys: null, expiresAt: 0 };
  oauthCache = { token: null, expiresAt: 0, keyId: "" };
}

export function base64UrlToUint8Array(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function uint8ArrayToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeJwtPart(part) {
  const bytes = base64UrlToUint8Array(part);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchJwks(fetchFn, nowMs) {
  if (jwksCache.keys && nowMs < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetchFn(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error("Falha ao obter chaves públicas do Firebase Auth.");
  const data = await res.json();
  const maxAgeMatch = (res.headers.get("cache-control") || "").match(/max-age=(\d+)/);
  const ttlSec = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]), 21600) : 3600;
  jwksCache = { keys: data.keys || [], expiresAt: nowMs + ttlSec * 1000 };
  return jwksCache.keys;
}

export async function verifyFirebaseIdToken(idToken, projectId, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const nowSec = Math.floor((opts.nowMs || Date.now()) / 1000);
  if (!idToken || typeof idToken !== "string") throw new Error("Token ausente.");
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID não configurado.");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("JWT malformado.");

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);

  if (header.alg !== "RS256" || !header.kid) throw new Error("Algoritmo JWT inválido.");
  if (payload.aud !== projectId) throw new Error("Token não pertence a este projeto.");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Emissor do token inválido.");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Subject inválido.");
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new Error("Token expirado.");
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) throw new Error("Token emitido no futuro.");
  if (!payload.email || payload.email_verified !== true) throw new Error("E-mail não verificado.");

  const keys = opts.jwks || await fetchJwks(fetchFn, nowSec * 1000);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Chave pública do token não encontrada.");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToUint8Array(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signingInput);
  if (!valid) throw new Error("Assinatura do token inválida.");

  return {
    uid: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    name: payload.name || ""
  };
}

export async function checkFirestoreWritePermission({ projectId, idToken, email, block, bootstrapAdmins = [], fetchFn = fetch }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (bootstrapAdmins.map(e => e.trim().toLowerCase()).includes(normalized)) {
    return true;
  }
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/adminUsers/${encodeURIComponent(normalized)}`;
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (res.status === 404 || res.status === 403) return false;
  if (!res.ok) throw new Error(`Falha ao consultar permissões no Firestore (${res.status}).`);
  const doc = await res.json();
  const fields = doc.fields || {};
  if (fields.isSuperAdmin && fields.isSuperAdmin.booleanValue === true) return true;
  const perms = fields.permissions && fields.permissions.mapValue && fields.permissions.mapValue.fields;
  if (!perms || !perms[block]) return false;
  return perms[block].stringValue === "write";
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function getGoogleAccessToken(serviceAccountJson, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const nowMs = opts.nowMs || Date.now();
  const sa = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON inválido ou ausente.");
  }
  const cacheKey = `${sa.client_email}:${sa.private_key_id || ""}`;
  if (oauthCache.token && oauthCache.keyId === cacheKey && nowMs < oauthCache.expiresAt - 60000) {
    return oauthCache.token;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const header = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600
  })));
  const input = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const assertion = `${input}.${uint8ArrayToBase64Url(new Uint8Array(sig))}`;

  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao gerar token OAuth2 do Google: ${res.status} ${errText}`);
  }
  const data = await res.json();
  oauthCache = {
    token: data.access_token,
    expiresAt: nowMs + (Number(data.expires_in || 3600) * 1000),
    keyId: cacheKey
  };
  return data.access_token;
}

export function sanitizeSvgBytes(bytes) {
  const raw = new TextDecoder().decode(bytes);
  const cleaned = raw
    .replace(/<\s*(script|foreignObject|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|foreignObject|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
  return new TextEncoder().encode(cleaned);
}

export function validateUpload({ contentType, size }) {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_UPLOAD_MIME.has(mime)) {
    throw new Error(`Tipo de arquivo não permitido (${mime || "desconhecido"}). Use JPG, PNG, WebP, GIF, AVIF ou SVG.`);
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Arquivo vazio.");
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error("Arquivo excede o limite de 5 MB.");
  }
  return { mime, ext: EXT_BY_MIME[mime] };
}

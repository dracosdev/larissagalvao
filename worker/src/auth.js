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

let jwksCache = { keys: null, expiresAt: 0, fetchedAt: 0 };
let oauthCache = { token: null, expiresAt: 0, keyId: "" };

export function resetCaches() {
  jwksCache = { keys: null, expiresAt: 0, fetchedAt: 0 };
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

async function fetchJwks(fetchFn, nowMs, forceRefresh = false) {
  if (!forceRefresh && jwksCache.keys && nowMs < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetchFn(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error("Falha ao obter chaves públicas do Firebase Auth.");
  const data = await res.json();
  const maxAgeMatch = (res.headers.get("cache-control") || "").match(/max-age=(\d+)/);
  const ttlSec = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]), 21600) : 3600;
  jwksCache = { keys: data.keys || [], expiresAt: nowMs + ttlSec * 1000, fetchedAt: nowMs };
  return jwksCache.keys;
}

export async function verifyFirebaseIdToken(idToken, projectId, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const nowMs = opts.nowMs || Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  if (!idToken || typeof idToken !== "string") throw new Error("Token ausente.");
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID não configurado.");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("JWT malformado.");

  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    throw new Error("JWT malformado.");
  }

  if (!header || typeof header !== "object" || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new Error("Algoritmo JWT inválido.");
  }
  if (!payload || typeof payload !== "object") throw new Error("JWT malformado.");
  if (payload.aud !== projectId) throw new Error("Token não pertence a este projeto.");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Emissor do token inválido.");
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) throw new Error("Subject inválido.");
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new Error("Token expirado.");
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) throw new Error("Token emitido no futuro.");
  if (typeof payload.auth_time !== "number" || payload.auth_time > nowSec + 300) throw new Error("auth_time do token inválido.");
  if (!payload.email || payload.email_verified !== true) throw new Error("E-mail não verificado.");

  let keys = opts.jwks || await fetchJwks(fetchFn, nowMs, false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk && !opts.jwks && (nowMs - jwksCache.fetchedAt) > 60_000) {
    keys = await fetchJwks(fetchFn, nowMs, true);
    jwk = keys.find(k => k.kid === header.kid);
  }
  if (!jwk) throw new Error("Chave pública do token não encontrada.");

  let signature;
  try {
    signature = base64UrlToUint8Array(parts[2]);
  } catch {
    throw new Error("Assinatura do token inválida.");
  }

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
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
  if (block === "users") return false;
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
    throw new Error(`Falha ao gerar token OAuth2 do Google (${res.status}).`);
  }
  const data = await res.json();
  oauthCache = {
    token: data.access_token,
    expiresAt: nowMs + (Number(data.expires_in || 3600) * 1000),
    keyId: cacheKey
  };
  return data.access_token;
}

const ALLOWED_SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "title", "desc"
]);

const ALLOWED_SVG_ATTRS = new Set([
  "xmlns", "viewbox", "width", "height",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
  "opacity", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "points", "transform", "offset", "stop-color", "stop-opacity",
  "id", "aria-hidden", "role", "focusable",
  "preserveaspectratio", "gradientunits", "gradienttransform"
]);

const SVG_ATTR_CANONICAL = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform"
};

function escapeXmlAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function isSafeSvgAttrValue(attrLower, rawValue) {
  const val = String(rawValue ?? "").trim();
  if (!val || val.length > 4096) return false;
  const decoded = decodeXmlEntities(val).replace(/[\u0000-\u001F\u007F]+/g, "");
  const compact = decoded.replace(/\s+/g, "").toLowerCase();
  if (/(javascript:|vbscript:|data:|expression\()/i.test(compact)) return false;
  if (attrLower === "xmlns") return decoded === "http://www.w3.org/2000/svg";
  if (compact.includes("url(")) return /^url\(#[-a-z0-9_]+\)$/i.test(compact);
  return true;
}

export function sanitizeSvgBytes(bytes) {
  const raw = new TextDecoder().decode(bytes);
  if (!raw || raw.length > 512 * 1024) {
    throw new Error("SVG vazio ou excede o limite permitido.");
  }
  const cleaned = raw
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();

  if (!/^<svg\b/i.test(cleaned) || !/<\/svg>\s*$/i.test(cleaned)) {
    throw new Error("Arquivo SVG inválido.");
  }

  let blockedDepth = 0;
  const stack = [];
  let out = "";
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>/g;
  let match;
  let lastIndex = 0;

  while ((match = tagRe.exec(cleaned)) !== null) {
    const textChunk = cleaned.slice(lastIndex, match.index);
    lastIndex = tagRe.lastIndex;
    if (blockedDepth === 0 && stack.length && (stack[stack.length - 1] === "title" || stack[stack.length - 1] === "desc")) {
      const trimmed = textChunk.trim();
      if (trimmed) out += escapeXmlAttr(decodeXmlEntities(trimmed));
    }

    const isClose = match[1] === "/";
    const tagLower = match[2].toLowerCase();
    const rawAttrs = match[3] || "";
    const selfClosing = match[4] === "/";

    if (isClose) {
      if (blockedDepth > 0) {
        if (!ALLOWED_SVG_TAGS.has(tagLower)) blockedDepth--;
        continue;
      }
      if (ALLOWED_SVG_TAGS.has(tagLower) && stack.length && stack[stack.length - 1] === tagLower) {
        stack.pop();
        out += `</${tagLower}>`;
      }
      continue;
    }

    if (!ALLOWED_SVG_TAGS.has(tagLower)) {
      if (!selfClosing) blockedDepth++;
      continue;
    }
    if (blockedDepth > 0) continue;
    if (stack.length === 0 && tagLower !== "svg") {
      throw new Error("Arquivo SVG inválido.");
    }

    let safeAttrStr = "";
    let hasXmlns = false;
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`/]+))/g;
    let aMatch;
    while ((aMatch = attrRe.exec(rawAttrs)) !== null) {
      const aLower = aMatch[1].toLowerCase();
      const aVal = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : aMatch[4]);
      if (!ALLOWED_SVG_ATTRS.has(aLower)) continue;
      if (aLower === "xmlns" && stack.length > 0) continue;
      if (!isSafeSvgAttrValue(aLower, aVal)) continue;
      if (aLower === "xmlns") hasXmlns = true;
      const canonical = SVG_ATTR_CANONICAL[aLower] || aLower;
      safeAttrStr += ` ${canonical}="${escapeXmlAttr(decodeXmlEntities(aVal).trim())}"`;
    }
    if (stack.length === 0 && !hasXmlns) {
      safeAttrStr = ' xmlns="http://www.w3.org/2000/svg"' + safeAttrStr;
    }

    out += `<${tagLower}${safeAttrStr}${selfClosing ? "/>" : ">"}`;
    if (!selfClosing) stack.push(tagLower);
  }

  if (stack.length !== 0 || !/^<svg\b/.test(out) || !/<\/svg>$/.test(out)) {
    throw new Error("Arquivo SVG inválido após sanitização.");
  }
  return new TextEncoder().encode(out);
}

function hasMagicBytes(mime, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 3) return false;
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes.byteLength >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mime === "image/gif") {
    if (bytes.byteLength < 6) return false;
    const hdr = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    return hdr === "GIF87a" || hdr === "GIF89a";
  }
  if (mime === "image/webp") {
    if (bytes.byteLength < 12) return false;
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return riff === "RIFF" && webp === "WEBP";
  }
  if (mime === "image/avif") {
    if (bytes.byteLength < 12) return false;
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (ftyp !== "ftyp") return false;
    const brandWindow = new TextDecoder().decode(bytes.subarray(8, Math.min(bytes.byteLength, 32)));
    return /avif|avis|mif1/.test(brandWindow);
  }
  if (mime === "image/svg+xml") {
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 512)));
    return /<svg\b/i.test(head);
  }
  return false;
}

export function validateUploadBytes(mime, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0) {
    throw new Error("Arquivo vazio.");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Arquivo excede o limite de 5 MB.");
  }
  if (!hasMagicBytes(mime, bytes)) {
    throw new Error("Conteúdo do arquivo não corresponde ao tipo de imagem informado.");
  }
  if (mime === "image/svg+xml") {
    return sanitizeSvgBytes(bytes);
  }
  return bytes;
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

// Cloudflare Worker gratuito:
// 1) POST /upload          -> valida Firebase Auth + permissão no Firestore e grava mídia no R2
// 2) DELETE /media         -> valida Firebase Auth + permissão no Firestore e remove mídia do R2
// 3) POST /push/subscribe  -> inscreve token FCM do visitante no tópico público de novidades
// 4) POST /push/send       -> valida Firebase Auth + permissão 'push' e dispara Web Push via FCM HTTP v1

import {
  verifyFirebaseIdToken,
  checkFirestoreWritePermission,
  getGoogleAccessToken,
  validateUpload,
  sanitizeSvgBytes
} from "./auth.js";

const UPLOAD_BLOCKS = new Set(["author", "books", "socialLinks", "themes", "push"]);
const ALLOWED_TOPICS = new Set(["novidades"]);

function parseList(csv) {
  return String(csv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = parseList(env.ALLOWED_ORIGINS);
  const allowOrigin = !allowed.length
    ? "*"
    : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env)
    }
  });
}

function extractBearer(request) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function sanitizeKeySegment(name) {
  return String(name || "arquivo")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "arquivo";
}

function isSafeMediaKey(key) {
  return /^(author|books|socialLinks|themes|push)\/[a-z0-9._-]+$/i.test(String(key || ""));
}

export function createWorker(deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const verifyTokenFn = deps.verifyFirebaseIdToken || verifyFirebaseIdToken;
  const checkPermFn = deps.checkFirestoreWritePermission || checkFirestoreWritePermission;
  const getAccessTokenFn = deps.getGoogleAccessToken || getGoogleAccessToken;

  async function requireBlockWrite(request, env, block) {
    const idToken = extractBearer(request);
    if (!idToken) return { error: "Autenticação obrigatória.", status: 401 };
    let user;
    try {
      user = await verifyTokenFn(idToken, env.FIREBASE_PROJECT_ID, { fetchFn });
    } catch (err) {
      return { error: err.message || "Token inválido.", status: 401 };
    }
    const bootstrapAdmins = parseList(env.BOOTSTRAP_ADMINS);
    let allowed = false;
    try {
      allowed = await checkPermFn({
        projectId: env.FIREBASE_PROJECT_ID,
        idToken,
        email: user.email,
        block,
        bootstrapAdmins,
        fetchFn
      });
    } catch (err) {
      return { error: err.message || "Falha ao verificar permissões.", status: 500 };
    }
    if (!allowed) {
      return { error: `Sem permissão de escrita no bloco "${block}".`, status: 403 };
    }
    return { user, idToken };
  }

  return {
    async fetch(request, env) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "GET" && path === "/health") {
        return jsonResponse({ ok: true, service: "larissagalvao-api" }, 200, request, env);
      }

      // 1. Upload seguro para Cloudflare R2
      if (request.method === "POST" && path === "/upload") {
        if (!env.MEDIA_BUCKET) {
          return jsonResponse({ error: "Binding MEDIA_BUCKET não configurado." }, 500, request, env);
        }
        let form;
        try {
          form = await request.formData();
        } catch {
          return jsonResponse({ error: "Envie os dados como multipart/form-data." }, 400, request, env);
        }
        const block = String(form.get("block") || "").trim();
        if (!UPLOAD_BLOCKS.has(block)) {
          return jsonResponse({ error: "Bloco de destino inválido." }, 400, request, env);
        }
        const authResult = await requireBlockWrite(request, env, block);
        if (authResult.error) {
          return jsonResponse({ error: authResult.error }, authResult.status, request, env);
        }

        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return jsonResponse({ error: "Arquivo não informado." }, 400, request, env);
        }
        let info;
        try {
          info = validateUpload({ contentType: file.type, size: file.size });
        } catch (err) {
          return jsonResponse({ error: err.message }, 400, request, env);
        }

        let bytes = new Uint8Array(await file.arrayBuffer());
        if (info.mime === "image/svg+xml") {
          bytes = sanitizeSvgBytes(bytes);
        }
        const slug = sanitizeKeySegment(file.name);
        const rand = crypto.randomUUID().slice(0, 8);
        const key = `${block}/${Date.now()}-${rand}-${slug}.${info.ext}`;

        await env.MEDIA_BUCKET.put(key, bytes, {
          httpMetadata: {
            contentType: info.mime,
            cacheControl: "public, max-age=31536000, immutable"
          },
          customMetadata: {
            uploadedBy: authResult.user.email,
            block
          }
        });

        const basePublic = String(env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
        return jsonResponse({
          ok: true,
          key,
          url: basePublic ? `${basePublic}/${key}` : key,
          contentType: info.mime,
          size: bytes.byteLength
        }, 201, request, env);
      }

      // 2. Exclusão de mídia no R2
      if (request.method === "DELETE" && path === "/media") {
        if (!env.MEDIA_BUCKET) {
          return jsonResponse({ error: "Binding MEDIA_BUCKET não configurado." }, 500, request, env);
        }
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "JSON inválido." }, 400, request, env);
        }
        const key = String(body.key || "").trim();
        if (!isSafeMediaKey(key)) {
          return jsonResponse({ error: "Chave de arquivo inválida." }, 400, request, env);
        }
        const block = key.split("/")[0];
        const authResult = await requireBlockWrite(request, env, block);
        if (authResult.error) {
          return jsonResponse({ error: authResult.error }, authResult.status, request, env);
        }
        await env.MEDIA_BUCKET.delete(key);
        return jsonResponse({ ok: true, deleted: key }, 200, request, env);
      }

      // 3. Inscrição de token FCM no tópico público (opt-in de Web Push no site)
      if (request.method === "POST" && path === "/push/subscribe") {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "JSON inválido." }, 400, request, env);
        }
        const token = String(body.token || "").trim();
        const topic = String(body.topic || "novidades").trim();
        if (token.length < 20 || token.length > 500 || /\s/.test(token)) {
          return jsonResponse({ error: "Token FCM inválido." }, 400, request, env);
        }
        if (!ALLOWED_TOPICS.has(topic)) {
          return jsonResponse({ error: "Tópico não permitido." }, 400, request, env);
        }
        if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
          return jsonResponse({ error: "FIREBASE_SERVICE_ACCOUNT_JSON não configurado." }, 500, request, env);
        }
        try {
          const accessToken = await getAccessTokenFn(env.FIREBASE_SERVICE_ACCOUNT_JSON, { fetchFn });
          const subRes = await fetchFn("https://iid.googleapis.com/iid/v1:batchAdd", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              access_token_auth: "true",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              to: `/topics/${topic}`,
              registration_tokens: [token]
            })
          });
          if (!subRes.ok) {
            const detail = await subRes.text();
            return jsonResponse({ error: `Falha ao inscrever token no FCM (${subRes.status}): ${detail}` }, 502, request, env);
          }
          return jsonResponse({ ok: true, topic }, 200, request, env);
        } catch (err) {
          return jsonResponse({ error: err.message || "Erro ao inscrever push." }, 500, request, env);
        }
      }

      // 4. Disparo de Web Push autenticado via FCM HTTP v1
      if (request.method === "POST" && path === "/push/send") {
        const authResult = await requireBlockWrite(request, env, "push");
        if (authResult.error) {
          return jsonResponse({ error: authResult.error }, authResult.status, request, env);
        }
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "JSON inválido." }, 400, request, env);
        }
        const title = String(body.title || "").trim();
        const messageBody = String(body.body || "").trim();
        const targetUrl = String(body.url || "").trim();
        const iconUrl = String(body.iconUrl || "").trim();
        const topic = String(body.topic || "novidades").trim();

        if (!title || title.length > 120) {
          return jsonResponse({ error: "Título obrigatório (máximo 120 caracteres)." }, 400, request, env);
        }
        if (!messageBody || messageBody.length > 300) {
          return jsonResponse({ error: "Mensagem obrigatória (máximo 300 caracteres)." }, 400, request, env);
        }
        if (!ALLOWED_TOPICS.has(topic)) {
          return jsonResponse({ error: "Tópico não permitido." }, 400, request, env);
        }
        if (targetUrl && !/^https?:\/\//i.test(targetUrl)) {
          return jsonResponse({ error: "URL de destino deve começar com http:// ou https://." }, 400, request, env);
        }
        if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
          return jsonResponse({ error: "FIREBASE_SERVICE_ACCOUNT_JSON não configurado." }, 500, request, env);
        }

        try {
          const accessToken = await getAccessTokenFn(env.FIREBASE_SERVICE_ACCOUNT_JSON, { fetchFn });
          const fcmPayload = {
            message: {
              topic,
              notification: { title, body: messageBody },
              webpush: {
                notification: {
                  title,
                  body: messageBody,
                  ...(iconUrl && /^https?:\/\//i.test(iconUrl) ? { icon: iconUrl } : {})
                },
                ...(targetUrl ? { fcm_options: { link: targetUrl } } : {})
              },
              data: {
                url: targetUrl || "/"
              }
            }
          };
          const fcmUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`;
          const fcmRes = await fetchFn(fcmUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(fcmPayload)
          });
          const fcmData = await fcmRes.json().catch(() => ({}));
          if (!fcmRes.ok) {
            return jsonResponse({ error: `Erro do FCM (${fcmRes.status}): ${JSON.stringify(fcmData)}` }, 502, request, env);
          }
          return jsonResponse({
            ok: true,
            messageId: fcmData.name || "",
            topic,
            sentBy: authResult.user.email
          }, 200, request, env);
        } catch (err) {
          return jsonResponse({ error: err.message || "Falha ao enviar Web Push." }, 500, request, env);
        }
      }

      return jsonResponse({ error: "Rota não encontrada." }, 404, request, env);
    }
  };
}

export default createWorker();

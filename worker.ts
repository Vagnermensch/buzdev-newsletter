/* =====================================================================
   Gizmos (Cloudflare Worker) backend for the Newsletter Builder.
   Static files (index.html, app.css, app.js, templates/) are served by the
   platform; this worker handles /api/* only.

   Same security model as the Node server:
     • POST /api/send requires a valid OIDC bearer token (RS256, verified
       against the IdP JWKS via Web Crypto: signature + issuer + audience +
       expiry) AND a @telusdigital.com claim. Fails CLOSED.
     • Per-user rate limiting (KV binding).
     • Generic errors to callers; details only in logs.
     • No CORS allow-origin header → cross-origin reads are blocked by the
       browser (the SPA is same-origin).
     • Sends via Microsoft Graph (sendMail) FROM the locked address; the
       recipient list is BCC'd.
   ===================================================================== */

const FROM = "DesignBusinessAcumen@telusdigital.com"; // locked sender
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_MAX = 5;          // sends per window per user
const RATE_WINDOW = 60;      // seconds

interface Env {
  RATE_LIMIT: KVNamespace;            // [[kv_namespaces]] binding = "RATE_LIMIT"
  OIDC_ISSUER: string;                // e.g. https://login.microsoftonline.com/<tenant>/v2.0
  OIDC_AUDIENCE: string;              // the API's app/client id
  OIDC_JWKS_URI?: string;             // optional override
  ALLOWED_EMAIL_DOMAIN?: string;      // default telusdigital.com
  GRAPH_TENANT_ID: string;            // Azure tenant for the send app
  GRAPH_CLIENT_ID: string;            // app registration with Mail.Send
  GRAPH_CLIENT_SECRET: string;        // SECRET — provide via Gizmos, not in vars
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 }); // no ACAO → cross-origin stays blocked

    if (url.pathname === "/api/health") return json({ ok: true });

    if (url.pathname === "/api/send" && req.method === "POST") {
      // --- authn/authz ---
      let user: { sub: string; email: string };
      try {
        user = await authorize(req, env);
      } catch (e) {
        const code = (e as any)?.code === 403 ? 403 : (e as any)?.code === 503 ? 503 : 401;
        return json({ error: code === 403 ? "Forbidden" : code === 503 ? "Service unavailable" : "Unauthorized" }, code);
      }

      // --- rate limit (per user) ---
      if (!(await allow(env, user.sub))) return json({ error: "Too many requests — please wait a minute" }, 429);

      // --- validate ---
      let payload: any;
      try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const list = Array.isArray(payload?.to) ? payload.to : String(payload?.to || "").split(/[,\s]+/);
      const recipients = list.map((s: string) => s.trim()).filter(Boolean);
      const subject = String(payload?.subject || "");
      const html = String(payload?.html || "");
      if (!recipients.length) return json({ error: "No recipients" }, 400);
      if (recipients.some((a: string) => !EMAIL_RE.test(a))) return json({ error: "One or more recipient addresses are invalid" }, 400);
      if (!subject || !html) return json({ error: "Missing subject or content" }, 400);

      // --- send via Microsoft Graph ---
      try {
        await sendViaGraph(env, { subject, html, bcc: recipients });
        console.log(`send ok: user=${user.email} count=${recipients.length}`);
        return json({ ok: true, count: recipients.length });
      } catch (err) {
        console.error("send error:", err); // detail stays server-side
        return json({ error: "Send failed, please try again" }, 502);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

/* ---------------------------- auth ----------------------------------- */
async function authorize(req: Request, env: Env): Promise<{ sub: string; email: string }> {
  if (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE) throw { code: 503 };
  const hdr = req.headers.get("authorization") || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : req.headers.get("x-forwarded-access-token") || "";
  if (!token) throw { code: 401 };

  const claims = await verifyJwt(token, env); // throws on any failure
  const domain = (env.ALLOWED_EMAIL_DOMAIN || "telusdigital.com").toLowerCase();
  const email = String(claims.email || claims.preferred_username || claims.upn || "").toLowerCase();
  if (domain && !email.endsWith(`@${domain}`)) throw { code: 403 };
  return { sub: String(claims.sub || email), email };
}

// JWKS cache (isolates are reused between requests)
let _jwks: { keys: any[]; at: number } | null = null;
let _disco: { uri: string; at: number } | null = null;
const HOUR = 3600_000;

async function jwksUri(env: Env): Promise<string> {
  if (env.OIDC_JWKS_URI) return env.OIDC_JWKS_URI;
  if (_disco && Date.now() - _disco.at < HOUR) return _disco.uri;
  const r = await fetch(env.OIDC_ISSUER.replace(/\/$/, "") + "/.well-known/openid-configuration");
  if (!r.ok) throw new Error("discovery " + r.status);
  const uri = (await r.json() as any).jwks_uri;
  _disco = { uri, at: Date.now() };
  return uri;
}
async function getKeys(env: Env): Promise<any[]> {
  if (_jwks && Date.now() - _jwks.at < HOUR) return _jwks.keys;
  const r = await fetch(await jwksUri(env));
  if (!r.ok) throw new Error("jwks " + r.status);
  const keys = (await r.json() as any).keys || [];
  _jwks = { keys, at: Date.now() };
  return keys;
}

function b64urlBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlStr = (s: string) => new TextDecoder().decode(b64urlBytes(s));

async function verifyJwt(token: string, env: Env): Promise<any> {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) throw new Error("malformed");
  const header = JSON.parse(b64urlStr(h));
  const claims = JSON.parse(b64urlStr(p));
  if (header.alg !== "RS256") throw new Error("alg");

  const jwk = (await getKeys(env)).find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("bad signature");

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && now >= claims.exp) throw new Error("expired");
  if (claims.nbf && now < claims.nbf - 60) throw new Error("nbf");
  if (env.OIDC_ISSUER && claims.iss !== env.OIDC_ISSUER) throw new Error("iss");
  const aud = ([] as string[]).concat(claims.aud || []);
  if (env.OIDC_AUDIENCE && !aud.includes(env.OIDC_AUDIENCE)) throw new Error("aud");
  return claims;
}

/* ------------------------- rate limit (KV) --------------------------- */
async function allow(env: Env, userKey: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW);
  const k = `rl:${userKey}:${bucket}`;
  const cur = parseInt((await env.RATE_LIMIT.get(k)) || "0", 10);
  if (cur >= RATE_MAX) return false;
  await env.RATE_LIMIT.put(k, String(cur + 1), { expirationTtl: RATE_WINDOW * 2 });
  return true;
}

/* --------------------- send via Microsoft Graph ---------------------- */
async function graphToken(env: Env): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.GRAPH_CLIENT_ID,
    client_secret: env.GRAPH_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error("graph token " + r.status);
  return (await r.json() as any).access_token;
}

async function sendViaGraph(env: Env, m: { subject: string; html: string; bcc: string[] }): Promise<void> {
  const token = await graphToken(env);
  const message = {
    message: {
      subject: m.subject,
      body: { contentType: "HTML", content: m.html },
      toRecipients: [{ emailAddress: { address: FROM } }], // visible To = the brand mailbox
      bccRecipients: m.bcc.map(a => ({ emailAddress: { address: a } })), // recipients hidden
    },
    saveToSentItems: true,
  };
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FROM)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (r.status !== 202) throw new Error("graph sendMail " + r.status + " " + (await r.text()));
}

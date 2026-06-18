/* =====================================================================
   POST /api/send — Netlify Function. Sends mail AS your own Google account
   via the Gmail API (HTTPS), the same approach as server/send-server.js but
   packaged as a serverless function (Netlify runs no persistent server).

   Unauthenticated (public site), protected by recipient validation, a count
   cap, and a best-effort per-IP rate limit (in-memory; resets on cold start).

   Env (set with `netlify env:set` or in the Netlify dashboard):
     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN  (SECRET)
     MAIL_FROM        sending address (your authorized Google account)
     MAIL_FROM_NAME   display name (default "Newsletter")
     RATE_MAX, RATE_WINDOW_SEC, MAX_RECIPIENTS  (optional)
   ===================================================================== */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
const MAIL_FROM = process.env.MAIL_FROM || "";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Newsletter";
const RATE_MAX = parseInt(process.env.RATE_MAX || "5", 10);
const RATE_WINDOW_SEC = parseInt(process.env.RATE_WINDOW_SEC || "60", 10);
const MAX_RECIPIENTS = parseInt(process.env.MAX_RECIPIENTS || "50", 10);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const configured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN);

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(obj),
});

// Best-effort per-IP limit. Serverless instances are short-lived, so this only
// throttles bursts that hit the same warm instance — good enough to blunt abuse.
const hits = new Map();
function allow(ip) {
  const now = Date.now();
  const windowMs = RATE_WINDOW_SEC * 1000;
  const rec = hits.get(ip);
  if (!rec || now - rec.start > windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return true;
  }
  if (rec.count >= RATE_MAX) return false;
  rec.count++;
  return true;
}

async function getAccessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`oauth token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

function buildRawMessage({ from, to, bcc, replyTo, subject, html }) {
  const headers = [`From: ${from}`, `To: ${to}`];
  if (bcc && bcc.length) headers.push(`Bcc: ${bcc.join(", ")}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/html; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: base64");
  const body = Buffer.from(html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const mime = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendViaGmail({ recipients, subject, html, replyTo }) {
  const accessToken = await getAccessToken();
  const raw = buildRawMessage({
    from: MAIL_FROM ? `${MAIL_FROM_NAME} <${MAIL_FROM}>` : MAIL_FROM_NAME,
    to: MAIL_FROM || "me",
    bcc: recipients,
    replyTo,
    subject,
    html,
  });
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`gmail send ${r.status}: ${await r.text()}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!configured) return json(503, { error: "Email service not configured" });

  const ip =
    event.headers["x-nf-client-connection-ip"] ||
    (event.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown";
  if (!allow(ip)) return json(429, { error: "Too many requests — please wait a minute and try again" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const rawList = Array.isArray(body.to) ? body.to : String(body.to || "").split(/[,\s]+/);
  const recipients = rawList.map((s) => String(s).trim()).filter(Boolean);
  const subject = String(body.subject || "").trim();
  const html = String(body.html || "");
  const replyTo = EMAIL_RE.test(String(body.replyTo || "").trim()) ? String(body.replyTo).trim() : undefined;

  if (!recipients.length) return json(400, { error: "No recipients" });
  if (recipients.length > MAX_RECIPIENTS) return json(400, { error: `Too many recipients (max ${MAX_RECIPIENTS})` });
  if (recipients.some((a) => !EMAIL_RE.test(a)))
    return json(400, { error: "One or more recipient addresses are invalid" });
  if (!subject || !html) return json(400, { error: "Missing subject or content" });

  try {
    await sendViaGmail({ recipients, subject, html, replyTo });
    console.log(`send ok: count=${recipients.length}`);
    return json(200, { ok: true, count: recipients.length });
  } catch (err) {
    console.error("send error:", err && err.message ? err.message : err);
    return json(502, { error: "Send failed, please try again" });
  }
};

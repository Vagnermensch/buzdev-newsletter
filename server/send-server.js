/* =====================================================================
   Node send-server for the Newsletter Builder (Railway / Render / Docker).

   Serves the static front-end (index.html, app.css, app.js) and exposes:
     • GET  /api/health  → { ok: true }
     • POST /api/send    → sends mail AS your own Google account via the
                           Gmail API (HTTPS) — no third-party email service,
                           no SMTP (which PaaS hosts block).

   How it sends as you: a one-time OAuth authorization produces a refresh
   token. The server exchanges it for a short-lived access token over HTTPS,
   then calls the Gmail API users.messages.send. Mail comes from your real
   Google address, so it's fully authenticated (good deliverability).

   Unauthenticated endpoint (public website), protected by:
     • per-IP rate limiting
     • recipient count cap + address validation
     • a request body size limit

   Required env (set in the host dashboard / CLI, NOT in the repo):
     GOOGLE_CLIENT_ID      OAuth client id      (Google Cloud → Credentials)
     GOOGLE_CLIENT_SECRET  OAuth client secret  (SECRET)
     GOOGLE_REFRESH_TOKEN  refresh token for your account (SECRET)
   Optional env:
     MAIL_FROM        the sending address; must be your authorized Google
                      account or one of its verified send-as aliases.
     MAIL_FROM_NAME   display name on the From header   (default "Newsletter")
     PORT             injected by the host              (default 3000)
     RATE_MAX         sends per window per IP            (default 5)
     RATE_WINDOW_SEC  rate-limit window in seconds       (default 60)
     MAX_RECIPIENTS   max addresses per send             (default 50)
   ===================================================================== */

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const PORT = parseInt(process.env.PORT || "3000", 10);
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
if (!configured) {
  console.warn(
    "[send-server] GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not all set — /api/send returns 503 until configured."
  );
}

/* ---- Gmail API helpers (all HTTPS) --------------------------------- */

// Exchange the refresh token for a short-lived access token.
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

// RFC 2047 encoded-word so non-ASCII subjects (accents, emoji) survive.
const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

// Build a raw RFC 822 message, base64url-encoded for the Gmail API.
function buildRawMessage({ from, to, bcc, replyTo, subject, html }) {
  const headers = [`From: ${from}`, `To: ${to}`];
  if (bcc && bcc.length) headers.push(`Bcc: ${bcc.join(", ")}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/html; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: base64");
  // base64 body, wrapped at 76 chars per RFC 2045.
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
  const fromAddr = MAIL_FROM || undefined; // Gmail uses the authed account if omitted
  const raw = buildRawMessage({
    from: fromAddr ? `${MAIL_FROM_NAME} <${fromAddr}>` : MAIL_FROM_NAME,
    to: fromAddr || "me", // visible To = sender; real recipients are Bcc'd
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

/* ---- HTTP server --------------------------------------------------- */

const app = express();
app.set("trust proxy", 1); // hosts run behind a proxy; needed for real client IP
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const sendLimiter = rateLimit({
  windowMs: RATE_WINDOW_SEC * 1000,
  max: RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a minute and try again" },
});

app.post("/api/send", sendLimiter, async (req, res) => {
  if (!configured) return res.status(503).json({ error: "Email service not configured" });

  const body = req.body || {};
  const rawList = Array.isArray(body.to) ? body.to : String(body.to || "").split(/[,\s]+/);
  const recipients = rawList.map((s) => String(s).trim()).filter(Boolean);
  const subject = String(body.subject || "").trim();
  const html = String(body.html || "");
  const replyTo = EMAIL_RE.test(String(body.replyTo || "").trim())
    ? String(body.replyTo).trim()
    : undefined;

  if (!recipients.length) return res.status(400).json({ error: "No recipients" });
  if (recipients.length > MAX_RECIPIENTS)
    return res.status(400).json({ error: `Too many recipients (max ${MAX_RECIPIENTS})` });
  if (recipients.some((a) => !EMAIL_RE.test(a)))
    return res.status(400).json({ error: "One or more recipient addresses are invalid" });
  if (!subject || !html) return res.status(400).json({ error: "Missing subject or content" });

  try {
    await sendViaGmail({ recipients, subject, html, replyTo });
    console.log(`send ok: count=${recipients.length}`);
    return res.json({ ok: true, count: recipients.length });
  } catch (err) {
    console.error("send error:", err && err.message ? err.message : err); // detail stays server-side
    return res.status(502).json({ error: "Send failed, please try again" });
  }
});

app.listen(PORT, () => {
  console.log(`[send-server] listening on :${PORT} (mail ${configured ? "configured" : "NOT configured"})`);
});

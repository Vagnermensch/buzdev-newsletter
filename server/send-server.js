/* =====================================================================
   Node send-server for the Newsletter Builder (Render.com / Docker).

   Serves the static front-end (index.html, app.css, app.js) and exposes:
     • GET  /api/health  → { ok: true }
     • POST /api/send    → sends mail via Gmail SMTP (nodemailer)

   This is an UNAUTHENTICATED endpoint by design (public website). To keep
   it from becoming an open spam relay — which would also get your Gmail
   account suspended — it enforces:
     • per-IP rate limiting
     • recipient count cap + address validation
     • a request body size limit
   Recipients are BCC'd so they never see each other's addresses.

   Required env (set these in the Render dashboard, NOT in the repo):
     GMAIL_USER          your full Gmail address (also the From / authenticated user)
     GMAIL_APP_PASSWORD  a 16-char Gmail "App password" (Google account → Security →
                         2-Step Verification → App passwords). NOT your login password.
   Optional env:
     MAIL_FROM_NAME      display name on the From header   (default "Newsletter")
     PORT                injected by Render                (default 3000)
     RATE_MAX            sends per window per IP            (default 5)
     RATE_WINDOW_SEC     rate-limit window in seconds       (default 60)
     MAX_RECIPIENTS      max addresses per send             (default 50)
   ===================================================================== */

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const PORT = parseInt(process.env.PORT || "3000", 10);
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Newsletter";
const RATE_MAX = parseInt(process.env.RATE_MAX || "5", 10);
const RATE_WINDOW_SEC = parseInt(process.env.RATE_WINDOW_SEC || "60", 10);
const MAX_RECIPIENTS = parseInt(process.env.MAX_RECIPIENTS || "50", 10);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const configured = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
if (!configured) {
  console.warn(
    "[send-server] GMAIL_USER / GMAIL_APP_PASSWORD not set — /api/send will return 503 until configured."
  );
}

// One reusable SMTP transport. Gmail forces the From to the authenticated user.
const transporter = configured
  ? nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // TLS
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  : null;

const app = express();
// Render runs behind a proxy; trust it so rate-limit sees the real client IP.
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

// Static front-end lives one level up (repo root).
app.use(express.static(path.join(__dirname, "..")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Per-IP rate limit on the send route only.
const sendLimiter = rateLimit({
  windowMs: RATE_WINDOW_SEC * 1000,
  max: RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a minute and try again" },
});

app.post("/api/send", sendLimiter, async (req, res) => {
  if (!configured || !transporter) {
    return res.status(503).json({ error: "Email service not configured" });
  }

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
    await transporter.sendMail({
      from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`, // Gmail locks From to the authed user
      to: GMAIL_USER, // visible To = sender; real recipients are BCC'd
      bcc: recipients,
      replyTo,
      subject,
      html,
    });
    console.log(`send ok: count=${recipients.length}`);
    return res.json({ ok: true, count: recipients.length });
  } catch (err) {
    console.error("send error:", err && err.message ? err.message : err);
    return res.status(502).json({ error: "Send failed, please try again" });
  }
});

app.listen(PORT, () => {
  console.log(`[send-server] listening on :${PORT} (mail ${configured ? "configured" : "NOT configured"})`);
});

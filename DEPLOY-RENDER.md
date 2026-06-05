# Deploying to Render.com (Node + Gmail SMTP)

This path runs the Express server in `server/send-server.js`, which serves the
static front-end **and** sends mail through **Gmail SMTP** via nodemailer. Use
this instead of Gizmos/Cloudflare Workers — Workers can't open SMTP sockets.

The `/api/send` endpoint is **unauthenticated** (public site) but protected by
per-IP rate limiting, recipient validation, and a body-size cap.

## 1. Create a Gmail App Password (one-time)

App passwords require **2-Step Verification** to be ON.

1. Google Account → **Security** → turn on **2-Step Verification** (if not already).
2. Security → **App passwords** → create one (name it e.g. "newsletter").
3. Copy the **16-character** password (no spaces). This is `GMAIL_APP_PASSWORD`.

> Your normal Gmail login password will NOT work for SMTP — it must be an app password.

## 2. Deploy on Render

**Option A — Blueprint (uses `render.yaml`, recommended):**
1. Push this repo to GitHub.
2. Render dashboard → **New +** → **Blueprint** → pick the repo.
3. Render reads `render.yaml`, creates the web service, and prompts for the two
   secrets. Enter:
   - `GMAIL_USER` = your full Gmail address
   - `GMAIL_APP_PASSWORD` = the 16-char app password from step 1
4. **Create** → wait for the first deploy.

**Option B — Manual web service:**
1. New + → **Web Service** → connect the repo.
2. Build command: `npm install --omit=dev`  •  Start command: `npm start`
3. Health check path: `/api/health`
4. Add env vars `GMAIL_USER` and `GMAIL_APP_PASSWORD` (and optionally
   `MAIL_FROM_NAME`, `RATE_MAX`, `RATE_WINDOW_SEC`, `MAX_RECIPIENTS`).

## 3. Verify after deploy

```bash
curl https://<your-service>.onrender.com/api/health        # → {"ok":true}
# A valid send (fill in your own address):
curl -X POST https://<your-service>.onrender.com/api/send \
  -H 'content-type: application/json' \
  -d '{"to":["you@example.com"],"subject":"Test","html":"<p>It works</p>"}'
# → {"ok":true,"count":1}
```

Then open the site and use the Send dialog.

## Local development

```bash
cp .env.example .env     # fill in GMAIL_USER + GMAIL_APP_PASSWORD
npm install
npm run dev              # http://localhost:3000
```

## Notes & limits

- **Gmail sending limits:** a personal Gmail account allows ~500 recipients/day.
  Exceeding this gets sending throttled or the account temporarily locked. For
  real volume, use a transactional provider (Resend/SendGrid/Mailgun).
- **From address is locked to `GMAIL_USER`** — Gmail rewrites it to the
  authenticated account regardless of what the front-end shows in the dialog.
- Recipients are **BCC'd**; the visible `To` is your own address.
- Render's **free plan sleeps** after inactivity, so the first request after idle
  can take ~30s to wake the service.

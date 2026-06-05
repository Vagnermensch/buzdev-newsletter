# Deploying to Gizmos (Cloudflare Workers)

Gizmos serves the static front-end and runs `worker.ts` for `/api/*`. You deploy a
**zip** containing the front-end + `worker.ts` + `wrangler.toml`.

## What's in the deploy zip (root level)

```
index.html        app.css        app.js        # front-end (served by Gizmos)
worker.ts                                       # API: /api/send, /api/health
wrangler.toml                                   # bindings + config
```

The Node `server/` folder, `package.json`, and `node_modules` are **not** part of the
Gizmos deploy (that path is only for running outside Cloudflare). Build the zip with:

```bash
./scripts/build-gizmos-zip.sh        # → dist/newsletter-builder-gizmos.zip
```

Then drop the zip on the Gizmos **Deploy** page.

## Bindings & config (`wrangler.toml`)

- `[[kv_namespaces]] binding = "RATE_LIMIT"` — auto-provisioned; backs per-user send limits.
- `[vars]` — fill in before deploying:
  - `OIDC_ISSUER`, `OIDC_AUDIENCE` — validate the caller's TELUS token (fail-closed).
  - `ALLOWED_EMAIL_DOMAIN` — `telusdigital.com`.
  - `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` — the send app registration.
- `GRAPH_CLIENT_SECRET` — **secret**, never in `[vars]`. Provide via Gizmos' secret /
  API-key binding so it arrives as `env.GRAPH_CLIENT_SECRET`.

## Azure prerequisites (sending as the mailbox)

The worker sends through **Microsoft Graph** as `DesignBusinessAcumen@telusdigital.com`:

1. An **app registration** (client id + secret) with the **`Mail.Send` application
   permission** (admin-consented).
2. Restrict it to the one mailbox (recommended) via an Exchange **application access
   policy** so the app can only send as Business Acumen.
3. Token endpoint used: `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`
   (client-credentials, `.default` scope) — all HTTPS, no SMTP.

> Prefer SendGrid/Mailgun instead? Swap `sendViaGraph()` for one HTTPS call to that
> provider and store its key as the secret. Keep `FROM` locked.

## How the caller is authorized

`POST /api/send` requires `Authorization: Bearer <OIDC token>`. The front end attaches
it via `window.getAccessToken()` — wire that to how Gizmos exposes the OIDC token to the
SPA (MSAL `acquireTokenSilent`, or a token the proxy provides). The worker verifies the
token's signature (JWKS), issuer, audience, expiry, and `@telusdigital.com` claim, and
**fails closed** if OIDC isn't configured. A direct hit to the worker without a valid
token gets `401`.

## Verify after deploy

```bash
curl https://<your-app>.<gizmos-domain>/api/health        # → {"ok":true}
curl -X POST https://<your-app>.<gizmos-domain>/api/send   # → 401 (no token)
```
Then sign into the UI and send a test to your own address.

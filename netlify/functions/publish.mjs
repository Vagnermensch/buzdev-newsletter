// POST /api/publish — save the current newsletter as the SITE-WIDE DEFAULT:
// what everyone sees when they open the site with no share link. Stored under a
// fixed key in the same Netlify Blobs store the share links use, so the client
// can read it back via /api/load?id=site-default. Note: like /api/save and
// /api/send, this endpoint is unauthenticated — anyone who can reach it can
// replace the published default. Fine for an internal tool; add a token/env
// guard here if that ever needs locking down.
import { getStore } from "@netlify/blobs";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const DEFAULT_KEY = "site-default";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  if (!body || !Array.isArray(body.blocks) || typeof body.settings !== "object") {
    return json(400, { error: "not a newsletter" });
  }

  const publishedAt = new Date().toISOString();
  // Stamp publishedAt into the payload so the loader can decide whether a
  // reader's own newer local draft should win over the published version.
  const payload = JSON.stringify({ settings: body.settings, blocks: body.blocks, publishedAt });
  // ~4MB cap — generous for embedded images, blunts abuse
  if (payload.length > 4_000_000) return json(413, { error: "newsletter too large" });

  const store = getStore("newsletters");
  await store.set(DEFAULT_KEY, payload, { metadata: { publishedAt } });
  return json(200, { ok: true, publishedAt });
};

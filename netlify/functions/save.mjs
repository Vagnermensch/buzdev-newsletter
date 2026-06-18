// POST /api/save — store a newsletter and return a short id.
// Persists to Netlify Blobs (no external DB). Used by the "Share link" button
// so links stay short even when the newsletter embeds uploaded images.
import { getStore } from "@netlify/blobs";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// url-safe random id (~12 chars)
function genId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  if (!body || !Array.isArray(body.blocks) || typeof body.settings !== "object") {
    return json(400, { error: "not a newsletter" });
  }

  const payload = JSON.stringify(body);
  // ~4MB cap — generous for embedded images, blunts abuse
  if (payload.length > 4_000_000) return json(413, { error: "newsletter too large" });

  const store = getStore("newsletters");
  const id = genId();
  await store.set(id, payload, { metadata: { savedAt: new Date().toISOString() } });
  return json(200, { id });
};

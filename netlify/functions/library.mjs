// /api/library — shared library of named newsletters (Netlify Blobs).
//   GET              → [{ id, name, savedAt }] newest first
//   GET  ?id=…       → the stored newsletter JSON
//   POST {id?, name, newsletter} → create (no id) or overwrite (id); returns { id, name, savedAt }
//   DELETE ?id=…     → remove
// Like the other endpoints this is unauthenticated: anyone with the site URL
// can list, open, overwrite and delete. Fine for an internal tool.
import { getStore } from "@netlify/blobs";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const ID_RE = /^[\w-]{1,64}$/;

function genId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async (req) => {
  // Strong consistency: a save in one browser must show up in another's list immediately.
  const store = getStore({ name: "library", consistency: "strong" });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    if (id) {
      if (!ID_RE.test(id)) return json(400, { error: "bad id" });
      const data = await store.get(id, { type: "text" });
      if (data == null) return json(404, { error: "not found" });
      return new Response(data, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.map(async ({ key }) => {
      const m = await store.getMetadata(key);
      return m ? { id: key, name: m.metadata?.name || "Untitled", savedAt: m.metadata?.savedAt || "" } : null;
    }));
    return json(200, items.filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
    const nl = body?.newsletter;
    if (!nl || !Array.isArray(nl.blocks) || typeof nl.settings !== "object") return json(400, { error: "not a newsletter" });
    if (body.id != null && !ID_RE.test(body.id)) return json(400, { error: "bad id" });
    const name = String(body.name || "").trim().slice(0, 120) || "Untitled";
    const payload = JSON.stringify({ settings: nl.settings, blocks: nl.blocks });
    if (payload.length > 4_000_000) return json(413, { error: "newsletter too large" });
    const key = body.id || genId();
    const savedAt = new Date().toISOString();
    await store.set(key, payload, { metadata: { name, savedAt } });
    return json(200, { id: key, name, savedAt });
  }

  if (req.method === "DELETE") {
    if (!id || !ID_RE.test(id)) return json(400, { error: "bad id" });
    await store.delete(id);
    return json(200, { ok: true });
  }

  return json(405, { error: "method not allowed" });
};

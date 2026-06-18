// POST /api/upload-image — store an uploaded image and return a public URL.
// Persists to Netlify Blobs so the image survives being shared/emailed: the
// exported HTML can reference a real https:// URL instead of an inline data:
// URI (which Gmail, Outlook, CMS paste boxes, etc. all strip).
import { getStore } from "@netlify/blobs";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// url-safe random id (~12 chars)
function genId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Map an image content-type to a file extension (for a clean, cache-friendly URL).
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }

  const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!m) return json(400, { error: "expected a base64 data: URL" });

  const contentType = m[1].toLowerCase();
  if (!contentType.startsWith("image/")) return json(415, { error: "not an image" });

  // base64 → bytes
  let bytes;
  try {
    const bin = atob(m[2]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return json(400, { error: "invalid base64" }); }

  // ~5MB cap — generous for a downscaled newsletter image, blunts abuse
  if (bytes.length > 5_000_000) return json(413, { error: "image too large" });

  const ext = EXT[contentType] || "img";
  const id = `${genId()}.${ext}`;

  const store = getStore("newsletter-images");
  await store.set(id, bytes.buffer, { metadata: { contentType, uploadedAt: new Date().toISOString() } });

  return json(200, { id, url: `/api/image/${id}` });
};

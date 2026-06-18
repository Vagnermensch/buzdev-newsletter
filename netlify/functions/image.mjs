// GET /api/image/<id> → the stored image bytes (from Netlify Blobs), served
// with its original content-type so it renders in any browser or email client.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  // id is the last path segment (e.g. /api/image/abc123.jpg); also accept ?id=.
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || url.pathname.split("/").filter(Boolean).pop() || "";
  if (!/^[\w-]{1,64}(\.\w{1,5})?$/.test(id)) {
    return new Response("bad id", { status: 400 });
  }

  const store = getStore("newsletter-images");
  const res = await store.getWithMetadata(id, { type: "arrayBuffer" });
  if (!res || res.data == null) return new Response("not found", { status: 404 });

  const contentType = res.metadata?.contentType || "application/octet-stream";
  return new Response(res.data, {
    status: 200,
    headers: {
      "content-type": contentType,
      // content is immutable (id is content-addressed by random key) → cache hard
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

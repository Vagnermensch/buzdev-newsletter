// GET /api/load?id=… → the stored newsletter JSON (from Netlify Blobs).
import { getStore } from "@netlify/blobs";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[\w-]{1,64}$/.test(id)) return json(400, { error: "bad id" });

  const store = getStore("newsletters");
  // The published default is mutable and read right after a Publish, so use
  // strong consistency — Blobs' default eventual reads can return the previous
  // value for several seconds, which looked like "my Publish didn't work".
  // Share links are immutable, so eventual (faster) reads are fine for them.
  const consistency = id === "site-default" ? "strong" : "eventual";
  const data = await store.get(id, { type: "text", consistency });
  if (data == null) return json(404, { error: "not found" });

  // Share links (random ids) are immutable → safe to cache. The published
  // default is mutable (Publish overwrites it), so it must never be edge-cached
  // or readers would keep seeing the old version for up to a minute.
  const cacheControl = id === "site-default" ? "no-store" : "public, max-age=60";
  return new Response(data, {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": cacheControl },
  });
};

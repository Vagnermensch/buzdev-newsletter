// GET /api/load?id=… → the stored newsletter JSON (from Netlify Blobs).
import { getStore } from "@netlify/blobs";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[\w-]{1,64}$/.test(id)) return json(400, { error: "bad id" });

  const store = getStore("newsletters");
  const data = await store.get(id, { type: "text" });
  if (data == null) return json(404, { error: "not found" });

  return new Response(data, {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
};

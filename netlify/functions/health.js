// GET /api/health → { ok: true }
exports.handler = async () => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ok: true }),
});

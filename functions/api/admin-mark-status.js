// POST /api/admin-mark-status  { id, status }
// Updates a submission's status (e.g. "new" -> "reviewed" or "archived") so
// the admin page's list can be kept tidy as Eve works through it. Requires a
// valid admin session cookie.

import { isAdminRequest, unauthorized } from "./_admin-auth.js";

const VALID_STATUSES = new Set(["new", "reviewed", "archived"]);

export async function onRequestPost({ request, env }) {
  if (!(await isAdminRequest(request, env))) return unauthorized();
  if (!env.CUSTOM_ORDERS) {
    return jsonError(500, "Custom orders aren't set up yet -- missing storage configuration.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!id || !VALID_STATUSES.has(status)) {
    return jsonError(400, "Invalid id or status");
  }

  const key = `submission:${id}`;
  const raw = await env.CUSTOM_ORDERS.get(key);
  if (!raw) return jsonError(404, "Submission not found");

  const record = JSON.parse(raw);
  record.status = status;
  await env.CUSTOM_ORDERS.put(key, JSON.stringify(record));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

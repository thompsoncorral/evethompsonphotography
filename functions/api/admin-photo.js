// GET /api/admin-photo?key=submissions/<id>/photo.jpg
// Streams a customer's submitted photo from private R2 storage -- only
// reachable with a valid admin session cookie, so these photos are never
// publicly accessible by URL guessing the way a public asset would be.

import { isAdminRequest, unauthorized } from "./_admin-auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAdminRequest(request, env))) return unauthorized();
  if (!env.CUSTOM_PHOTOS) {
    return jsonError(500, "Custom orders aren't set up yet -- missing storage configuration.");
  }

  const key = new URL(request.url).searchParams.get("key") || "";
  // Defense in depth beyond the auth check above -- this endpoint should
  // only ever be asked for a submission photo, never an arbitrary R2 key.
  if (!key.startsWith("submissions/") || key.includes("..")) {
    return jsonError(400, "Invalid photo key");
  }

  const object = await env.CUSTOM_PHOTOS.get(key);
  if (!object) return jsonError(404, "Photo not found");

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

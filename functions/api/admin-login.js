// POST /api/admin-login  { password }
// Checks the submitted password against the ADMIN_PASSWORD secret (set in
// Cloudflare Pages env vars, never in this repo) and, on success, sets the
// signed session cookie the rest of the admin area checks for (see
// _admin-auth.js). Nothing about failed attempts is logged or rate-limited
// here beyond what Cloudflare's own edge protections provide -- fine for a
// single-owner admin page, but worth knowing if this ever needs to be
// hardened further.

import { createSessionCookie } from "./_admin-auth.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!env.ADMIN_PASSWORD) {
    // Fails closed -- if the secret was never set in Cloudflare, nobody
    // gets in rather than everybody getting in.
    return jsonError(500, "Admin login isn't configured yet");
  }
  if (password !== env.ADMIN_PASSWORD) {
    return jsonError(401, "Incorrect password");
  }

  const cookie = await createSessionCookie(env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

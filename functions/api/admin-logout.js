// POST /api/admin-logout -- clears the admin session cookie.

import { clearSessionCookie } from "./_admin-auth.js";

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie() },
  });
}

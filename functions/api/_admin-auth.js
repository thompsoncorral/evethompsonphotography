// Shared helper for the password-protected admin area (see admin-login.js,
// admin-submissions.js, admin-photo.js, admin-mark-status.js,
// admin-generate-link.js). Login checks the password against the
// ADMIN_PASSWORD secret and, on success, hands back a signed session token
// (see _link-signing.js) as an HttpOnly cookie -- nothing about "who's
// logged in" is stored anywhere server-side, the cookie itself is the proof,
// and it simply stops working after SESSION_HOURS once its embedded
// `expiresAt` is in the past.

import { signToken, verifyToken } from "./_link-signing.js";

export const COOKIE_NAME = "etp_admin_session";
const SESSION_HOURS = 8;

export async function createSessionCookie(env) {
  const token = await signToken(env.LINK_SIGNING_SECRET, {
    purpose: "admin-session",
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  });
  // Secure + HttpOnly + SameSite=Strict: only sent by the browser back to
  // this same site over HTTPS, never readable from page JS (so a stray
  // script on the page can't exfiltrate it) and never sent cross-site.
  const maxAgeSeconds = SESSION_HOURS * 60 * 60;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

// Returns true if the request carries a currently-valid admin session
// cookie, false otherwise (missing, forged, expired, or signed for anything
// other than an admin session).
export async function isAdminRequest(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const payload = await verifyToken(env.LINK_SIGNING_SECRET, token);
  if (!payload || payload.purpose !== "admin-session") return false;
  if (!payload.expiresAt || Date.now() > payload.expiresAt) return false;
  return true;
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Not authorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

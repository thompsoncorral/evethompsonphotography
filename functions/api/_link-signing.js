// Shared signing helper for two things that both need a tamper-proof token
// with nothing stored server-side to look it up by:
//   - the admin login session cookie (see admin-login.js / _admin-auth.js)
//   - private "custom order" product links (see admin-generate-link.js /
//     custom-product.js)
// The token is just its JSON payload plus an HMAC-SHA256 signature over that
// payload, both base64url-encoded and joined with a ".". Verifying re-checks
// the signature against LINK_SIGNING_SECRET (a Cloudflare Pages secret) --
// there's no database row to look up, so a forged or edited token is
// rejected purely by the signature not matching, and there's nothing to
// clean up when a token expires (see the `expiresAt` convention used by
// callers -- this module itself doesn't know about expiry, callers check
// `payload.expiresAt` themselves after a successful verify).

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// payload: any JSON-serializable object. Returns a compact, URL-safe token
// safe to drop straight into a query string or a cookie value.
export async function signToken(secret, payload) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// Returns the decoded payload if the signature checks out, or null for
// anything missing, malformed, tampered with, or signed under a different
// secret. Never throws -- callers can treat null as "not authorized" without
// a try/catch of their own.
export async function verifyToken(secret, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payloadPart, sigPart] = token.split(".");
  try {
    const payloadBytes = base64UrlDecode(payloadPart);
    const signatureBytes = base64UrlDecode(sigPart);
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, payloadBytes);
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}

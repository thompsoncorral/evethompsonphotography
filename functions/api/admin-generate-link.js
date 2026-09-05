// POST /api/admin-generate-link  { productId }
// Signs a private link for one Printful product (see custom-product.js,
// which verifies it) so Eve can email it to a customer. Requires a valid
// admin session cookie. The link doesn't expire on its own -- if it ever
// needs to stop working, deleting/unsyncing the product in Printful does
// that automatically, since custom-product.js just won't find it anymore.

import { isAdminRequest, unauthorized } from "./_admin-auth.js";
import { signToken } from "./_link-signing.js";

export async function onRequestPost({ request, env }) {
  if (!(await isAdminRequest(request, env))) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const productId = Number(body.productId);
  if (!productId || !Number.isFinite(productId)) {
    return jsonError(400, "Please provide a valid Printful product ID.");
  }

  const token = await signToken(env.LINK_SIGNING_SECRET, {
    purpose: "custom-product",
    productId,
    issuedAt: Date.now(),
  });

  const origin = new URL(request.url).origin;
  const url = `${origin}/shop/custom/?code=${token}`;

  return new Response(JSON.stringify({ url, code: token }), {
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

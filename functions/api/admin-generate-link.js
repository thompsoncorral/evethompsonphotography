// POST /api/admin-generate-link  { productId, upsellProductIds? }
// Signs a private link for one main Printful product plus, optionally, up to
// two more "you might also like" products made from the same customer photo
// (see custom-product.js, which verifies it and fetches all of them). Eve
// emails this one link to the customer -- everything shows up together on
// /shop/custom/ and, once the main item is added to cart, the upsells are
// offered again in the cart drawer before checkout (see shop/shop.js).
// Requires a valid admin session cookie. The link doesn't expire on its own
// -- if it ever needs to stop working, deleting/unsyncing the product(s) in
// Printful does that automatically, since custom-product.js just won't find
// them anymore.

import { isAdminRequest, unauthorized } from "./_admin-auth.js";
import { signToken } from "./_link-signing.js";

const MAX_UPSELLS = 2;

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

  // Optional upsell product ids -- de-duped, capped at MAX_UPSELLS, and
  // never allowed to include the main product itself (that would just show
  // the same item twice).
  const rawUpsells = Array.isArray(body.upsellProductIds) ? body.upsellProductIds : [];
  const upsellProductIds = [...new Set(rawUpsells.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n !== productId))].slice(
    0,
    MAX_UPSELLS
  );

  const token = await signToken(env.LINK_SIGNING_SECRET, {
    purpose: "custom-product",
    productId,
    upsellProductIds,
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

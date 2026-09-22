// POST /api/shipping-rates
// Body: { recipient: {address1, address2, city, state_code, country_code, zip},
//          items: [{ variant_id, quantity }] }   // variant_id = sync_variant_id
// Returns: { rates: [{ id, name, rate, currency }] }
//
// This calls Printful live so shipping cost always reflects the real
// destination and cart contents rather than a guessed flat rate.
//
// Important Printful quirk: POST /shipping/rates only accepts the *catalog*
// variant_id (a small Printful-catalog-wide number, e.g. 4011) in its items
// array -- not a store's sync_variant_id (the large per-store id our cart
// and /api/products use everywhere else). Sending the sync id under either
// key fails ("Missing item variant_id" if the key is sync_variant_id,
// "Invalid variant ID" if renamed to variant_id but still holding the sync
// id). So for each cart line we first look up its sync variant via
// GET /sync/variant/{id}, which returns both the sync id and the
// underlying catalog variant_id, and use that catalog id here.

import {
  isBlockedCountry,
  BLOCKED_COUNTRY_MESSAGE,
  isFreeShippingDestination,
  qualifiesForFreeShipping,
  FREE_SHIPPING_RATE_ID,
  FREE_SHIPPING_THRESHOLD,
  cartHasCanvas,
} from "./_shipping-zones.js";
import { applyBundles } from "./_bundles.js"

const PRINTFUL_BASE = "https://api.printful.com";

function printfulHeaders(env) {
  const headers = {
    Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
    "Content-Type": "application/json",
  };
  // Only needed for account-level tokens that can see multiple stores.
  if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;
  return headers;
}

// The goods subtotal and the canvas check now come from the per-line
// GET /sync/variant/{id} lookups below, which this endpoint already makes to
// resolve catalog variant ids. Printful's list endpoint does NOT return
// variant-level detail -- /sync/products gives each product's variant COUNT,
// not its variants -- so the previous attempt here to build a variant -> price
// map from that listing found nothing and silently reported "no subtotal",
// which meant the free shipping option was never offered to anyone. Reading
// the lines we have already fetched removes that whole class of failure and
// costs no extra Printful calls.

export async function onRequestPost({ request, env }) {
      let body;
      try {
              body = await request.json();
      } catch {
              return jsonError(400, "Invalid JSON body");
      }

  const { recipient, items } = body || {};
      if (!recipient || !recipient.country_code || !recipient.zip) {
              return jsonError(400, "recipient.country_code and recipient.zip are required");
      }
      // No EU shipping -- see _shipping-zones.js for why. Checked here as well as
      // at checkout so the customer is told before filling in the rest of the
      // form, not after.
      if (isBlockedCountry(recipient.country_code)) {
              return jsonError(400, BLOCKED_COUNTRY_MESSAGE);
      }
      if (!Array.isArray(items) || items.length === 0) {
              return jsonError(400, "items must be a non-empty array");
      }

  const headers = {
          Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
          "Content-Type": "application/json",
  };
      if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;

  try {
          // Resolve each cart line's sync_variant_id to its catalog variant_id.
          // The same response carries the variant's own retail_price, its name and
          // its sync_product_id, which is everything the subtotal and the canvas
          // check below need -- so neither costs an extra Printful call.
          const resolvedItems = [];
          const resolvedLines = [];
            for (const item of items) {
                      const variantRes = await fetch(`${PRINTFUL_BASE}/sync/variant/${item.variant_id}`, {
                                  headers,
                      }).catch(() => null);
                      if (!variantRes || !variantRes.ok) {
                                  return jsonError(400, { message: `Could not verify variant ${item.variant_id} with Printful` });
                      }
                      const variantData = await variantRes.json();
                      const syncVariant = variantData.result.sync_variant || variantData.result;
                      resolvedItems.push({
                                  quantity: item.quantity,
                                  variant_id: syncVariant.variant_id,
                      });
                      resolvedLines.push({
                                  syncVariantId: syncVariant.id,
                                  syncProductId: syncVariant.sync_product_id,
                                  catalogVariantId: syncVariant.variant_id,
                                  name: syncVariant.name,
                                  quantity: item.quantity,
                                  unitAmount: Math.round(parseFloat(syncVariant.retail_price || "0") * 100),
                      });
            }

        const res = await fetch(`${PRINTFUL_BASE}/shipping/rates`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                              recipient: {
                                            address1: recipient.address1,
                                            address2: recipient.address2 || "",
                                            city: recipient.city,
                                            state_code: recipient.state_code || "",
                                            country_code: recipient.country_code,
                                            zip: recipient.zip,
                              },
                              items: resolvedItems,
                  }),
        });

        const data = await res.json();
          if (!res.ok) return jsonError(res.status, printfulErrorMessage(data));

        const rates = (data.result || []).map((r) => ({
                  id: r.id,
                  name: r.name,
                  rate: r.rate,
                  currency: r.currency,
        }));

        // Free shipping, offered only when it is earned. Placed FIRST so it is
        // the option already selected when the customer reaches the page.
        // Guarded by the same rule the checkout enforces, so this can never
        // advertise something the checkout would then refuse to honour.
        if (isFreeShippingDestination(recipient.country_code, recipient.state_code)) {
                  // The same figure the checkout will charge: quantity deals
                  // applied first, then summed, so this can never advertise an
                  // offer the checkout would then refuse. Mirrors
                  // create-checkout-session.js exactly.
                  const { lines: pricedLines } = applyBundles(resolvedLines);
                  const subtotal = pricedLines.reduce(
                            (sum, l) => sum + (l.unitAmount / 100) * l.quantity, 0);
                  const hasCanvas = cartHasCanvas(pricedLines);

                  if (qualifiesForFreeShipping(
                            recipient.country_code,
                            recipient.state_code,
                            subtotal,
                            hasCanvas)) {
                            rates.unshift({
                                      id: FREE_SHIPPING_RATE_ID,
                                      name: `Free shipping on canvas (orders over $${FREE_SHIPPING_THRESHOLD})`,
                                      rate: "0.00",
                                      currency: "usd",
                            });
                  }
        }

        return new Response(JSON.stringify({ rates }), {
                  headers: { "Content-Type": "application/json" },
        });
  } catch (err) {
          return jsonError(500, { message: err.message });
  }
}

// Printful refuses rates when an item cannot ship to the destination at all,
// replying with something like:
//   This product "Acrylic Ornaments (Circle)" ships to United States only and
//   the current shipping address is outside of this region.
// The raw body is a nested object, so passing it straight through leaves the
// customer with our generic "Failed to get shipping rates" and no idea why. Turn
// it into one sentence naming the product and the region it is limited to.
// Note: some products really are restricted by Printful -- the acrylic ornaments
// are US-only at their end regardless of what this shop allows.
function printfulErrorMessage(data) {
  const level1 = typeof data === "string" ? data : (data && (data.result || data.error || data.message)) || "";
  const text =
    typeof level1 === "string"
      ? level1
      : (level1 && (level1.message || level1.reason)) || "";

  const limited = String(text).match(/This product "([^"]+)" ships to ([^.]+) only/i);
  if (limited) {
    const product = limited[1];
    const region = limited[2].trim();
    const where = region.toLowerCase() === "united states" ? "the United States" : region;
    return `"${product}" can only be shipped within ${where}, so it can't be delivered to this address.`;
  }

  return String(text) || "Could not get shipping rates for this address.";
}

function jsonError(status, detail) {
      return new Response(JSON.stringify({ error: "Failed to get shipping rates", detail }), {
              status,
              headers: { "Content-Type": "application/json" },
      });
}

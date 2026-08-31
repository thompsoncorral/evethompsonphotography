// POST /api/create-checkout-session
// Body: {
//   items: [{ variant_id, quantity }],
//   shipping_id: "STANDARD",            // the "id" the customer picked from /api/shipping-rates
//   recipient: { name, email, address1, address2, city, state_code, country_code, zip, phone }
// }
// Returns: { url }  -> redirect the browser here (Stripe Checkout)
//
// Security note: we NEVER trust prices or shipping cost sent from the
// browser. We re-fetch the authoritative product prices from Printful and
// re-run the shipping-rate calculation here, so a tampered client request
// can't change what gets charged.

import Stripe from "stripe";

const PRINTFUL_BASE = "https://api.printful.com";

function printfulHeaders(env) {
    const headers = {
          Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
          "Content-Type": "application/json",
    };
    if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;
    return headers;
}

export async function onRequestPost({ request, env }) {
    let body;
    try {
          body = await request.json();
    } catch {
          return jsonError(400, "Invalid JSON body");
    }

  const { items, shipping_id, recipient } = body || {};

  if (!Array.isArray(items) || items.length === 0) return jsonError(400, "items required");
    if (!shipping_id) return jsonError(400, "shipping_id required");
    if (!recipient || !recipient.email || !recipient.country_code || !recipient.zip) {
          return jsonError(400, "recipient (with email, country_code, zip) required");
    }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient(),
        apiVersion: "2024-06-20",
  });

  try {
        // 1. Re-fetch authoritative price + name + image for every cart line.
      const lineItems = [];
        const orderItems = [];

      for (const cartLine of items) {
              const detailRes = await fetch(`${PRINTFUL_BASE}/sync/variant/${cartLine.variant_id}`, {
                        headers: printfulHeaders(env),
              }).catch(() => null);

          // Fallback: some Printful accounts expose this as /sync/products/{id}
          // rather than a direct variant lookup. Try the variant-scoped route
          // first; if it 404s, the shop.js flow instead sends product ids we
          // resolved on /api/products, which already has retail_price cached
          // client-side for display -- but for the CHARGE we still require the
          // server to have fetched it here, so we fail closed instead of
          // trusting the client price.
          if (!detailRes || !detailRes.ok) {
                    return jsonError(400, {
                                message: `Could not verify variant ${cartLine.variant_id} with Printful`,
                    });
          }

          const detailData = await detailRes.json();
              const variant = detailData.result.sync_variant || detailData.result;
              const unitAmount = Math.round(parseFloat(variant.retail_price) * 100);

          lineItems.push({
                    price_data: {
                                currency: (variant.currency || "usd").toLowerCase(),
                                product_data: {
                                              name: variant.name,
                                },
                                unit_amount: unitAmount,
                    },
                    quantity: cartLine.quantity,
          });

          orderItems.push({
                    sync_variant_id: variant.id,
                    quantity: cartLine.quantity,
                    retail_price: variant.retail_price,
          });
      }

      // 2. Re-run the shipping calculation server-side and find the rate the
      // customer picked, so its price can't be spoofed either.
      const ratesRes = await fetch(`${PRINTFUL_BASE}/shipping/rates`, {
              method: "POST",
              headers: printfulHeaders(env),
              body: JSON.stringify({
                        recipient: {
                                    address1: recipient.address1,
                                    address2: recipient.address2 || "",
                                    city: recipient.city,
                                    state_code: recipient.state_code || "",
                                    country_code: recipient.country_code,
                                    zip: recipient.zip,
                        },
                        items: orderItems.map((i) => ({
                                    quantity: i.quantity,
                    // Printful's shipping/rates endpoint expects the item key named "variant_id" even for a sync variant's numeric id.
                                                variant_id: i.sync_variant_id,
                        })),
              }),
      });
        const ratesData = await ratesRes.json();
        if (!ratesRes.ok) return jsonError(400, { message: "Could not verify shipping rate", detail: ratesData });

      const chosenRate = (ratesData.result || []).find((r) => r.id === shipping_id);
        if (!chosenRate) return jsonError(400, "Selected shipping option is no longer available");

      lineItems.push({
              price_data: {
                        currency: (chosenRate.currency || "usd").toLowerCase(),
                        product_data: { name: `Shipping - ${chosenRate.name}` },
                        unit_amount: Math.round(parseFloat(chosenRate.rate) * 100),
              },
              quantity: 1,
      });

      // 3. Stash the verified order payload in KV, keyed by a token we control.
      // We look this up again in the Stripe webhook once payment succeeds, so
      // the Printful order always reflects server-verified data, not
      // anything the browser sent us.
      const orderToken = crypto.randomUUID();
        await env.ORDERS.put(
                orderToken,
                JSON.stringify({
                          recipient: {
                                      name: recipient.name || recipient.email,
                                      email: recipient.email,
                                      address1: recipient.address1,
                                      address2: recipient.address2 || "",
                                      city: recipient.city,
                                      state_code: recipient.state_code || "",
                                      country_code: recipient.country_code,
                                      zip: recipient.zip,
                                      phone: recipient.phone || "",
                          },
                          items: orderItems,
                          shipping: chosenRate.id,
                }),
          { expirationTtl: 60 * 60 * 24 } // 24h; cleaned up sooner on success anyway
              );

      // 4. Create the Stripe Checkout Session.
      const origin = new URL(request.url).origin;
        const session = await stripe.checkout.sessions.create({
                mode: "payment",
                customer_email: recipient.email,
                line_items: lineItems,
                metadata: { order_token: orderToken },
                success_url: `${origin}/shop/success.html?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${origin}/shop/index.html?canceled=1`,
        });

      return new Response(JSON.stringify({ url: session.url }), {
              headers: { "Content-Type": "application/json" },
      });
  } catch (err) {
        return jsonError(500, { message: err.message });
  }
}

function jsonError(status, detail) {
    return new Response(JSON.stringify({ error: "Checkout failed", detail }), {
          status,
          headers: { "Content-Type": "application/json" },
    });
}

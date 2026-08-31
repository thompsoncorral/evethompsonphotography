// POST /api/shipping-rates
// Body: { recipient: {address1, address2, city, state_code, country_code, zip},
//          items: [{ variant_id, quantity }] }   // variant_id = sync_variant_id
// Returns: { rates: [{ id, name, rate, currency }] }
//
// This calls Printful live so shipping cost always reflects the real
// destination and cart contents rather than a guessed flat rate.

const PRINTFUL_BASE = "https://api.printful.com";

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
    if (!Array.isArray(items) || items.length === 0) {
          return jsonError(400, "items must be a non-empty array");
    }

  const headers = {
        Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
        "Content-Type": "application/json",
  };
    if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;

  try {
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
                          items: items.map((i) => ({
                                      quantity: i.quantity,
                                      // Printful's shipping/rates endpoint accepts sync_variant_id here
                                      // when the id you have is a sync variant (which ours is).
                                      sync_variant_id: i.variant_id,
                          })),
                }),
        });

      const data = await res.json();
        if (!res.ok) return jsonError(res.status, data);

      const rates = (data.result || []).map((r) => ({
              id: r.id,
              name: r.name,
              rate: r.rate,
              currency: r.currency,
      }));

      return new Response(JSON.stringify({ rates }), {
              headers: { "Content-Type": "application/json" },
      });
  } catch (err) {
        return jsonError(500, { message: err.message });
  }
}

function jsonError(status, detail) {
    return new Response(JSON.stringify({ error: "Failed to get shipping rates", detail }), {
          status,
          headers: { "Content-Type": "application/json" },
    });
}

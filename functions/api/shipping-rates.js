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
          // Resolve each cart line's sync_variant_id to its catalog variant_id.
        const resolvedItems = [];
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

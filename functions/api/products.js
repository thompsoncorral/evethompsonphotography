// GET /api/products
// Returns the store's synced Printful products with their variants, in a
// shape the storefront can render directly. The Printful private token
// lives only in this server-side function (Cloudflare env var), never in
// the browser.

const PRINTFUL_BASE = "https://api.printful.com";

function printfulHeaders(env) {
          const headers = {
                      Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
          };
          // Only needed for account-level tokens that can see multiple stores.
  // Safe to leave unset if you created a single-store token.
  if (env.PRINTFUL_STORE_ID) {
              headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;
  }
          return headers;
}

// Building the product list makes roughly 2 Printful calls per product
// (one for sync variant detail, one for the catalog description) plus one
// list call, all fired in parallel via Promise.all. For a ~25-product shop
// that's 50+ simultaneous requests to Printful's API on every cache miss --
// enough to trip Printful's per-account rate limit, which comes back as a
// 429 on whichever individual call lost the race. Previously that just
// silently dropped that one product's description (or, worse, the whole
// list call), which is what made "Waves Pillow" description randomly go
// missing. Retry once or twice with backoff so a rate-limited call gets a
// second chance instead of giving up immediately.
async function fetchWithRetry(url, options, retries = 2) {
          for (let attempt = 0; ; attempt++) {
                      const res = await fetch(url, options);
                      if (res.status !== 429 || attempt >= retries) return res;
                      const retryAfterHeader = res.headers.get("Retry-After");
                      const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 300 * 2 ** attempt;
                      await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
}

export async function onRequestGet({ env, request, waitUntil }) {
          // The fan-out below is expensive (see fetchWithRetry comment), so cache
  // the assembled response at Cloudflare's edge for well beyond the
  // previous 2-minute Cache-Control window. A photography print shop's
  // catalog doesn't change minute to minute, and doing this fan-out only
  // once every 10 minutes (instead of on every cache-control expiry, times
  // however many concurrent shoppers) is most of the fix for the rate
  // limiting itself -- fewer runs means fewer chances to collide with it.
  const cacheKey = new Request(new URL(request.url).origin + "/api/products", request);
          const cache = caches.default;
          // ?refresh=1 forces a fresh Printful fetch past the edge cache -- an
                // escape hatch for right after publishing a design change in
                // Printful, rather than waiting up to 10 minutes to see it reflected.
                const skipCache = new URL(request.url).searchParams.get("refresh") === "1";
                const cached = skipCache ? null : await cache.match(cacheKey);
          if (cached) return cached;

  try {
              // 1. List all synced products (id + name only at this level).
            const listRes = await fetchWithRetry(`${PRINTFUL_BASE}/sync/products?status=synced&limit=100`, {
                          headers: printfulHeaders(env),
            });
              const listData = await listRes.json();

            if (!listRes.ok) {
                          return jsonError(listRes.status, listData);
            }

            const summaries = listData.result || [];

            // 2. Fetch full detail (variants, prices, images) for each product.
            // Printful doesn't return variant-level detail from the list endpoint,
            // so we fan out. This is fine for a small catalog like a photography
            // print shop; for a very large catalog you'd want to cache this.
            const detailed = await Promise.all(
                          summaries.map(async (summary) => {
                                          const detailRes = await fetchWithRetry(`${PRINTFUL_BASE}/sync/products/${summary.id}`, {
                                                            headers: printfulHeaders(env),
                                          });
                                          const detailData = await detailRes.json();
                                          if (!detailRes.ok) return null;

                                                const product = detailData.result.sync_product;
                                          const variants = (detailData.result.sync_variants || []).map((v) => {
                                                            const files = v.files || [];
                                                            // A variant can carry more than one preview image --
                                                                                                                 // e.g. apparel with front + back printing gets a
                                                                                                                 // separate mockup for each placement, and a product
                                                                                                                 // with multiple mockup styles selected in the
                                                                                                                 // Printful dashboard can have several. Collect every
                                                                                                                 // preview_url so the storefront can show a small
                                                                                                                 // gallery instead of just one flat thumbnail; when
                                                                                                                 // there's only one (the common case), this is just a
                                                                                                                 // one-item array and nothing changes visually.
                                                                                                                 const images = [...new Set(files.map((f) => f.preview_url).filter(Boolean))];

                                                                                                                 return {
                                                                                                                                     id: v.id, // this is the sync_variant_id used everywhere else
                                                                                                                                     name: v.name,
                                                                                                                                     retail_price: v.retail_price,
                                                                                                                                     currency: v.currency || "USD",
                                                                                                                                     sku: v.sku,
                                                                                                                                     in_stock: v.availability_status !== "discontinued",
                                                                                                                                     images,
                                                                                                                                     image: images[0] || product.thumbnail_url || null,
                                                                                                                         };
                                          });

                                                // 3. Look up Printful's own description for the underlying
                                                // catalog product (fabric, fit, care instructions -- the same
                                                // generic copy for every seller using that blank item, since
                                                // Printful has no field for a seller-specific description tied
                                                // to a design). Uses the first sync variant's catalog variant_id
                                                // -- present already on the /sync/products/{id} response, no
                                                // extra lookup needed -- to fetch it via GET /products/variant/{id}.
                                                // Best-effort: if this still fails after retrying, or the shape
                                                // isn't what's expected, the product still renders fine, just
                                                // without a description.
                                                const firstCatalogVariantId = (detailData.result.sync_variants || [])[0]?.variant_id || null;
                                          let description = null;
                                          if (firstCatalogVariantId) {
                                                            try {
                                                                                const catalogRes = await fetchWithRetry(`${PRINTFUL_BASE}/products/variant/${firstCatalogVariantId}`, {
                                                                                                      headers: printfulHeaders(env),
                                                                                });
                                                                                if (catalogRes.ok) {
                                                                                                      const catalogData = await catalogRes.json();
                                                                                                      description = stripSourcingLine(catalogData.result?.product?.description || null);
                                                                                        }
                                                            } catch {
                                                                                // swallow -- description is a nice-to-have, not worth failing the product for
                                                            }
                                          }

                                                return {
                                                                  id: product.id,
                                                                  name: product.name,
                                                                  // Prefer the variant's own preview image over Printful's
                                                                  // product-level thumbnail_url: thumbnail_url is a separate,
                                                                  // more slowly-updated field -- picking a new mockup style
                                                                  // for a product in the Printful dashboard updates the
                                                                  // variant's preview files right away, but doesn't reliably
                                                                  // update thumbnail_url along with it, which left the shop
                                                                  // showing an old mockup even after the image was changed.
                                                                  thumbnail: variants[0]?.image || product.thumbnail_url || null,
                                                                  // Default gallery for the product card + lightbox: the
                                                                  // first variant's images (usually front/back mockups of
                                                                  // the default color/size). Color variants each have their
                                                                  // own mockups, picked up when a shopper opens "Choose
                                                                  // options" and switches color.
                                                                  images: variants[0]?.images || [],
                                                                  description,
                                                                  variants,
                                                };
                          })
                        );

            const products = detailed.filter((p) => p && p.variants.length > 0);

            const response = new Response(JSON.stringify({ products }), {
                          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
            });
              waitUntil(cache.put(cacheKey, response.clone()));
              return response;
  } catch (err) {
            return jsonError(500, { message: err.message });
  }
}

// Printful's catalog description always includes a manufacturing-origin
// bullet ("• Blank product sourced from China", "...from the USA", etc.) --
// factual, but not copy we want customers reading on a product page. Strip
// just that bullet line and tidy up the blank line it leaves behind.
function stripSourcingLine(description) {
          if (!description) return description;
          return description
            .replace(/\n•\s*Blank product sourced from[^\n]*/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
}

function jsonError(status, detail) {
          return new Response(JSON.stringify({ error: "Failed to load products", detail }), {
                      status,
                      headers: { "Content-Type": "application/json" },
          });
}

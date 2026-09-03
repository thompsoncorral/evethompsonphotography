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

// A handful of 429s from Printful is expected under the fan-out below, so
// give a rate-limited call a second chance instead of giving up immediately.
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
  // The fan-out below is expensive (see the comment further down), so cache
  // the assembled response at Cloudflare's edge for well beyond the
  // previous 2-minute Cache-Control window. A photography print shop's
  // catalog doesn't change minute to minute, and doing this fan-out only
  // once every 10 minutes (instead of on every cache-control expiry, times
  // however many concurrent shoppers) is most of the fix for the rate
  // limiting itself -- fewer runs means fewer chances to collide with it.
  const cacheKey = new Request(new URL(request.url).origin + "/api/products", request);
  const cache = caches.default;
  // ?refresh=1 forces a fresh Printful fetch past the edge cache -- an
  // escape hatch for right after publishing a design change in Printful,
  // rather than waiting up to 10 minutes to see it reflected.
  const requestUrl = new URL(request.url);
  const skipCache = requestUrl.searchParams.get("refresh") === "1";
  // Temporary: ?debug=1 attaches each product's raw file list (type +
  // preview_url) to find out which file type is the actual product mockup
  // vs. the flat print/design file. Implies refresh=1's cache bypass.
  const debug = requestUrl.searchParams.get("debug") === "1";
  const cached = skipCache || debug ? null : await cache.match(cacheKey);
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

    // Printful's catalog description (fabric, fit, care instructions) is
    // looked up per product below, but many sync products in a POD shop
    // share the exact same underlying blank item -- e.g. five different
    // mouse pad designs are all the same physical catalog variant, just
    // printed differently -- so the same catalogVariantId comes up
    // repeatedly. Cache each lookup by catalogVariantId within this one
    // request (a Promise, so concurrent products awaiting the same id share
    // a single in-flight fetch instead of each firing their own) rather
    // than hitting Printful again for every product. For this ~25-product
    // shop that cuts the catalog-description calls from 25 down to the
    // handful of distinct blank items actually in use.
    //
    // This isn't just an optimization: every Printful call here counts
    // against Cloudflare's per-invocation subrequest limit (50 on most
    // plans), alongside the list call and one detail call per product. 1
    // list + 25 detail + 25 (undeduped) catalog calls was landing right at
    // that ceiling, so whichever product's catalog call happened to be
    // counted last got hard-rejected by Cloudflare itself with "Too many
    // subrequests by single Worker invocation" -- not a Printful 429 at
    // all, which is why retrying it never helped and it was always the
    // same one or two products (it was "Waves Pillow" this time) losing
    // their description. Deduping brings the catalog calls for this shop
    // down to well under 10, with plenty of headroom under the cap.
    const catalogDescriptionCache = new Map(); // catalogVariantId -> Promise<string|null>
    function getCatalogDescription(catalogVariantId) {
      if (!catalogDescriptionCache.has(catalogVariantId)) {
        catalogDescriptionCache.set(
          catalogVariantId,
          (async () => {
            try {
              const catalogRes = await fetchWithRetry(`${PRINTFUL_BASE}/products/variant/${catalogVariantId}`, {
                headers: printfulHeaders(env),
              });
              if (!catalogRes.ok) return null;
              const catalogData = await catalogRes.json();
              return stripSourcingLine(catalogData.result?.product?.description || null);
            } catch {
              return null; // best-effort -- description is a nice-to-have, not worth failing the product for
            }
          })()
        );
      }
      return catalogDescriptionCache.get(catalogVariantId);
    }

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
        // extra lookup needed -- deduped across products via
        // getCatalogDescription above. Best-effort: if this still fails
        // after retrying, or the shape isn't what's expected, the product
        // still renders fine, just without a description.
        const firstCatalogVariantId = (detailData.result.sync_variants || [])[0]?.variant_id || null;
        const description = firstCatalogVariantId ? await getCatalogDescription(firstCatalogVariantId) : null;

        return {
          id: product.id,
          name: product.name,
          ...(debug ? { debugFiles: (detailData.result.sync_variants || [])[0]?.files || [] } : {}),
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
    if (!debug) waitUntil(cache.put(cacheKey, response.clone()));
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

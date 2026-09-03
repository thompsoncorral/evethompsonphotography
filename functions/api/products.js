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

export async function onRequestGet({ env }) {
    try {
          // 1. List all synced products (id + name only at this level).
      const listRes = await fetch(`${PRINTFUL_BASE}/sync/products?status=synced&limit=100`, {
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
                        const detailRes = await fetch(`${PRINTFUL_BASE}/sync/products/${summary.id}`, {
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

                                    return {
                                                id: product.id,
                                                name: product.name,
                                                thumbnail: product.thumbnail_url || variants[0]?.image || null,
                                                // Default gallery for the product card + lightbox: the
                                                // first variant's images (usually front/back mockups of
                                                // the default color/size). Color variants each have their
                                                // own mockups, picked up when a shopper opens "Choose
                                                // options" and switches color.
                                                images: variants[0]?.images || [],
                                                variants,
                                    };
              })
            );

      const products = detailed.filter((p) => p && p.variants.length > 0);

      return new Response(JSON.stringify({ products }), {
              headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=120" },
      });
    } catch (err) {
          return jsonError(500, { message: err.message });
    }
}

function jsonError(status, detail) {
    return new Response(JSON.stringify({ error: "Failed to load products", detail }), {
          status,
          headers: { "Content-Type": "application/json" },
    });
}

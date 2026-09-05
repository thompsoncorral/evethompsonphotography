// GET /api/custom-product?code=...
// Powers the private product page at /shop/custom/ (see that page's inline
// script). Verifies the signed code (see admin-generate-link.js /
// _link-signing.js) and, if valid, fetches that one Printful product and
// returns it in the same shape /api/products uses for each item in its
// array -- so the private page can reuse the exact same rendering
// (thumbnail, variants, price) as the public shop.
//
// Deliberately self-contained rather than importing the detail-fetch logic
// from products.js: that file fans out over the whole catalog and has
// hard-won handling for Printful's rate limits and Cloudflare's
// per-invocation subrequest cap (see its comments) -- a single-product
// lookup here never comes close to either limit, so duplicating the much
// smaller amount of per-product shaping logic is safer than risking a
// regression in the public listing by refactoring it into a shared module.

import { verifyToken } from "./_link-signing.js";

const PRINTFUL_BASE = "https://api.printful.com";

function printfulHeaders(env) {
  const headers = { Authorization: `Bearer ${env.PRINTFUL_TOKEN}` };
  if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;
  return headers;
}

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429 || attempt >= retries) return res;
    const retryAfterHeader = res.headers.get("Retry-After");
    const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 300 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function stripSourcingLine(description) {
  if (!description) return description;
  return description
    .replace(/\n•\s*Blank product sourced from[^\n]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function onRequestGet({ request, env }) {
  const code = new URL(request.url).searchParams.get("code") || "";
  const payload = await verifyToken(env.LINK_SIGNING_SECRET, code);
  if (!payload || payload.purpose !== "custom-product" || !payload.productId) {
    return jsonError(404, "This link isn't valid. Double-check the link or code and try again.");
  }

  try {
    const detailRes = await fetchWithRetry(`${PRINTFUL_BASE}/sync/products/${payload.productId}`, {
      headers: printfulHeaders(env),
    });
    const detailData = await detailRes.json();
    if (!detailRes.ok) {
      return jsonError(404, "This product isn't available anymore.");
    }

    const product = detailData.result.sync_product;
    const variants = (detailData.result.sync_variants || []).map((v) => {
      const files = v.files || [];
      const previewFiles = files.filter((f) => f.type === "preview" && f.preview_url);
      const images = [...new Set((previewFiles.length ? previewFiles : files).map((f) => f.preview_url).filter(Boolean))];
      return {
        id: v.id,
        name: v.name,
        retail_price: v.retail_price,
        currency: v.currency || "USD",
        sku: v.sku,
        in_stock: v.availability_status !== "discontinued",
        images,
        image: images[0] || product.thumbnail_url || null,
      };
    });

    if (variants.length === 0) {
      return jsonError(404, "This product isn't available anymore.");
    }

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
        // best-effort -- a missing description shouldn't fail the whole page
      }
    }

    const shaped = {
      id: product.id,
      name: product.name,
      thumbnail: variants[0]?.image || product.thumbnail_url || null,
      images: variants[0]?.images || [],
      description,
      variants,
    };

    return new Response(JSON.stringify({ product: shaped }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError(500, "Couldn't load this product right now -- please try again shortly.");
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

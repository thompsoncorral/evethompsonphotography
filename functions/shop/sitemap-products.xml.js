// GET /shop/sitemap-products.xml
// Lists every current product's own SEO landing page (see
// functions/shop/p/[id].js) so search engines can discover and index them
// individually -- generated live from the same /api/products the shop
// itself renders from, so it never drifts out of sync with the real
// catalog. Referenced from the root robots.txt alongside the main
// sitemap.xml.

// Kept in sync with productSlug() in shop/shop.js and functions/shop/p/[id].js
// -- all three need to agree on the URL a given product name produces.
function productSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;

  let products = [];
  try {
    const apiRes = await fetch(`${origin}/api/products`);
    if (apiRes.ok) {
      const data = await apiRes.json();
      products = data.products || [];
    }
  } catch {
    // best-effort -- an empty sitemap is better than a 500 here
  }

  const urls = products
    .map((p) => {
      const loc = `${origin}/shop/p/${p.id}-${productSlug(p.name)}/`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "public, max-age=600" },
  });
}

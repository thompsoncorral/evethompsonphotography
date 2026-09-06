// GET /shop/p/:id[-slug]/
// Server-rendered, crawlable landing page for a single product -- built so
// search engines (and anyone sharing a link) see a real page with the
// product's own title, description, price, and Product/Offer structured
// data, instead of only the single dynamic /shop/ page that renders every
// product client-side from a JS fetch (which has no per-product URL at
// all -- see shop/shop.js).
//
// The :id segment may carry a "-slug" suffix for a readable URL (e.g.
// /shop/p/104-gentle-souls-canvas/) -- only the numeric prefix before the
// first "-" is used to look the product up; the slug itself is decorative
// and regenerated from the live product name, never trusted from the URL.
//
// Buying still happens on the real shop: the "Shop this design" button
// links to /shop/?product=<id>, which shop.js opens straight into that
// product's variant-picker modal (see loadProducts() in shop/shop.js).

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Kept in sync with productSlug() in shop/shop.js -- both need to agree on
// the URL a given product name produces.
function productSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function onRequestGet({ params, request }) {
  const rawId = String(params.id || "");
  const numericId = rawId.split("-")[0];
  const origin = new URL(request.url).origin;

  let products = [];
  try {
    const apiRes = await fetch(`${origin}/api/products`);
    if (apiRes.ok) {
      const data = await apiRes.json();
      products = data.products || [];
    }
  } catch {
    // fall through -- product will be treated as not-found below
  }

  const product = products.find((p) => String(p.id) === numericId);
  if (!product || !product.variants || product.variants.length === 0) {
    return new Response("Product not found.", { status: 404 });
  }

  const slug = productSlug(product.name);
  const canonicalPath = `/shop/p/${product.id}-${slug}/`;
  const canonicalUrl = `${origin}${canonicalPath}`;

  // A stale or hand-typed slug (or the bare numeric id) redirects to the
  // canonical URL rather than serving duplicate content at two paths.
  if (rawId !== `${product.id}-${slug}`) {
    return Response.redirect(canonicalUrl, 301);
  }

  const prices = product.variants.map((v) => parseFloat(v.retail_price));
  const cheapest = Math.min(...prices);
  const highest = Math.max(...prices);
  const pricesVary = highest > cheapest;
  const priceLabel = pricesVary ? `From $${cheapest.toFixed(2)}` : `$${cheapest.toFixed(2)}`;
  const currency = product.variants[0]?.currency || "USD";
  const images = (product.images && product.images.length ? product.images : [product.thumbnail]).filter(Boolean);
  const primaryImage = images[0] || "";

  const descriptionText = (product.description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const metaDescription = (
    descriptionText || `${product.name}, printed on demand from Eve Thompson's photography and shipped to your door.`
  ).slice(0, 155);

  const inStock = product.variants.some((v) => v.in_stock);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: images,
    description: metaDescription,
    url: canonicalUrl,
    offers: {
      "@type": pricesVary ? "AggregateOffer" : "Offer",
      priceCurrency: currency,
      ...(pricesVary ? { lowPrice: cheapest.toFixed(2), highPrice: highest.toFixed(2) } : { price: cheapest.toFixed(2) }),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: canonicalUrl,
    },
  };

  const galleryHtml = images
    .map((src) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" loading="lazy" class="product-page__img" />`)
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(product.name)} — Eve Thompson Photography</title>
<meta name="description" content="${escapeHtml(metaDescription)}" />
<link rel="canonical" href="${canonicalUrl}" />
<link rel="icon" href="/assets/images/favicon.png" type="image/png" />
<meta property="og:type" content="product" />
<meta property="og:title" content="${escapeHtml(product.name)} — Eve Thompson Photography" />
<meta property="og:description" content="${escapeHtml(metaDescription)}" />
<meta property="og:url" content="${canonicalUrl}" />
${primaryImage ? `<meta property="og:image" content="${escapeHtml(primaryImage)}" />` : ""}
<meta property="product:price:amount" content="${cheapest.toFixed(2)}" />
<meta property="product:price:currency" content="${currency}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/shop/shop.css" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header class="topbar">
<div class="topbar__brand">Eve Thompson Photography</div>
<nav class="topbar__nav">
<a href="https://evethompsonphotography.com/" class="topbar__navlink">Home</a>
<a href="https://evethompsonphotography.com/public-gallery.html" class="topbar__navlink">Public Gallery</a>
<a href="https://evethompsonphotography.com/book.html" class="topbar__navlink">Book a Session</a>
<a href="/shop/" class="topbar__navlink">Shop</a>
</nav>
</header>

<main class="narrow-page product-page">
<nav class="product-page__breadcrumb"><a href="/shop/">Shop</a> / ${escapeHtml(product.name)}</nav>
<div class="product-page__gallery">
${galleryHtml}
</div>
<h1 class="narrow-page__title">${escapeHtml(product.name)}</h1>
<p class="product-page__price">${escapeHtml(priceLabel)}</p>
${descriptionText ? `<p class="narrow-page__intro">${escapeHtml(descriptionText)}</p>` : ""}
<a href="/shop/?product=${product.id}" class="form-submit-btn product-page__cta">Shop this design</a>
</main>

<footer class="home-footer">
<nav class="home-footer__nav">
<a href="https://evethompsonphotography.com/">Home</a>
<a href="https://evethompsonphotography.com/public-gallery.html">Public Gallery</a>
<a href="https://evethompsonphotography.com/book.html">Book a Session</a>
<a href="/shop/">Shop</a>
</nav>
<p class="home-footer__copyright">All content Copyright &copy; ${new Date().getFullYear()} Eve Thompson Photography</p>
</footer>
</body>
</html>
`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=600" },
  });
}

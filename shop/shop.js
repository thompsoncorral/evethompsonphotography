// Storefront logic: fetch products, manage cart (localStorage), fetch live
// shipping rates, and hand off to Stripe Checkout. All the sensitive work
// (talking to Printful, talking to Stripe with a secret key) happens in the
// /api/* functions -- this file only ever calls its own site's API.

const CART_KEY = "etp_cart_v1";
let PRODUCTS = []; // cache of what /api/products returned
let selectedRate = null;
let activeFilter = "all";

// ---------- categorization ----------
// The Printful sync API (see functions/api/products.js) doesn't return a
// clean "product type" field, so we group products by matching keywords in
// their name.
//
// Matching priority and display order are deliberately separate:
//   - MATCH priority goes narrow-to-broad, so a specific product type (e.g.
//     "pillow") always wins over a broad material/style word that might
//     also appear in its name (e.g. a "Canvas Throw Pillow" should land in
//     Pillows, not Canvas Prints). "canvas" is checked last for this reason.
//   - DISPLAY order is independent of match order -- Canvas Prints is
//     pinned to the front regardless of where its rule sits in the match
//     list.
// Anything that matches no rule falls into "Other" so new catalog items
// never disappear, they just show up uncategorized until a rule is added.
const CATEGORY_LABELS = {
  canvas: "Canvas Prints",
  "playing-cards": "Playing Cards",
  pillows: "Pillows",
  "framed-prints": "Framed Prints",
  posters: "Posters & Art Prints",
  mugs: "Mugs",
  apparel: "Apparel",
  bags: "Bags & Totes",
  backpacks: "Backpacks",
  "phone-cases": "Phone Cases",
  "cards-stationery": "Cards & Stationery",
  "luggage-tags": "Luggage Tags",
  "mouse-pads": "Mouse Pads",
  other: "Other",
};

// ---------- story banners ----------
// A handful of categories get a themed banner image woven into the page to
// give the shop more of a narrative feel. Two flavors:
//   - pinned: true  -- the category becomes an always-visible "story"
//     section (currently just Backpacks): it's pulled out of normal
//     filtering entirely, left out of the category dropdown, and always
//     shown regardless of which filter is active. Give it a spot near the
//     end of CATEGORY_DISPLAY_ORDER so it settles at the bottom of the page.
//   - pinned not set (or false) -- an ordinary divider banner attached to a
//     still-fully-filterable category (currently Canvas Prints): it shows
//     and hides together with that category's own section, it just also
//     stays in the dropdown like normal.
// `position` controls whether the banner renders above ("before", the
// default) or below ("after") the category's product section.
// To add another one: drop the banner image in shop/banners/, add an entry
// below, and (if pinned) give its category key a spot near the end of
// CATEGORY_DISPLAY_ORDER.
const STORY_BANNERS = {
  backpacks: {
    src: "banners/backpacks-banner.png",
    alt: "Some moments are meant to be witnessed. Others are meant to be remembered.",
    position: "before",
    pinned: true,
  },
  canvas: {
    src: "banners/canvas-banner.png",
    alt: "The beauty was already there. I simply captured it.",
    position: "after",
  },
};

const CATEGORY_MATCH_ORDER = [
  { key: "playing-cards", test: /playing cards?/i },
  { key: "pillows", test: /pillow|cushion/i },
  { key: "mugs", test: /\bmug\b/i },
  { key: "apparel", test: /\b(t-?shirt|hoodie|sweatshirt|tee)\b/i },
  { key: "luggage-tags", test: /luggage tag/i },
  { key: "mouse-pads", test: /mouse ?pad|mouse mat/i },
  { key: "phone-cases", test: /phone case|magsafe|case for i?phone/i },
  { key: "backpacks", test: /backpack/i },
  { key: "bags", test: /\btote\b|\bbag\b/i },
  { key: "cards-stationery", test: /greeting card|postcard|notebook|stationery/i },
  { key: "framed-prints", test: /framed print|\bframe\b/i },
  { key: "posters", test: /poster|art print|fine art|matte print/i },
  { key: "canvas", test: /canvas/i }, // broad material word -- keep last
];

const CATEGORY_DISPLAY_ORDER = [
  "canvas",
  "mouse-pads",
  "luggage-tags",
  "phone-cases",
  "pillows",
  "playing-cards",
  "framed-prints",
  "posters",
  "mugs",
  "apparel",
  "bags",
  "cards-stationery",
  "other",
  // Story-banner categories (see STORY_BANNERS) go last -- always the
  // bottom-most section on the page, banner and all.
  "backpacks",
];

function getCategoryKey(productName) {
  const rule = CATEGORY_MATCH_ORDER.find((r) => r.test.test(productName));
  return rule ? rule.key : "other";
}

function groupByCategory(products) {
  const groups = new Map();
  for (const product of products) {
    const key = getCategoryKey(product.name);
    if (!groups.has(key)) groups.set(key, { label: CATEGORY_LABELS[key] || key, products: [] });
    groups.get(key).products.push(product);
  }
  // Render in CATEGORY_DISPLAY_ORDER, skipping any category with no products.
  const ordered = [];
  for (const key of CATEGORY_DISPLAY_ORDER) {
    if (groups.has(key)) ordered.push({ key, ...groups.get(key) });
  }
  return ordered;
}

// ---------- cart storage ----------

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCart();
}

function addToCart(variant, productName, quantity) {
  const cart = loadCart();
  const existing = cart.find((line) => line.variant_id === variant.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({
      variant_id: variant.id,
      name: `${productName} — ${variant.name}`,
      price: parseFloat(variant.retail_price),
      image: variant.image,
      quantity,
    });
  }
  saveCart(cart);
  openCart();
}

function updateQuantity(variantId, quantity) {
  let cart = loadCart();
  if (quantity <= 0) {
    cart = cart.filter((l) => l.variant_id !== variantId);
  } else {
    const line = cart.find((l) => l.variant_id === variantId);
    if (line) line.quantity = quantity;
  }
  saveCart(cart);
}

// ---------- rendering ----------

function money(n) {
  return `$${n.toFixed(2)}`;
}

function productCardHTML(product) {
  const prices = product.variants.map((v) => parseFloat(v.retail_price));
  const cheapest = Math.min(...prices);
  // "From $X" only makes sense when picking a different option actually
  // changes the price -- e.g. canvas prints cost more in larger sizes. A
  // product like a t-shirt has multiple size variants but they're all the
  // same price, so comparing min vs. max (not just counting variants)
  // catches that case and shows the plain price instead.
  const pricesVary = Math.max(...prices) > cheapest;
  const priceLabel = pricesVary ? `From ${money(cheapest)}` : money(cheapest);
  // Some products have more than one real photo (e.g. a front + back
  // mockup, or several mockup styles picked in the Printful dashboard) --
  // when that's the case, hint at it with a small badge so the product grid
  // reads a bit more like a real store instead of one flat thumbnail each.
  const galleryCount = product.images ? product.images.length : 0;
  const badge = galleryCount > 1 ? `<span class="product-image-badge">${galleryCount} photos</span>` : "";
  return `
    <article class="product-card">
      <div class="product-image-wrap">
        <img src="${product.thumbnail || ""}" alt="${product.name}" loading="lazy" class="product-image" data-product-id="${product.id}" />
        ${badge}
      </div>
      <h3>${product.name}</h3>
      <p class="product-price">${priceLabel}</p>
      <button class="secondary-btn choose-btn" data-product-id="${product.id}">Choose options</button>
    </article>
  `;
}

// ---------- image lightbox ----------
// Supports a single image (the common case) or a small gallery with
// prev/next arrows, when a product has more than one real photo.

let lightboxImages = [];
let lightboxIndex = 0;

function openLightbox(images, startIndex, alt) {
  lightboxImages = (images || []).filter(Boolean);
  if (lightboxImages.length === 0) return;
  lightboxIndex = Math.max(0, Math.min(startIndex || 0, lightboxImages.length - 1));
  showLightboxImage(alt);
  document.getElementById("image-lightbox").hidden = false;
}

function showLightboxImage(alt) {
  const img = document.getElementById("lightbox-img");
  img.src = lightboxImages[lightboxIndex];
  if (alt !== undefined) img.alt = alt || "";
  const multi = lightboxImages.length > 1;
  document.getElementById("lightbox-prev").hidden = !multi;
  document.getElementById("lightbox-next").hidden = !multi;
}

function showPrevImage() {
  if (lightboxImages.length < 2) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
  showLightboxImage();
}

function showNextImage() {
  if (lightboxImages.length < 2) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
  showLightboxImage();
}

function closeLightbox() {
  document.getElementById("image-lightbox").hidden = true;
  document.getElementById("lightbox-img").src = "";
  lightboxImages = [];
}

function renderFilters(groups) {
  const bar = document.getElementById("shop-filters");
  // Pinned story-banner categories (see STORY_BANNERS) are always-visible
  // sections -- they're never filterable, so they're left out of the
  // dropdown and don't count toward whether the dropdown is worth showing.
  // A non-pinned story banner (e.g. Canvas Prints) stays a normal,
  // filterable category and is NOT excluded here.
  const filterable = groups.filter((g) => !STORY_BANNERS[g.key]?.pinned);
  if (filterable.length <= 1) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  bar.hidden = false;

  // The dropdown's own option order is alphabetical by label, independent of
  // CATEGORY_DISPLAY_ORDER (which controls the order the product sections
  // appear on the page). "All" is pinned to the top since it doesn't
  // meaningfully sort alongside category names.
  const alphabetized = [...filterable].sort((a, b) => a.label.localeCompare(b.label));
  const options = [{ key: "all", label: "All" }, ...alphabetized];

  bar.innerHTML = `
    <label class="category-filter-label" for="category-filter">Category</label>
    <select id="category-filter" class="category-filter">
      ${options
        .map(
          (o) =>
            `<option value="${o.key}"${o.key === activeFilter ? " selected" : ""}>${o.label}</option>`
        )
        .join("")}
    </select>
  `;

  document.getElementById("category-filter").addEventListener("change", (e) => {
    activeFilter = e.target.value;
    applyFilter();
  });
}

function applyFilter() {
  // Story banners (see STORY_BANNERS) carry the same data-category as the
  // section they belong to, so a divider banner (e.g. Canvas Prints' "after"
  // banner) hides and shows right along with its section.
  document.querySelectorAll(".product-row-section, .story-banner").forEach((el) => {
    const category = el.dataset.category;
    // Pinned story categories (see STORY_BANNERS) are always visible
    // regardless of which filter is active.
    if (STORY_BANNERS[category]?.pinned) {
      el.hidden = false;
      return;
    }
    el.hidden = activeFilter !== "all" && category !== activeFilter;
  });
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  if (PRODUCTS.length === 0) {
    document.getElementById("shop-filters").hidden = true;
    grid.innerHTML = `<p class="loading">No products found yet — add some in your Printful dashboard.</p>`;
    return;
  }

  const groups = groupByCategory(PRODUCTS);
  renderFilters(groups);

  grid.innerHTML = groups
    .map((group) => {
      const banner = STORY_BANNERS[group.key];
      const bannerImg = banner
        ? `<img src="${banner.src}" alt="${banner.alt}" class="story-banner" data-category="${group.key}" loading="lazy" />`
        : "";
      const beforeHTML = banner && banner.position !== "after" ? bannerImg : "";
      const afterHTML = banner && banner.position === "after" ? bannerImg : "";
      return `
      ${beforeHTML}
      <section class="product-row-section" data-category="${group.key}">
        <h2 class="product-row-heading">${group.label}</h2>
        <div class="product-row">
          ${group.products.map(productCardHTML).join("")}
        </div>
      </section>
      ${afterHTML}`;
    })
    .join("");

  applyFilter();

  grid.querySelectorAll(".choose-btn").forEach((btn) => {
    btn.addEventListener("click", () => openVariantModal(btn.dataset.productId));
  });

  grid.querySelectorAll(".product-image").forEach((img) => {
    img.addEventListener("click", () => {
      const product = PRODUCTS.find((p) => String(p.id) === String(img.dataset.productId));
      const images = product && product.images && product.images.length ? product.images : [img.src];
      openLightbox(images, 0, img.alt);
    });
  });
}

function renderCart() {
  const cart = loadCart();
  const container = document.getElementById("cart-items");
  const countEl = document.getElementById("cart-count");
  const subtotalEl = document.getElementById("cart-subtotal-amount");
  const checkoutBtn = document.getElementById("checkout-btn");
  const shippingSection = document.getElementById("shipping-section");

  countEl.textContent = cart.reduce((sum, l) => sum + l.quantity, 0);

  if (cart.length === 0) {
    container.innerHTML = `<p class="cart-empty">Your cart is empty.</p>`;
    subtotalEl.textContent = money(0);
    shippingSection.hidden = true;
    checkoutBtn.disabled = true;
    return;
  }

  container.innerHTML = cart
    .map(
      (line) => `
      <div class="cart-line" data-variant-id="${line.variant_id}">
        <img src="${line.image || ""}" alt="" />
        <div class="cart-line-info">
          <p class="cart-line-name">${line.name}</p>
          <p class="cart-line-price">${money(line.price)} each</p>
          <div class="qty-controls">
            <button class="qty-btn" data-delta="-1">-</button>
            <span>${line.quantity}</span>
            <button class="qty-btn" data-delta="1">+</button>
            <button class="remove-btn" title="Remove">Remove</button>
          </div>
        </div>
      </div>`
    )
    .join("");

  const subtotal = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
  subtotalEl.textContent = money(subtotal);

  container.querySelectorAll(".cart-line").forEach((lineEl) => {
    const variantId = Number(lineEl.dataset.variantId);
    const line = cart.find((l) => l.variant_id === variantId);
    lineEl.querySelectorAll(".qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        updateQuantity(variantId, line.quantity + Number(btn.dataset.delta));
      });
    });
    lineEl.querySelector(".remove-btn").addEventListener("click", () => {
      updateQuantity(variantId, 0);
    });
  });

  shippingSection.hidden = false;
  // Any cart change invalidates a previously-picked shipping rate.
  selectedRate = null;
  document.getElementById("rates-list").hidden = true;
  document.getElementById("phone-required-note").hidden = true;
  checkoutBtn.disabled = true;
}

// ---------- cart drawer open/close ----------

function openCart() {
  document.getElementById("cart-drawer").classList.add("open");
  document.getElementById("cart-overlay").hidden = false;
}
function closeCart() {
  document.getElementById("cart-drawer").classList.remove("open");
  document.getElementById("cart-overlay").hidden = true;
}

// ---------- variant modal ----------

function openVariantModal(productId) {
  const product = PRODUCTS.find((p) => String(p.id) === String(productId));
  if (!product) return;

  const modal = document.getElementById("variant-modal");
  document.getElementById("variant-modal-title").textContent = product.name;
  document.getElementById("variant-modal-image").src = product.thumbnail || "";
  const select = document.getElementById("variant-select");
  select.innerHTML = product.variants
    .map((v) => `<option value="${v.id}">${v.name} — ${money(parseFloat(v.retail_price))}</option>`)
    .join("");

  function updatePrice() {
    const v = product.variants.find((v) => String(v.id) === select.value);
    document.getElementById("variant-price").textContent = money(parseFloat(v.retail_price));
    document.getElementById("variant-modal-image").src = v.image || product.thumbnail || "";
  }
  select.onchange = updatePrice;
  updatePrice();

  // Printful's own material/fit/care description for the blank product --
  // generic to the item, not specific to this design, so it's tucked away
  // as an expandable "Product details" rather than shown up front. Not
  // every product has one (best-effort lookup server-side), so hide the
  // whole section when there's nothing to show.
  const detailsEl = document.getElementById("variant-details");
  const detailsBody = document.getElementById("variant-details-body");
  if (product.description) {
    detailsBody.innerHTML = product.description;
    detailsEl.hidden = false;
    detailsEl.open = false;
  } else {
    detailsBody.innerHTML = "";
    detailsEl.hidden = true;
  }

  document.getElementById("variant-qty").value = 1;
  document.getElementById("variant-add-btn").onclick = () => {
    const v = product.variants.find((v) => String(v.id) === select.value);
    const qty = Math.max(1, Number(document.getElementById("variant-qty").value));
    addToCart(v, product.name, qty);
    modal.hidden = true;
  };

  modal.hidden = false;
}

// ---------- shipping + checkout ----------

// Express/expedited carrier services (UPS, FedEx, DHL, etc.) generally
// require a recipient phone number -- Printful's order API rejects the
// order without one, which would otherwise only surface *after* the
// customer has already paid via Stripe. Phone stays optional for standard
// shipping and is only enforced when a rate like this is actually chosen.
function isExpressRate(rate) {
  return /express|expedited|priority|overnight|next[- ]?day|rush/i.test((rate && rate.name) || "");
}

function currentPhoneValue() {
  const input = document.querySelector('#shipping-form input[name="phone"]');
  return input ? input.value.trim() : "";
}

// Keeps the checkout button + warning note in sync with both the selected
// rate and whatever's currently typed in the phone field (not just whatever
// was in the form the last time "Check shipping cost" was submitted).
function updateCheckoutAvailability() {
  const note = document.getElementById("phone-required-note");
  const checkoutBtn = document.getElementById("checkout-btn");

  if (!selectedRate) {
    checkoutBtn.disabled = true;
    note.hidden = true;
    return;
  }

  const needsPhone = isExpressRate(selectedRate) && !currentPhoneValue();
  note.hidden = !needsPhone;
  checkoutBtn.disabled = needsPhone;
}

async function handleShippingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const recipient = Object.fromEntries(new FormData(form).entries());
  window.__recipient = recipient; // stashed for the checkout call

  const btn = document.getElementById("get-rates-btn");
  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    const cart = loadCart();
    const res = await fetch("/api/shipping-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient,
        items: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not fetch shipping rates");

    const list = document.getElementById("rates-list");
    list.hidden = false;
    list.innerHTML = data.rates
      .map(
        (r, i) => `
        <label class="rate-option">
          <input type="radio" name="rate" value="${r.id}" ${i === 0 ? "checked" : ""} />
          ${r.name} — ${money(parseFloat(r.rate))}
        </label>`
      )
      .join("");

    selectedRate = data.rates[0] || null;
    updateCheckoutAvailability();

    list.querySelectorAll('input[name="rate"]').forEach((input) => {
      input.addEventListener("change", () => {
        selectedRate = data.rates.find((r) => r.id === input.value);
        updateCheckoutAvailability();
      });
    });
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Check shipping cost";
  }
}

async function handleCheckout() {
  const cart = loadCart();
  if (cart.length === 0 || !selectedRate || !window.__recipient) return;

  // Refresh phone from the live field (not just whatever was in the form
  // the last time "Check shipping cost" was submitted) and re-check --
  // the button should already be disabled in this case, but don't rely on
  // that alone for something that would otherwise fail only after payment.
  window.__recipient.phone = currentPhoneValue();
  if (isExpressRate(selectedRate) && !window.__recipient.phone) {
    updateCheckoutAvailability();
    return;
  }

  const btn = document.getElementById("checkout-btn");
  btn.disabled = true;
  btn.textContent = "Redirecting to payment…";

  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
        shipping_id: selectedRate.id,
        recipient: window.__recipient,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed");
    window.location.href = data.url;
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = "Continue to payment";
  }
}

// ---------- init ----------

async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load products");
    PRODUCTS = data.products || [];
    renderProducts();
  } catch (err) {
    document.getElementById("load-error").hidden = false;
    document.getElementById("load-error").textContent =
      "Couldn't load products right now. Please refresh, or check back shortly.";
    document.getElementById("product-grid").innerHTML = "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  renderCart();

  document.getElementById("cart-toggle").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("variant-modal-close").addEventListener("click", () => {
    document.getElementById("variant-modal").hidden = true;
  });
  document.getElementById("shipping-form").addEventListener("submit", handleShippingSubmit);
  document.getElementById("checkout-btn").addEventListener("click", handleCheckout);
  document
    .querySelector('#shipping-form input[name="phone"]')
    .addEventListener("input", updateCheckoutAvailability);

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-prev").addEventListener("click", (e) => {
    e.stopPropagation();
    showPrevImage();
  });
  document.getElementById("lightbox-next").addEventListener("click", (e) => {
    e.stopPropagation();
    showNextImage();
  });
  document.getElementById("image-lightbox").addEventListener("click", (e) => {
    // Clicking the dark backdrop (not the image itself) also closes it.
    if (e.target.id === "image-lightbox") closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (document.getElementById("image-lightbox").hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") showPrevImage();
    if (e.key === "ArrowRight") showNextImage();
  });

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  if (new URLSearchParams(window.location.search).get("canceled")) {
    document.getElementById("load-error").hidden = false;
    document.getElementById("load-error").textContent = "Checkout was canceled — your cart is still here.";
  }
});

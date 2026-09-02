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
  "cards-stationery": "Cards & Stationery",
  "luggage-tags": "Luggage Tags",
  "mouse-pads": "Mouse Pads",
  other: "Other",
};

const CATEGORY_MATCH_ORDER = [
  { key: "playing-cards", test: /playing cards?/i },
  { key: "pillows", test: /pillow|cushion/i },
  { key: "mugs", test: /\bmug\b/i },
  { key: "apparel", test: /\b(t-?shirt|hoodie|sweatshirt|tee)\b/i },
  { key: "luggage-tags", test: /luggage tag/i },
  { key: "mouse-pads", test: /mouse ?pad|mouse mat/i },
  { key: "bags", test: /\btote\b|\bbag\b/i },
  { key: "cards-stationery", test: /greeting card|postcard|notebook|stationery/i },
  { key: "framed-prints", test: /framed print|\bframe\b/i },
  { key: "posters", test: /poster|art print|fine art|matte print/i },
  { key: "canvas", test: /canvas/i }, // broad material word -- keep last
];

const CATEGORY_DISPLAY_ORDER = [
  "canvas",
  "playing-cards",
  "pillows",
  "framed-prints",
  "posters",
  "mugs",
  "apparel",
  "bags",
  "cards-stationery",
  "luggage-tags",
  "mouse-pads",
  "other",
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
  const cheapest = Math.min(...product.variants.map((v) => parseFloat(v.retail_price)));
  return `
    <article class="product-card">
      <img src="${product.thumbnail || ""}" alt="${product.name}" loading="lazy" class="product-image" />
      <h3>${product.name}</h3>
      <p class="product-price">From ${money(cheapest)}</p>
      <button class="secondary-btn choose-btn" data-product-id="${product.id}">Choose options</button>
    </article>
  `;
}

// ---------- image lightbox ----------

function openLightbox(src, alt) {
  if (!src) return;
  document.getElementById("lightbox-img").src = src;
  document.getElementById("lightbox-img").alt = alt || "";
  document.getElementById("image-lightbox").hidden = false;
}

function closeLightbox() {
  document.getElementById("image-lightbox").hidden = true;
  document.getElementById("lightbox-img").src = "";
}

function renderFilters(groups) {
  const bar = document.getElementById("shop-filters");
  if (groups.length <= 1) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  bar.hidden = false;
  const pills = [{ key: "all", label: "All" }, ...groups.map((g) => ({ key: g.key, label: g.label }))];
  bar.innerHTML = pills
    .map(
      (p) => `
      <button
        type="button"
        class="filter-pill${p.key === activeFilter ? " active" : ""}"
        data-filter="${p.key}"
        aria-pressed="${p.key === activeFilter}"
      >${p.label}</button>`
    )
    .join("");

  bar.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      applyFilter();
      bar.querySelectorAll(".filter-pill").forEach((b) => {
        const isActive = b.dataset.filter === activeFilter;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", String(isActive));
      });
    });
  });
}

function applyFilter() {
  document.querySelectorAll(".product-row-section").forEach((section) => {
    section.hidden = activeFilter !== "all" && section.dataset.category !== activeFilter;
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
    .map(
      (group) => `
      <section class="product-row-section" data-category="${group.key}">
        <h2 class="product-row-heading">${group.label}</h2>
        <div class="product-row">
          ${group.products.map(productCardHTML).join("")}
        </div>
      </section>`
    )
    .join("");

  applyFilter();

  grid.querySelectorAll(".choose-btn").forEach((btn) => {
    btn.addEventListener("click", () => openVariantModal(btn.dataset.productId));
  });

  grid.querySelectorAll(".product-image").forEach((img) => {
    img.addEventListener("click", () => openLightbox(img.src, img.alt));
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
    document.getElementById("checkout-btn").disabled = !selectedRate;

    list.querySelectorAll('input[name="rate"]').forEach((input) => {
      input.addEventListener("change", () => {
        selectedRate = data.rates.find((r) => r.id === input.value);
        document.getElementById("checkout-btn").disabled = !selectedRate;
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

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("image-lightbox").addEventListener("click", (e) => {
    // Clicking the dark backdrop (not the image itself) also closes it.
    if (e.target.id === "image-lightbox") closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("image-lightbox").hidden) {
      closeLightbox();
    }
  });

  if (new URLSearchParams(window.location.search).get("canceled")) {
    document.getElementById("load-error").hidden = false;
    document.getElementById("load-error").textContent = "Checkout was canceled — your cart is still here.";
  }
});

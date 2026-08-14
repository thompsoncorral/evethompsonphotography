/* Gallery page: cover hero -> masonry grid -> lightbox -> buy modal.
   Reads a single gallery's data from data/galleries.json based on the
   ?g=<slug> query parameter. */

(function () {
  const params = new URLSearchParams(location.search);
  const slug = params.get("g");

  const favKey = (gallerySlug) => `favorites:${gallerySlug}`;

  function getFavorites(gallerySlug) {
    try {
      return JSON.parse(localStorage.getItem(favKey(gallerySlug)) || "[]");
    } catch {
      return [];
    }
  }

  function setFavorites(gallerySlug, ids) {
    localStorage.setItem(favKey(gallerySlug), JSON.stringify(ids));
  }

  function toggleFavorite(gallerySlug, photoId) {
    const favs = getFavorites(gallerySlug);
    const idx = favs.indexOf(photoId);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(photoId);
    setFavorites(gallerySlug, favs);
    return favs;
  }

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  async function loadData() {
    const res = await fetch("data/galleries.json");
    if (!res.ok) throw new Error("Could not load data/galleries.json");
    return res.json();
  }

  (async function init() {
    let data;
    try {
      data = await loadData();
    } catch (err) {
      document.body.innerHTML = `<p style="padding:40px;color:#b3432b;">${err.message}</p>`;
      return;
    }

    const gallery = (data.galleries || []).find((g) => g.slug === slug) || data.galleries[0];
    if (!gallery) {
      document.body.innerHTML = `<p style="padding:40px;">No gallery found. Check the <code>?g=</code> link or data/galleries.json.</p>`;
      return;
    }

    const priceSheet = (data.priceSheets && data.priceSheets[gallery.priceSheet]) || {};
    const studioName = (data.studio && data.studio.name) || "";
    document.title = `${gallery.title} -- ${studioName}`;

    function renderGallery() {
    // ---- Hero ----
    const hero = document.getElementById("hero");
    hero.style.backgroundImage = `url(${gallery.cover})`;
    document.getElementById("heroTitle").textContent = gallery.title;
    document.getElementById("heroStudio").textContent = (data.studio && data.studio.logoText) || studioName;
    document.getElementById("navTitle").textContent = gallery.title.toUpperCase();
    document.getElementById("navStudio").textContent = (data.studio && data.studio.logoText) || studioName;
    document.getElementById("backLink").href = "collections.html";

    if (gallery.storeEnabled) {
      const storeLink = document.getElementById("storeLink");
      storeLink.style.display = "inline-flex";
      storeLink.addEventListener("click", (e) => {
        e.preventDefault();
        openBuyModal(photos[currentIndex]);
      });
    }

    if (gallery.downloadEnabled) {
      document.getElementById("downloadBanner").style.display = "flex";
    }

    // ---- Reveal grid ----
    const galleryNav = document.getElementById("galleryNav");
    const masonry = document.getElementById("masonry");
    const backLink = document.getElementById("backLink");

    document.getElementById("viewGalleryBtn").addEventListener("click", () => {
      hero.style.display = "none";
      galleryNav.classList.add("is-visible");
      masonry.classList.add("is-visible");
      backLink.style.display = "flex";
      window.scrollTo(0, 0);
    });

    // ---- Render tiles ----
    const photos = gallery.photos;
    masonry.innerHTML = photos
      .map(
        (p, i) => `
      <div class="tile" data-index="${i}">
        <img src="${p.thumb}" alt="${p.filename}" loading="lazy" data-index="${i}" />
        <div class="tile__overlay">
          ${gallery.storeEnabled ? `<button class="tile__icon tile-buy" data-index="${i}" title="Buy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L4 3H2"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg></button>` : ""}
          ${gallery.favoritesEnabled ? `<button class="tile__icon tile-fav" data-index="${i}" data-id="${p.id}" title="Favorite"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.5-4.6-10-9.3C.6 8 2 4 6 4c2.2 0 3.7 1.2 6 3.6C14.3 5.2 15.8 4 18 4c4 0 5.4 4 4 7.7C19.5 16.4 12 21 12 21z"/></svg></button>` : ""}
          <button class="tile__icon tile-share" data-index="${i}" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg></button>
        </div>
      </div>`
      )
      .join("");

    function refreshFavIcons() {
      const favs = new Set(getFavorites(gallery.slug));
      document.querySelectorAll(".tile-fav").forEach((btn) => {
        btn.classList.toggle("is-active", favs.has(btn.dataset.id));
      });
      document.getElementById("favCount").textContent = favs.size;
    }
    refreshFavIcons();

    masonry.addEventListener("click", (e) => {
      const img = e.target.closest("img[data-index]");
      const buyBtn = e.target.closest(".tile-buy");
      const favBtn = e.target.closest(".tile-fav");
      const shareBtn = e.target.closest(".tile-share");

      if (buyBtn) {
        openBuyModal(photos[Number(buyBtn.dataset.index)]);
        return;
      }
      if (favBtn) {
        toggleFavorite(gallery.slug, favBtn.dataset.id);
        refreshFavIcons();
        return;
      }
      if (shareBtn) {
        sharePhoto(photos[Number(shareBtn.dataset.index)]);
        return;
      }
      if (img) {
        openLightbox(Number(img.dataset.index));
      }
    });

    document.getElementById("favCountBtn").addEventListener("click", () => {
      const favs = getFavorites(gallery.slug);
      showToast(favs.length ? `${favs.length} favorite${favs.length === 1 ? "" : "s"} in this browser.` : "No favorites yet -- click the heart on a photo.");
    });

    document.getElementById("shareBtn").addEventListener("click", () => shareUrl(location.href, gallery.title));

    // ---- Lightbox ----
    const lightbox = document.getElementById("lightbox");
    const lbImage = document.getElementById("lbImage");
    const lbCaption = document.getElementById("lbCaption");
    const lbFavBtn = document.getElementById("lbFavBtn");
    const lbDownloadBtn = document.getElementById("lbDownloadBtn");
    const lbBuyBtn = document.getElementById("lbBuyBtn");
    let currentIndex = 0;
    let slideshowTimer = null;

    function renderLightbox() {
      const p = photos[currentIndex];
      lbImage.src = p.full;
      lbImage.alt = p.filename;
      lbCaption.textContent = p.filename;
      const favs = new Set(getFavorites(gallery.slug));
      lbFavBtn.classList.toggle("is-active", favs.has(p.id));

      if (gallery.downloadEnabled) {
        lbDownloadBtn.style.display = "inline-flex";
        lbDownloadBtn.href = p.full;
        lbDownloadBtn.setAttribute("download", p.filename);
      } else {
        lbDownloadBtn.style.display = "none";
      }
      lbBuyBtn.style.display = gallery.storeEnabled ? "inline-flex" : "none";
    }

    function openLightbox(index) {
      currentIndex = index;
      renderLightbox();
      lightbox.classList.add("is-open");
      document.body.style.overflow = "hidden";
    }

    function closeLightbox() {
      lightbox.classList.remove("is-open");
      document.body.style.overflow = "";
      stopSlideshow();
    }

    function step(delta) {
      currentIndex = (currentIndex + delta + photos.length) % photos.length;
      renderLightbox();
    }

    function startSlideshow() {
      stopSlideshow();
      slideshowTimer = setInterval(() => step(1), 3000);
    }

    function stopSlideshow() {
      if (slideshowTimer) clearInterval(slideshowTimer);
      slideshowTimer = null;
    }

    document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
    document.getElementById("lbPrev").addEventListener("click", () => step(-1));
    document.getElementById("lbNext").addEventListener("click", () => step(1));
    document.getElementById("lbFavBtn").addEventListener("click", () => {
      toggleFavorite(gallery.slug, photos[currentIndex].id);
      renderLightbox();
      refreshFavIcons();
    });
    document.getElementById("lbShareBtn").addEventListener("click", () => sharePhoto(photos[currentIndex]));
    document.getElementById("lbBuyBtn").addEventListener("click", () => openBuyModal(photos[currentIndex]));

    let slideshowOn = false;
    function toggleSlideshow(btnId) {
      slideshowOn = !slideshowOn;
      if (slideshowOn) startSlideshow();
      else stopSlideshow();
      showToast(slideshowOn ? "Slideshow started" : "Slideshow paused");
    }
    document.getElementById("lbSlideshowBtn").addEventListener("click", () => toggleSlideshow());
    document.getElementById("slideshowBtn").addEventListener("click", () => {
      openLightbox(0);
      toggleSlideshow();
    });

    document.addEventListener("keydown", (e) => {
      if (!lightbox.classList.contains("is-open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });

    // ---- Share helpers ----
    function shareUrl(url, title) {
      if (navigator.share) {
        navigator.share({ title, url }).catch(() => {});
      } else {
        navigator.clipboard?.writeText(url);
        showToast("Link copied to clipboard");
      }
    }

    function sharePhoto(photo) {
      const url = `${location.origin}${location.pathname}?g=${gallery.slug}&photo=${photo.id}`;
      shareUrl(url, photo.filename);
    }

    // ---- Buy modal ----
    const buyBackdrop = document.getElementById("buyModalBackdrop");
    const buyModalImage = document.getElementById("buyModalImage");
    const buyList = document.getElementById("buyList");
    const buyTabs = document.getElementById("buyTabs");
    const visitStoreLink = document.getElementById("visitStoreLink");
    let activeTab = "prints";
    let buyPhoto = null;

    function renderBuyList() {
      const items = priceSheet[activeTab] || [];
      if (!items.length) {
        buyList.innerHTML = `<p class="note">No products configured for this category yet. Add them to data/galleries.json under priceSheets.default.${activeTab}.</p>`;
        return;
      }
      buyList.innerHTML = items
        .map(
          (item, i) => `
        <button class="price-row" data-tab="${activeTab}" data-i="${i}">
          <span>${item.label}</span>
          <span class="price-row__price">${item.price}</span>
        </button>`
        )
        .join("");
    }

    function openBuyModal(photo) {
      if (!gallery.storeEnabled) return;
      buyPhoto = photo;
      buyModalImage.src = photo.thumb;
      buyModalImage.alt = photo.filename;
      visitStoreLink.href = "#";
      renderBuyList();
      buyBackdrop.classList.add("is-open");
    }

    function closeBuyModal() {
      buyBackdrop.classList.remove("is-open");
    }

    document.getElementById("buyModalClose").addEventListener("click", closeBuyModal);
    buyBackdrop.addEventListener("click", (e) => {
      if (e.target === buyBackdrop) closeBuyModal();
    });

    buyTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".modal__tab");
      if (!tab) return;
      buyTabs.querySelectorAll(".modal__tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      activeTab = tab.dataset.tab;
      renderBuyList();
    });

    buyList.addEventListener("click", (e) => {
      const row = e.target.closest(".price-row");
      if (!row) return;
      const items = priceSheet[row.dataset.tab] || [];
      const item = items[Number(row.dataset.i)];
      if (!item) return;
      if (item.stripeLink) {
        // Tag the checkout with this photo's ID so we know which photo was
        // ordered when fulfilling manually -- see the Stripe payment's
        // client_reference_id (or the "Client reference ID" column/filter
        // in the Stripe Dashboard payments list).
        let checkoutUrl = item.stripeLink;
        if (buyPhoto && buyPhoto.id) {
          try {
            const url = new URL(checkoutUrl);
            url.searchParams.set("client_reference_id", buyPhoto.id);
            checkoutUrl = url.toString();
          } catch {
            const sep = checkoutUrl.includes("?") ? "&" : "?";
            checkoutUrl = `${checkoutUrl}${sep}client_reference_id=${encodeURIComponent(buyPhoto.id)}`;
          }
        }
        window.open(checkoutUrl, "_blank", "noopener");
      } else {
        showToast(`Add a Stripe Payment Link for "${item.label}" in data/galleries.json`);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && buyBackdrop.classList.contains("is-open")) closeBuyModal();
    });

    // Deep-link straight to a photo if ?photo= is present
    const photoParam = params.get("photo");
    if (photoParam) {
      const idx = photos.findIndex((p) => p.id === photoParam);
      if (idx >= 0) {
        document.getElementById("viewGalleryBtn").click();
        openLightbox(idx);
      }
    }
    } // end renderGallery()

    // ---- Keyword gate ----
    // A soft, client-side speed bump only: the keyword lives right in this
    // page's data/JS, so anyone who opens their browser's dev tools can read
    // it. It keeps casual visitors and search engines from landing on a
    // gallery you haven't shared widely -- it is NOT real access control.
    // See README.md > "Honest limitations" before relying on this for
    // anything sensitive.
    const gate = document.getElementById("gate");
    const unlockKey = `unlocked:${gallery.slug}`;

    if (gallery.keyword && gallery.keyword.trim() && localStorage.getItem(unlockKey) !== "1") {
      document.getElementById("gateLabel").textContent = (data.studio && data.studio.logoText) || studioName;
      document.getElementById("gateGalleryTitle").textContent = gallery.title;
      gate.classList.add("is-visible");
      document.getElementById("gateInput").focus();

      document.getElementById("gateForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const entered = document.getElementById("gateInput").value.trim().toLowerCase();
        const expected = gallery.keyword.trim().toLowerCase();
        const gateError = document.getElementById("gateError");
        if (entered === expected) {
          localStorage.setItem(unlockKey, "1");
          gate.classList.remove("is-visible");
          gateError.style.display = "none";
          renderGallery();
        } else {
          gateError.style.display = "block";
        }
      });
    } else {
      renderGallery();
    }
  })();
})();

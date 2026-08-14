/* Home page: renders the "Collections" grid from data/galleries.json */

async function loadData() {
  const res = await fetch("data/galleries.json");
  if (!res.ok) throw new Error("Could not load data/galleries.json");
  return res.json();
}

function collectionCard(gallery) {
  const count = gallery.photos.length;
  return `
    <a class="collection-card" href="gallery.html?g=${encodeURIComponent(gallery.slug)}">
      <div class="collection-card__thumb">
        <img src="${gallery.coverThumb || gallery.cover}" alt="${gallery.title} cover photo" loading="lazy" />
      </div>
      <div class="collection-card__title">${gallery.title}</div>
      <div class="collection-card__meta">
        <span class="dot"></span> ${count} item${count === 1 ? "" : "s"}
        ${gallery.eventDate ? ` &middot; ${gallery.eventDate}` : ""}
      </div>
    </a>
  `;
}

(async function init() {
  const grid = document.getElementById("collectionGrid");
  const emptyState = document.getElementById("emptyState");
  const searchInput = document.getElementById("searchInput");

  let data;
  try {
    data = await loadData();
  } catch (err) {
    grid.innerHTML = `<p style="color:#b3432b;">${err.message}</p>`;
    return;
  }

  if (data.studio && data.studio.name) {
    document.getElementById("brandName").textContent = data.studio.name;
    document.title = data.studio.name + " -- Collections";
  }

  const galleries = data.galleries || [];

  function render(list) {
    if (!list.length) {
      grid.style.display = "none";
      emptyState.style.display = "block";
      return;
    }
    grid.style.display = "grid";
    emptyState.style.display = "none";
    grid.innerHTML = list.map(collectionCard).join("");
  }

  render(galleries);

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = galleries.filter((g) => g.title.toLowerCase().includes(q));
    render(filtered);
  });
})();

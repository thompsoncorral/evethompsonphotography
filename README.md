# Client Gallery (static, GitHub Pages-ready)

A self-contained client photo gallery site modeled after the Pixieset "Collections" gallery you shared: a home page listing your galleries, a cover page per gallery with a "View Gallery" button, a masonry photo grid, a lightbox viewer with favorites/share/slideshow, a "Buy Photo" panel with print pricing, and an optional free-download button. It's plain HTML/CSS/JS with a JSON data file, so it runs entirely on GitHub Pages with no server to maintain.

Read the **Honest limitations** section before you rely on this for real client work — a static site can't do everything Pixieset's paid backend does, and it's important you know where the gaps are.

## What's included

```
index.html              Home page -- lists all galleries ("Collections")
gallery.html             Gallery template -- cover, grid, lightbox, buy modal
assets/css/style.css     All styling
assets/js/main.js        Home page logic
assets/js/gallery.js     Gallery page logic
assets/images/<slug>/    Photos, one folder per gallery (full/ and thumb/)
data/galleries.json      Everything else: gallery list, photos, pricing, toggles
generate_images.py       Script that made the placeholder sample photos
build_data.py            Script that builds data/galleries.json from photo files + metadata
```

Three sample galleries are included with generated placeholder images so you can see the whole flow working immediately: **Personal Gallery** (downloads on, store on), **Sample Wedding** (downloads off, store on), **Sample Family Session** (downloads on, store off) -- showing that each toggle is independent, same as in Pixieset's Download/Store settings.

## Try it locally first

From inside this folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. (Opening `index.html` directly with `file://` won't work -- browsers block the `fetch()` call that loads `data/galleries.json` from local files, so you need a simple server. The one-liner above is enough.)

## Replacing the sample photos with your own

1. For each gallery, drop your images into `assets/images/<slug>/full/` (full resolution) and a matching smaller copy into `assets/images/<slug>/thumb/` (around 600-800px wide is plenty for the grid, keeps the site fast).
2. Update `data/galleries.json` by hand -- it's plain JSON, one object per photo with `id`, `filename`, `full`, `thumb`, `width`, `height`. Copy the pattern from the existing entries.
   - Or, if your filenames follow the same numbered pattern the generator uses, edit `generate_images.py`/`build_data.py` to point at your files and re-run `python3 build_data.py` to regenerate the JSON automatically.
3. Keep an eye on total repo size (see **Image sizing & Git LFS** below) -- GitHub works best under ~1GB per repo, and individual files over 100MB need Git LFS.

## Adding, renaming, or removing a gallery ("duplicating" Personal Gallery)

Each gallery is just one object inside the `galleries` array in `data/galleries.json` plus its own image folder. To duplicate "Personal Gallery" for a new client:

1. Copy `assets/images/personal-gallery/` to `assets/images/<new-slug>/`, and swap in the new client's photos.
2. Copy the `personal-gallery` object inside `data/galleries.json`, give it a new unique `slug` (this becomes the URL: `gallery.html?g=<slug>`), a new `title`, and update the `photos` array to point at the new image paths.
3. Set `downloadEnabled` / `storeEnabled` / `favoritesEnabled` however you like for that client -- these map directly to Pixieset's Download, Store, and Favorite toggles.
4. Save, commit, push. It now shows up automatically on the home page.

There's no per-gallery page to hand-build; the same `gallery.html` template renders whichever gallery's `slug` is in the URL.

## Pricing ("Price Sheet")

`data/priceSheets.default` in `galleries.json` holds the four product categories shown in the Buy Photo panel (Prints, Wall Art, Cards, Albums & Books). Each gallery references a price sheet by name (`"priceSheet": "default"`), so you can create more than one price sheet and point different galleries at different pricing, the same way Pixieset lets you assign a Price Sheet per collection.

Each line item looks like:

```json
{ "label": "5 x 7", "price": "$6.00", "stripeLink": "" }
```

`price` is just a display label -- the real charge amount lives in Stripe (see below). Leave `stripeLink` empty and the site will show a friendly "not configured yet" message instead of a broken link, so nothing looks broken while you're still setting things up.

## Setting up real checkout with Stripe Payment Links

GitHub Pages only serves static files -- there's no server or database, so this site can't run its own checkout the way Pixieset does. The most reliable way to accept real card payments from a static site is **Stripe Payment Links**, which are hosted checkout pages Stripe builds for you; you just link a button to them. No coding, and no monthly fee beyond Stripe's normal per-transaction cut.

1. Create a free Stripe account at stripe.com if you don't have one.
2. In the Stripe Dashboard, go to **Payment links -> Create payment link**.
3. Create one product per print size/product (e.g. "5x7 Print" at $6.00). You can reuse the same product/link across every photo in a gallery -- the link itself doesn't know which photo was clicked.
4. Because of that, add a **custom field** on the payment link (Stripe supports this in the link editor) labeled something like "Photo filename or number," so the buyer can type in which photo they want (e.g. `DSC_1005.jpg`) and you'll see it in the Stripe order details. This replaces the automatic "which photo did they buy" matching that a full commerce backend like Pixieset's would otherwise handle for you.
5. Copy the generated `https://buy.stripe.com/...` URL into the matching `stripeLink` field in `data/galleries.json`.
6. Repeat for every price row you want purchasable. Rows left blank simply show the "not configured" message instead of navigating anywhere, so you can roll this out gradually.

If you'd rather not create a Stripe account, similar hosted-checkout links exist through Gumroad or PayPal.me/PayPal Buy Now buttons -- the integration is the same idea: paste a URL into `stripeLink`.

## Free downloads

Set a gallery's `"downloadEnabled": true` in `galleries.json` and a green "Free downloads are on" banner appears plus a **Download** button in the lightbox for every photo in that gallery, mirroring Pixieset's Download Settings toggle. The download button links straight to the full-resolution file in `assets/images/<slug>/full/` with the `download` attribute, so it saves directly rather than opening in a new tab.

Store and Download are independent toggles, exactly like Pixieset -- you can offer free downloads and sell prints on the same gallery, offer downloads only, sell prints only, or do neither.

## Keyword-to-enter galleries

Any gallery can require a keyword before its cover page unlocks -- set `"keyword": "family2026"` (or whatever word you like) on that gallery in `data/galleries.json`. Leave it as `""` (empty string) for a gallery that anyone with the link can open, which is the default.

How it behaves: a visitor sees a simple "Enter Keyword to View" screen instead of the cover photo. Type the matching keyword (not case-sensitive) and it unlocks; that browser remembers the unlock (via `localStorage`) so they won't be asked again on repeat visits from the same device. The `sample-family` demo gallery ships with the keyword `family2026` so you can try it.

**This is a soft gate, not real security** -- worth being precise about, since it's easy to assume otherwise:
- The keyword is sitting in plain text in `data/galleries.json`, which is a public file anyone can open in their browser's dev tools (Network tab, or just view-source on the JS). It stops casual stumbling, not a determined person.
- It doesn't encrypt or hide the photo files themselves -- someone who already knows or guesses a photo's direct URL can load it without ever seeing the gate.
- There's no rate-limiting, so it can be guessed by trial and error with no lockout.

Use it the way you'd use an unlisted YouTube link or a shared folder link with a "just so you know the phrase" convention -- fine for keeping a gallery low-key among people you've given the word to, not appropriate for anything genuinely confidential. For real access control (a photo set that must stay private), you'd need actual server-side authentication -- for example Cloudflare Access or Netlify's password-protect add-on sitting in front of the site, or keeping that particular gallery on a platform built for it.

## Deploying to GitHub Pages

1. Create a new repository on GitHub (public or private -- Pages works with both on paid plans; public repos get Pages free).
2. From this folder:
   ```
   git init
   git add .
   git commit -m "Initial client gallery site"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. On GitHub, go to the repository's **Settings -> Pages**, set "Source" to "Deploy from a branch," pick `main` and `/ (root)`, and save.
4. Your site will be live at `https://<your-username>.github.io/<your-repo>/` within a minute or two.
5. Optional: add a custom domain in that same Pages settings screen if you own one (e.g. `gallery.yourstudio.com`), following GitHub's DNS instructions.

## Image sizing & Git LFS

Photography repos can get big fast. A few practical notes:
- Keep `thumb/` images small (under ~200KB each) since those load on the grid page for everyone.
- `full/` images are what gets downloaded/zoomed, so keep them at a sensible web resolution (long edge 2000-2500px is usually plenty) rather than uploading full RAW-converted originals.
- If you do need to store very large or many files, GitHub recommends **Git LFS** for individual files over ~50-100MB and repos are most comfortable staying under ~1GB total. See <https://git-lfs.github.com>.

## Honest limitations vs. Pixieset

This template intentionally trades some of Pixieset's paid-service features for being free, static, and yours to host anywhere. Worth knowing going in:

- **No real password protection.** The optional keyword-to-enter gate (see above) is a soft speed bump, not security -- a static site has no server to check a secret against, so anything client-side is technically visible to anyone who opens dev tools. If a gallery genuinely needs restricted access, use an unlisted/hard-to-guess URL, or host it behind something that does real authentication (e.g. a private GitHub Pages Enterprise deployment, Cloudflare Access, Netlify's password-protect add-on).
- **No automated order-to-photo matching.** Buying a print records a Stripe order, but there's no backend linking that order to a specific photo automatically -- hence the custom field suggestion above so you can tell which photo the client meant.
- **No print fulfillment/lab integration.** Pixieset connects to print labs; this template just takes payment. You'd fulfill and ship prints yourself (or route Stripe orders to a print-on-demand service manually).
- **Favorites are per-browser, not per-account.** They're stored in that visitor's own browser (`localStorage`), so a client who favorites photos on their phone won't see the same favorites on their laptop, and there's no login system to unify them.
- **No built-in analytics/activity log** (Pixieset's "Download Activity"/"Store Activity" screens) -- Stripe's dashboard will show you completed orders, but page-view or download tracking would require adding an analytics tool separately.

For a client who needs secure password-gated delivery, guaranteed order-to-photo matching, or lab fulfillment, a paid platform like Pixieset (or keeping select galleries there) may still be the better tool for those specific jobs -- this template is best suited for a personal/portfolio gallery, or client galleries where those particular guarantees aren't required.

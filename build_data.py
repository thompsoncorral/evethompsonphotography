#!/usr/bin/env python3
"""Build data/galleries.json from the generated image manifest plus
hand-written gallery metadata (pricing, toggles, titles, etc).

Run this after generate_images.py, and re-run any time you add/remove
photos from assets/images/<slug>/full and thumb and want the manifest
picked back up automatically (or just hand-edit data/galleries.json directly --
it's a plain JSON file).
"""
import json
import os

HERE = os.path.dirname(__file__)

with open(os.path.join(HERE, "data", "_image_manifest.json")) as f:
    manifest = json.load(f)

# ---------------------------------------------------------------------------
# Shared print price sheet. Fill in your real Stripe Payment Link URLs here --
# see README.md > "Setting up Stripe Payment Links" for how to create them.
# Leave stripeLink as "" until you have a real link; the site will show a
# friendly "not configured yet" message instead of a broken checkout.
# ---------------------------------------------------------------------------
DEFAULT_PRICE_SHEET = {
    "prints": [
        {"label": "8 Up Wallet", "price": "$8.00", "stripeLink": ""},
        {"label": "4 x 6", "price": "$4.00", "stripeLink": ""},
        {"label": "5 x 7", "price": "$6.00", "stripeLink": ""},
        {"label": "8 x 10", "price": "$8.00", "stripeLink": ""},
        {"label": "8 x 12", "price": "$12.00", "stripeLink": ""},
        {"label": "11 x 14", "price": "$14.00", "stripeLink": ""},
        {"label": "12 x 18", "price": "$19.00", "stripeLink": ""},
        {"label": "16 x 20", "price": "$38.00", "stripeLink": ""},
    ],
    "wallArt": [
        {"label": "Canvas Wrap 16x20", "price": "$65.00", "stripeLink": ""},
        {"label": "Framed Print 16x20", "price": "$95.00", "stripeLink": ""},
        {"label": "Metal Print 16x20", "price": "$110.00", "stripeLink": ""},
    ],
    "cards": [
        {"label": "Greeting Card Set (10)", "price": "$24.00", "stripeLink": ""},
        {"label": "Holiday Card Set (25)", "price": "$45.00", "stripeLink": ""},
    ],
    "albumsBooks": [
        {"label": "10x10 Photo Book, 20pg", "price": "$120.00", "stripeLink": ""},
        {"label": "Leather Album, 20pg", "price": "$260.00", "stripeLink": ""},
    ],
}

GALLERIES_META = {
    "personal-gallery": {
        "title": "Personal Gallery",
        "eventDate": "",
        "downloadEnabled": True,   # free downloads ON
        "storeEnabled": True,      # prints/products ON
        "favoritesEnabled": True,
        "setName": "Highlights",
        "keyword": "",             # no entry keyword -- open to anyone with the link
    },
    "sample-wedding": {
        "title": "Sample Wedding",
        "eventDate": "2026-06-14",
        "downloadEnabled": False,  # e.g. a paid session: downloads off, store on
        "storeEnabled": True,
        "favoritesEnabled": True,
        "setName": "Highlights",
        "keyword": "",
    },
    "sample-family": {
        "title": "Sample Family Session",
        "eventDate": "2026-05-02",
        "downloadEnabled": True,   # e.g. free family session: downloads on, store off
        "storeEnabled": False,
        "favoritesEnabled": True,
        "setName": "Highlights",
        # Example of a soft "keyword to enter" gate -- see README for what this
        # does and doesn't protect against before relying on it.
        "keyword": "family2026",
    },
}

studio = {
    "name": "Eve Thompson Photography",
    "logoText": "EVE THOMPSON PHOTOGRAPHY",
}

galleries = []
for slug, photos in manifest.items():
    meta = GALLERIES_META.get(slug, {})
    entry = {
        "slug": slug,
        "title": meta.get("title", slug.replace("-", " ").title()),
        "eventDate": meta.get("eventDate", ""),
        "cover": photos[0]["full"],
        "coverThumb": photos[0]["thumb"],
        "downloadEnabled": meta.get("downloadEnabled", False),
        "storeEnabled": meta.get("storeEnabled", False),
        "favoritesEnabled": meta.get("favoritesEnabled", True),
        "setName": meta.get("setName", "Highlights"),
        "keyword": meta.get("keyword", ""),
        "priceSheet": "default",
        "photos": photos,
    }
    galleries.append(entry)

# Keep personal-gallery first so it matches what you previewed in Pixieset
galleries.sort(key=lambda g: 0 if g["slug"] == "personal-gallery" else 1)

data = {
    "studio": studio,
    "priceSheets": {"default": DEFAULT_PRICE_SHEET},
    "galleries": galleries,
}

out_path = os.path.join(HERE, "data", "galleries.json")
with open(out_path, "w") as f:
    json.dump(data, f, indent=2)

print(f"Wrote {out_path} with {len(galleries)} galleries.")

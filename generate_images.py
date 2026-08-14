#!/usr/bin/env python3
"""Generate placeholder sample photos for the demo galleries.
Replace these with your real photos later -- see README.md.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

random.seed(42)

BASE = os.path.join(os.path.dirname(__file__), "assets", "images")

# A few pleasant gradient color pairs (warm / earthy, echoing the demo content)
PALETTES = [
    ((40, 34, 30), (120, 88, 54)),
    ((60, 70, 45), (170, 180, 120)),
    ((80, 50, 30), (200, 140, 80)),
    ((30, 40, 50), (110, 140, 160)),
    ((70, 30, 30), (190, 100, 80)),
    ((45, 55, 40), (150, 160, 110)),
    ((35, 35, 35), (140, 120, 100)),
    ((50, 40, 60), (160, 130, 170)),
    ((25, 45, 40), (100, 160, 140)),
    ((90, 70, 40), (220, 190, 130)),
    ((40, 40, 40), (180, 180, 180)),
]

def get_font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

def make_image(path, w, h, palette, label):
    top, bottom = palette
    img = Image.new("RGB", (w, h), top)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    # subtle vignette-ish label
    font = get_font(max(18, w // 22))
    text = label
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((w - tw) / 2, (h - th) / 2 - h * 0.02), text, fill=(255, 255, 255, 230), font=font)
    img.save(path, quality=86)

def build_gallery(slug, count, orientation_mix=True):
    full_dir = os.path.join(BASE, slug, "full")
    thumb_dir = os.path.join(BASE, slug, "thumb")
    os.makedirs(full_dir, exist_ok=True)
    os.makedirs(thumb_dir, exist_ok=True)
    entries = []
    for i in range(1, count + 1):
        palette = PALETTES[(i - 1) % len(PALETTES)]
        portrait = orientation_mix and (i % 3 == 0)
        if portrait:
            fw, fh = 1200, 1600
        else:
            fw, fh = 1600, 1067
        filename = f"DSC_{1000 + i}.jpg"
        full_path = os.path.join(full_dir, f"{i}.jpg")
        thumb_path = os.path.join(thumb_dir, f"{i}.jpg")
        label = f"Sample Photo {i}"
        make_image(full_path, fw, fh, palette, label)
        # thumb
        tw = 700
        th = int(fh * (tw / fw))
        make_image(thumb_path, tw, th, palette, label)
        entries.append({
            "id": f"{slug}-{i}",
            "filename": filename,
            "full": f"assets/images/{slug}/full/{i}.jpg",
            "thumb": f"assets/images/{slug}/thumb/{i}.jpg",
            "width": fw,
            "height": fh,
        })
    return entries

if __name__ == "__main__":
    galleries = {
        "personal-gallery": 11,
        "sample-wedding": 6,
        "sample-family": 5,
    }
    import json
    manifest = {}
    for slug, count in galleries.items():
        manifest[slug] = build_gallery(slug, count)
        print(f"Generated {count} images for {slug}")
    with open(os.path.join(os.path.dirname(__file__), "data", "_image_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("Done.")

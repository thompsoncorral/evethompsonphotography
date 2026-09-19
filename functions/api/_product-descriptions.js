// Seller-written product descriptions, keyed by Printful Sync Product id.
//
// WHY THIS EXISTS
// /api/products cannot show a description you write in Printful. It fetches
// Printful's CATALOG copy for the underlying blank item -- the same generic text
// every seller using that blank gets -- because a Sync Product has no
// description field at all. Printful's own API docs list its fields as: id,
// external_id, name, variants, synced, thumbnail, thumbnail_url, is_ignored.
// No description. So there is nowhere for a seller-specific one to live, and the
// shop silently shows the blank's copy instead.
//
// The entry below is preferred over the catalog text for that product. Anything
// not listed here still falls back to Printful's catalog description, so adding
// a product never leaves it with no description.
//
// TO ADD ONE: copy the shape below. The key is the Sync Product id (the `id` in
// the /api/products response, NOT a variant id). If a product is ever deleted
// and recreated its id changes, and the override simply stops matching -- the
// product falls back to the catalog text rather than breaking.

// Every acrylic ornament shares one blank, so they share one description. It is
// written to match what is actually sold: two shapes, not the four the catalog
// copy lists for the blank.
const ORNAMENT_DESCRIPTION = [
  "Make special occasions even more joyful with lovely acrylic ornaments. " +
    "Choose from 2 shapes (Rectangle, Circle), and get a beautiful ornament " +
    "with a glossy finish and red ribbon for hanging.",
  "",
  "\u2022 Material: Optically clear digital-grade acrylic",
  "\u2022 Sizes: Rectangle 3\u2033 \u00d7 4\u2033 (7.62 \u00d7 10.16 cm) , " +
    "Circle diameter 3\u2033 (7.8 cm)",
  "\u2022 Ornament thickness: 0.25\u2033 (6.35 mm)",
  "\u2022 Comes with a red ribbon for hanging",
  "",
  "Disclaimers:",
  "\u2022 This product is available in the US only. If your shipping address is " +
    "outside this region, please choose a different product.",
  "\u2022 The product includes a small QR code on the back which may be slightly " +
    "visible through the material. This is intended only for the production " +
    "team's use.",
].join("\n");

export const PRODUCT_DESCRIPTIONS = {
  473636249: ORNAMENT_DESCRIPTION, // Holiday Ornament - Horses Running
  473636247: ORNAMENT_DESCRIPTION, // Holiday Ornament - Horse in Field
  473636246: ORNAMENT_DESCRIPTION, // Holiday Ornament - Mare
  473636245: ORNAMENT_DESCRIPTION, // Holiday Ornament - Mini Pony
};

// The seller's copy if there is any, otherwise whatever Printful returned.
export function descriptionFor(productId, catalogDescription) {
  const own = PRODUCT_DESCRIPTIONS[String(productId)];
  return own || catalogDescription || null;
}

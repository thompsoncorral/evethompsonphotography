// Quantity-based deals, priced server-side at checkout.
//
// WHY HERE AND NOT IN PRINTFUL
// Printful has no concept of a bundle: it fulfils line items individually and
// bills wholesale for each one, so a "4 for $40" deal exists only in this
// storefront. Stripe cannot express it either -- checkout is built with inline
// `price_data` rather than Stripe Price objects, so there are no product IDs for
// a Stripe coupon to be restricted to.
//
// The cart already tells us the sync variant id of every line, and Printful's
// /sync/variant/{id} response carries `sync_product_id` on each variant, so the
// server can tell an ornament from a canvas without trusting the browser.
//
// WHAT THE CUSTOMER PAYS AND WHAT PRINTFUL IS TOLD MUST AGREE
// create-checkout-session.js uses one value twice: the Stripe unit_amount (what
// is charged) and the Printful item retail_price (declared on international
// customs labels and used for Printful's own profit reporting). Both are set
// from the result of applyBundles below, so they cannot drift apart.
//
// Prices are in CENTS, matching Stripe's unit_amount.

// The four acrylic ornament designs. Each has two variants (Circle, Rectangle),
// which is why matching happens on product id rather than variant id -- adding
// another design to this deal means adding its sync product id here.
//
// NOTE: functions/api/_product-descriptions.js lists the same four ids against
// their descriptions. The two lists are deliberately independent: a product can
// have a description without being in a deal, or a deal without a description.
export const ORNAMENT_PRODUCT_IDS = [473636249, 473636247, 473636246, 473636245];

export const BUNDLES = [
  {
    id: "ornament-4-for-40",
    label: "4 acrylic ornaments for $40",
    productIds: ORNAMENT_PRODUCT_IDS,
    // Qualify on ANY four of these products combined -- four of one design, or
    // one of each, or two and two.
    quantity: 4,
    // What each qualifying item costs once the deal applies. A flat per-unit
    // figure rather than a percentage, because retail prices have to be whole
    // cents: 15% off $11.50 is $9.775, which cannot be declared exactly and
    // would drift a cent or two away from what was actually charged.
    unitAmount: 1000, // $10.00
  },
];

/**
 * Apply quantity deals to already-resolved cart lines.
 *
 * @param {Array<{syncProductId: number, unitAmount: number, quantity: number}>} lines
 *   Cart lines with Printful's own price already fetched server-side. Never
 *   mutate the caller's objects -- a new array is returned.
 * @returns {{lines: Array, applied: Array<{id: string, label: string, quantity: number}>}}
 */
export function applyBundles(lines) {
  const priced = lines.map((line) => ({ ...line }));
  const applied = [];

  for (const bundle of BUNDLES) {
    const members = priced.filter((l) => bundle.productIds.includes(l.syncProductId));
    const qualifyingQuantity = members.reduce((sum, l) => sum + l.quantity, 0);

    if (qualifyingQuantity < bundle.quantity) continue;

    // The deal is per unit: four ornaments trigger it, and any further ornament
    // in the same order is priced the same way rather than reverting to full
    // price, so a basket of five costs 5 x $10 rather than $40 + $11.50.
    //
    // Take the lower of the bundle price and the item's own price, so a deal can
    // never quietly INCREASE what something costs if its retail price later
    // drops below the deal figure.
    for (const line of members) {
      if (bundle.unitAmount < line.unitAmount) line.unitAmount = bundle.unitAmount;
    }
    applied.push({ id: bundle.id, label: bundle.label, quantity: qualifyingQuantity });
  }

  return { lines: priced, applied };
}

// Where this shop will and won't ship.
//
// WHY THE EU IS EXCLUDED
// EU Regulation 2023/988 (the General Product Safety Regulation) has applied
// since 13 December 2024 and applies based on where the CUSTOMER is, not where
// the seller is -- a US business selling into the EU is fully in scope. It
// requires a non-EU seller to appoint an EU-based "responsible person" for
// product compliance, which typically costs a few hundred dollars a year. Until
// that is worth it, the EU is out.
//
// Canada, the UK and everywhere else Printful can reach are fine. Where Printful
// cannot ship at all, its own rates endpoint returns nothing and the customer
// gets a clear message rather than a dead end -- so there is no allow-list to
// maintain here, only this denylist.

// The 27 member states (source: the EU's own country list).
const EU_MEMBER_STATES = [
  "AT", // Austria
  "BE", // Belgium
  "BG", // Bulgaria
  "HR", // Croatia
  "CY", // Cyprus
  "CZ", // Czechia
  "DK", // Denmark
  "EE", // Estonia
  "FI", // Finland
  "FR", // France
  "DE", // Germany
  "GR", // Greece
  "HU", // Hungary
  "IE", // Ireland
  "IT", // Italy
  "LV", // Latvia
  "LT", // Lithuania
  "LU", // Luxembourg
  "MT", // Malta
  "NL", // Netherlands
  "PL", // Poland
  "PT", // Portugal
  "RO", // Romania
  "SK", // Slovakia
  "SI", // Slovenia
  "ES", // Spain
  "SE", // Sweden
];

// Territories that are legally part of the EU even though they carry their own
// ISO code and sit outside Europe. Omitting them would leave a way into the EU
// that the member-state list above doesn't catch:
//   AX Aland Islands            (part of Finland)
//   GF French Guiana            (overseas department of France)
//   GP Guadeloupe               (overseas department of France)
//   MQ Martinique               (overseas department of France)
//   YT Mayotte                  (overseas department of France)
//   RE Reunion                  (overseas department of France)
//   MF Saint Martin             (outermost region of the EU)
// Note: BL Saint Barthelemy and PM Saint Pierre and Miquelon left the EU and are
// deliberately NOT listed.
const EU_OUTERMOST_REGIONS = ["AX", "GF", "GP", "MQ", "YT", "RE", "MF"];

export const BLOCKED_COUNTRY_CODES = [...EU_MEMBER_STATES, ...EU_OUTERMOST_REGIONS];

// ---------------------------------------------------------------------------
// Free shipping, and why it is not simply "everywhere"
//
// Printful bills us the real postage, and a 40x60 canvas to a far corner of the
// country costs far more than one to a neighbouring state. Absorbing that on a
// $11.50 ornament would wipe out the sale. So free shipping is offered on
// ORDERS OVER A THRESHOLD, to the US mainland only.
//
// Alaska and Hawaii are excluded on purpose: postage there can run several times
// the mainland rate, and on a $395 canvas that difference is the whole margin.
// Customers there still see real, calculated rates -- they simply pay them.
//
// CANVAS ONLY. The offer applies when the order CONTAINS A CANVAS, not merely
// when it is large enough. A canvas carries its own postage several times over:
// the 24x36 leaves about $9 of margin after Printful's base cost and then
// $10.39 of postage, while the 40x60 leaves about $188. An $11.50 ornament
// earns $2.16, so the same $5.49 of postage would be a loss on every order.
//
// Anything else in the basket ships free alongside the canvas, because postage
// is charged per parcel rather than per item.
//
// To change the offer, edit the values below and nothing else. Setting
// FREE_SHIPPING_THRESHOLD to 0 makes every qualifying US canvas order free.
// ---------------------------------------------------------------------------
export const FREE_SHIPPING_THRESHOLD = 100; // US dollars, on the goods subtotal

// HOW A CANVAS IS RECOGNISED
// Printful names a variant "<product name> / <size>", and every canvas in this
// shop carries "canvas" in its product name. Matching on the name rather than on
// product ids is deliberate: ids are per-store, so a list of them would have to
// be maintained twice once the photography and Etsy stores hold the same items.
//
// If a canvas is ever named without one of these words in Printful, add the word
// here -- otherwise that canvas will not qualify for free shipping.
const CANVAS_NAME_HINTS = ["canvas"];

export function isCanvasLine(text) {
  const name = String(text || "").toLowerCase();
  return CANVAS_NAME_HINTS.some((hint) => name.includes(hint));
}

// Does this cart contain a canvas? Takes plain strings or objects with a `name`.
// Both the resolved Printful variants and the priced cart lines have one, and
// both come from Printful rather than from the browser.
export function cartHasCanvas(lines) {
  if (!Array.isArray(lines)) return false;
  return lines.some((line) => {
    if (!line) return false;
    return isCanvasLine(typeof line === "string" ? line : line.name);
  });
}

// The 48 contiguous states plus DC. Deliberately NOT AK or HI.
const US_MAINLAND_STATES = new Set([
  "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
  "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// The id our free rate travels under. Chosen to be unmistakable: Printful's own
// rate ids look like "STANDARD" / "EXPEDITED", so this can never collide with
// one of theirs and be mistaken for a real postage method.
export const FREE_SHIPPING_RATE_ID = "FREE_US_MAIN";

// Is this destination one we are willing to post to at our own cost?
export function isFreeShippingDestination(countryCode, stateCode) {
  const country = String(countryCode || "").trim().toUpperCase();
  const state = String(stateCode || "").trim().toUpperCase();
  if (country !== "US") return false;
  return US_MAINLAND_STATES.has(state);
}

// The whole offer: right country, a canvas in the cart, and a basket big enough
// to carry the postage. `hasCanvas` is required rather than optional -- an
// ornament order over the threshold is refused on purpose, because that postage
// would come out of a $2.16 margin instead of a canvas-sized one.
export function qualifiesForFreeShipping(countryCode, stateCode, subtotalDollars, hasCanvas) {
  if (!isFreeShippingDestination(countryCode, stateCode)) return false;
  if (!hasCanvas) return false;
  return Number(subtotalDollars) >= FREE_SHIPPING_THRESHOLD;
}

const BLOCKED = new Set(BLOCKED_COUNTRY_CODES);

// Normalise however the country arrives ("us", " US ", "Us") and decide.
export function isBlockedCountry(countryCode) {
  return BLOCKED.has(String(countryCode || "").trim().toUpperCase());
}

// The message a customer sees. Kept here so both endpoints say the same thing.
export const BLOCKED_COUNTRY_MESSAGE =
  "We're not able to ship to the EU at the moment. If you're outside the EU and seeing this, please get in touch.";

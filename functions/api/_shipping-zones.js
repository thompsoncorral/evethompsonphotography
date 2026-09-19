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

const BLOCKED = new Set(BLOCKED_COUNTRY_CODES);

// Normalise however the country arrives ("us", " US ", "Us") and decide.
export function isBlockedCountry(countryCode) {
  return BLOCKED.has(String(countryCode || "").trim().toUpperCase());
}

// The message a customer sees. Kept here so both endpoints say the same thing.
export const BLOCKED_COUNTRY_MESSAGE =
  "We're not able to ship to the EU at the moment. If you're outside the EU and seeing this, please get in touch.";

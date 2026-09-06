// POST /api/custom-order (multipart/form-data: name, email, description,
// rightsConfirmed, indemnificationConfirmed, fulfillmentAuthorized,
// qualityAcknowledged, imageApproved, promotionalConsent, photo)
// The first five consent fields are required (see the "-- Required"
// sections on shop/custom-order/); promotionalConsent is the one optional
// checkbox and is stored as given either way.
// Handles a submission from /shop/custom-order/ -- a customer's own photo
// plus what they'd like it made into. Nothing here is public or automatic:
// the photo goes into private R2 storage and the details into KV, both only
// reachable through the password-protected admin area (see
// admin-submissions.js / admin-photo.js). No email is sent to anyone --
// Eve checks the admin page for new submissions and reaches out to
// customers herself once a product's ready (see admin-generate-link.js).
//
// The form promises photos are deleted 30 days after submission (see the
// "Photo Retention" notice on that page) -- purgeExpiredSubmissions
// (_retention.js) is what enforces that. It's kicked off in the
// background after a successful save so it never slows down or risks
// breaking the customer's own submission.

import { purgeExpiredSubmissions } from "./_retention.js";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15MB -- generous for a phone photo, small enough to stay well under Cloudflare's request-body limits
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function onRequestPost(context) {
const { request, env } = context;
if (!env.CUSTOM_ORDERS || !env.CUSTOM_PHOTOS) {
return jsonError(500, "Custom orders aren't set up yet -- missing storage configuration.");
}

let form;
try {
form = await request.formData();
} catch {
return jsonError(400, "Couldn't read that submission -- please try again.");
}

const name = (form.get("name") || "").toString().trim();
const email = (form.get("email") || "").toString().trim();
const description = (form.get("description") || "").toString().trim();
const rightsConfirmed = form.get("rightsConfirmed") === "true";
const indemnificationConfirmed = form.get("indemnificationConfirmed") === "true";
const fulfillmentAuthorized = form.get("fulfillmentAuthorized") === "true";
const qualityAcknowledged = form.get("qualityAcknowledged") === "true";
const imageApproved = form.get("imageApproved") === "true";
const promotionalConsent = form.get("promotionalConsent") === "true";
const photo = form.get("photo");

if (!name || !email || !description) {
return jsonError(400, "Please fill in your name, email, and what you'd like made.");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
return jsonError(400, "That email address doesn't look right.");
}
if (!rightsConfirmed) {
return jsonError(400, "Please confirm the Photo Ownership & Permission statement before submitting.");
}
if (!indemnificationConfirmed) {
return jsonError(400, "Please confirm the Third-Party Rights & Indemnification statement before submitting.");
}
if (!fulfillmentAuthorized) {
return jsonError(400, "Please confirm the Production & Fulfillment Permission statement before submitting.");
}
if (!qualityAcknowledged) {
return jsonError(400, "Please confirm the Image Quality & Product Appearance statement before submitting.");
}
if (!imageApproved) {
return jsonError(400, "Please confirm the Customer Image Approval statement before submitting.");
}
if (!photo || typeof photo === "string") {
return jsonError(400, "Please attach a photo.");
}
if (photo.size > MAX_PHOTO_BYTES) {
return jsonError(400, "That photo is a bit too large (15MB max) -- a smaller export or a screenshot-quality copy works fine.");
}
if (photo.type && !ALLOWED_TYPES.has(photo.type)) {
return jsonError(400, "Please attach a photo file (JPEG, PNG, WEBP, or HEIC).");
}

const id = crypto.randomUUID();
const safeExt = extensionFor(photo.type, photo.name);
const photoKey = `submissions/${id}/photo${safeExt}`;

try {
await env.CUSTOM_PHOTOS.put(photoKey, photo.stream(), {
httpMetadata: { contentType: photo.type || "application/octet-stream" },
});

const record = {
id,
name,
email,
description,
rightsConfirmed: true,
indemnificationConfirmed: true,
fulfillmentAuthorized: true,
qualityAcknowledged: true,
imageApproved: true,
promotionalConsent,
submittedAt: new Date().toISOString(),
photoKey,
photoContentType: photo.type || "application/octet-stream",
status: "new", // "new" -> "reviewed" once Eve has looked at it (see admin-mark-status.js)
};
await env.CUSTOM_ORDERS.put(`submission:${id}`, JSON.stringify(record));
} catch (err) {
return jsonError(500, "Something went wrong saving your submission -- please try again in a moment.");
}

// Best-effort cleanup of anything past the 30-day retention window.
// Runs after the response is on its way so it never delays or risks
// this customer's own submission.
context.waitUntil(purgeExpiredSubmissions(env).catch(() => {}));

return new Response(JSON.stringify({ ok: true }), {
status: 200,
headers: { "Content-Type": "application/json" },
});
}

function extensionFor(mimeType, filename) {
const byMime = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif" };
if (mimeType && byMime[mimeType]) return byMime[mimeType];
const match = /\.[a-zA-Z0-9]+$/.exec(filename || "");
return match ? match[0].toLowerCase() : "";
}

function jsonError(status, message) {
return new Response(JSON.stringify({ error: message }), {
status,
headers: { "Content-Type": "application/json" },
});
}

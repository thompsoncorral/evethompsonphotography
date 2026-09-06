// GET /api/admin-submissions
// Lists custom-order submissions (see custom-order.js) for the admin page.
// Requires a valid admin session cookie -- returns 401 otherwise. Photo
// bytes aren't included here (they can be large); each submission includes
// a photoKey the admin page turns into a request to admin-photo.js, which
// is itself just as protected.
//
// Also runs purgeExpiredSubmissions (_retention.js) before listing, so
// anything past the promised 30-day retention window is actually deleted
// (photo + record) rather than just hidden -- this doubles as the other
// opportunity (alongside every new submission, see custom-order.js) for
// that cleanup to happen, since there's no separate scheduled job.

import { isAdminRequest, unauthorized } from "./_admin-auth.js";
import { purgeExpiredSubmissions } from "./_retention.js";

export async function onRequestGet({ request, env }) {
if (!(await isAdminRequest(request, env))) return unauthorized();
if (!env.CUSTOM_ORDERS) {
return jsonError(500, "Custom orders aren't set up yet -- missing storage configuration.");
}

await purgeExpiredSubmissions(env).catch(() => {});

try {
const list = await env.CUSTOM_ORDERS.list({ prefix: "submission:" });
const records = await Promise.all(
list.keys.map(async (k) => {
const raw = await env.CUSTOM_ORDERS.get(k.name);
if (!raw) return null;
try {
return JSON.parse(raw);
} catch {
return null;
}
})
);
const submissions = records
.filter(Boolean)
.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

return new Response(JSON.stringify({ submissions }), {
status: 200,
headers: { "Content-Type": "application/json" },
});
} catch (err) {
return jsonError(500, "Couldn't load submissions right now.");
}
}

function jsonError(status, message) {
return new Response(JSON.stringify({ error: message }), {
status,
headers: { "Content-Type": "application/json" },
});
}

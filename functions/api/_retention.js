// Shared photo-retention logic for custom-order submissions (see
// custom-order.js). The customer-facing form at /shop/custom-order/
// promises photos are deleted 30 days after submission -- this is what
// actually does that deletion, both the photo bytes in R2 (CUSTOM_PHOTOS)
// and the submission record in KV (CUSTOM_ORDERS).
//
// There's no separate scheduled/cron job here -- Cloudflare Pages
// Functions don't run on their own timer, so this is called
// opportunistically from the two places that already touch this data:
// - custom-order.js, right after a new submission comes in
// - admin-submissions.js, every time the admin dashboard loads
// Between customers submitting new orders and Eve checking the admin
// page, that's frequent enough to keep things cleaned up without adding
// any new infrastructure.

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function purgeExpiredSubmissions(env) {
  if (!env.CUSTOM_ORDERS || !env.CUSTOM_PHOTOS) return;

  const now = Date.now();

  let list;
  try {
    list = await env.CUSTOM_ORDERS.list({ prefix: "submission:" });
  } catch {
    return; // best-effort -- never let cleanup break the caller
  }

  await Promise.allSettled(
    list.keys.map(async (k) => {
      const raw = await env.CUSTOM_ORDERS.get(k.name);
      if (!raw) return;

      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        return;
      }

      const submittedAt = new Date(record.submittedAt).getTime();
      if (!submittedAt || now - submittedAt < RETENTION_MS) return;

      // Past 30 days -- delete the photo and the record. Each delete is
      // independent so one failing doesn't stop the other from running.
      await Promise.allSettled([
        record.photoKey ? env.CUSTOM_PHOTOS.delete(record.photoKey) : Promise.resolve(),
        env.CUSTOM_ORDERS.delete(k.name),
      ]);
    })
  );
}

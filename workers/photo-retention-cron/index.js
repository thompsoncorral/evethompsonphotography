// Standalone Cloudflare Worker: daily cleanup for /shop/custom-order/
// submissions on evethompsonphotography.com.
//
// The Pages site (thompsoncorral/evethompsonphotography, functions/api/
// _retention.js) already deletes a submission's photo + record once it's
// 30+ days old, but only opportunistically -- when a new order comes in,
// or when the admin dashboard loads. This Worker does the same deletion
// on its own daily schedule (see the Cron Trigger in this Worker's
// Settings), so cleanup happens on a clock instead of depending on site
// traffic or Eve checking the admin page.
//
// Bindings required (Settings -> Bindings):
//   KV namespace  CUSTOM_ORDERS -> custom_orders   (same namespace the Pages project uses)
//   R2 bucket     CUSTOM_PHOTOS -> custom-order-photos (same bucket the Pages project uses)
//
// Secret required (Settings -> Variables and secrets), only for the manual
// ?run=1 testing endpoint below:
//   RETENTION_RUN_SECRET -> any random string of your choosing

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeExpiredSubmissions(env));
  },

  // No public functionality -- this Worker exists only to run on a
  // schedule. The fetch handler is just a friendly status page in case
  // anyone opens its URL directly, plus a secret-gated manual "run now"
  // for testing (?run=1&secret=...) -- without the correct secret it
  // does nothing but return 401.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get("run") === "1") {
      if (!env.RETENTION_RUN_SECRET || url.searchParams.get("secret") !== env.RETENTION_RUN_SECRET) {
        return new Response("Unauthorized.\n", { status: 401, headers: { "Content-Type": "text/plain" } });
      }
      const result = await purgeExpiredSubmissions(env);
      return new Response(
        "Ran photo-retention sweep manually.\nChecked: " + result.checked + "\nDeleted: " + result.deleted + "\n",
        { headers: { "Content-Type": "text/plain" } }
      );
    }
    return new Response(
      "Custom-order photo retention worker.\nRuns automatically once a day (see Cron Triggers in this Worker's Settings).\nNo public functionality.\n",
      { headers: { "Content-Type": "text/plain" } }
    );
  },
};

async function purgeExpiredSubmissions(env) {
  const result = { checked: 0, deleted: 0 };

  if (!env.CUSTOM_ORDERS || !env.CUSTOM_PHOTOS) {
    console.error("Missing CUSTOM_ORDERS or CUSTOM_PHOTOS binding -- check this Worker's Settings > Bindings.");
    return result;
  }

  const now = Date.now();
  let cursor;

  do {
    let page;
    try {
      page = await env.CUSTOM_ORDERS.list({ prefix: "submission:", cursor });
    } catch (err) {
      console.error("Failed to list submissions", err);
      break;
    }

    await Promise.allSettled(
      page.keys.map(async (k) => {
        result.checked++;
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
        result.deleted++;
      })
    );

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  console.log("Photo retention sweep: checked " + result.checked + ", deleted " + result.deleted + " expired submission(s).");
  return result;
}

// POST /api/stripe-webhook
// Configure this exact URL (https://yoursite.com/api/stripe-webhook) as a
// webhook endpoint in the Stripe Dashboard, listening for
// "checkout.session.completed". Stripe calls this automatically after a
// customer pays -- nothing on the frontend calls this.

import Stripe from "stripe";

const PRINTFUL_BASE = "https://api.printful.com";

export async function onRequestPost({ request, env }) {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
              httpClient: Stripe.createFetchHttpClient(),
              apiVersion: "2024-06-20",
      });

  const signature = request.headers.get("stripe-signature");
      const rawBody = await request.text();

  let event;
      try {
              event = await stripe.webhooks.constructEventAsync(
                        rawBody,
                        signature,
                        env.STRIPE_WEBHOOK_SECRET
                      );
      } catch (err) {
              return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
      }

  if (event.type !== "checkout.session.completed") {
          // Acknowledge anything else so Stripe stops retrying it; we just don't act on it.
        return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const session = event.data.object;
      const orderToken = session.metadata?.order_token;
      if (!orderToken) {
              return new Response("Missing order_token in session metadata", { status: 400 });
      }

  const stored = await env.ORDERS.get(orderToken);
      if (!stored) {
              // Either already processed, or the KV entry expired. Log and move on --
        // returning 200 stops Stripe from retrying forever.
        console.error(`No stashed order found for token ${orderToken}`);
              return new Response(JSON.stringify({ received: true, note: "no matching order in KV" }), { status: 200 });
      }

  const orderPayload = JSON.parse(stored);

  const headers = {
          Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
          "Content-Type": "application/json",
  };
      if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;

  try {
          // confirm=false (the default / omitted) creates a DRAFT order in
        // Printful that you review and confirm by hand in the Printful
        // dashboard before it goes into production. This is the safer default
        // while you're getting started -- flip PRINTFUL_AUTO_CONFIRM to "true"
        // once you trust the pipeline and want orders to go straight to
        // fulfillment the moment payment clears.
        const url =
                  env.PRINTFUL_AUTO_CONFIRM === "true"
              ? `${PRINTFUL_BASE}/orders?confirm=true`
                    : `${PRINTFUL_BASE}/orders`;

        const orderRes = await fetch(url, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                              // Printful's external_id must be <= 32 chars (digits, letters,
                                               // dashes, underscores only). Stripe's session.id (e.g.
                                               // "cs_test_a1B2c3...") is much longer than that and gets rejected
                                               // with "Invalid External ID specified". Our own orderToken is a
                                               // UUID (36 chars incl. 4 dashes) -- stripping the dashes gives a
                                               // unique 32-character hex string that fits the limit exactly.
                                               external_id: orderToken.replace(/-/g, ""),
                              recipient: orderPayload.recipient,
                              items: orderPayload.items,
                              shipping: orderPayload.shipping,
                  }),
        });

        const orderData = await orderRes.json();

        if (!orderRes.ok) {
                  // Payment already succeeded at this point -- don't lose that fact.
            // Log loudly so you can create the order manually / refund if needed.
            console.error("Printful order creation failed after successful payment", {
                        session_id: session.id,
                        detail: orderData,
            });
                  return new Response(JSON.stringify({ received: true, printful_error: orderData }), { status: 200 });
        }

        await env.ORDERS.delete(orderToken);

        return new Response(JSON.stringify({ received: true, printful_order_id: orderData.result.id }), {
                  status: 200,
        });
  } catch (err) {
          console.error("Unhandled error creating Printful order", err);
          return new Response(JSON.stringify({ received: true, error: err.message }), { status: 200 });
  }
}

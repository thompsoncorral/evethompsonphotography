# Printful + Stripe shop — setup guide

This turns `/shop` into a real storefront: customers browse your Printful
products, add them to a cart, get a live shipping quote, and pay with
Stripe. When payment succeeds, Stripe tells your site, and your site
automatically creates the order in Printful for fulfillment.

Because GitHub Pages can only serve static files (no secret keys, no
server-side code), this moves hosting to **Cloudflare Pages** instead —
still connected to your same GitHub repo, still deploys automatically on
every push, but now with a handful of small serverless "Functions" added
alongside your existing site.

Nothing here touches your existing pages — it only adds a `/shop` section
and a `/functions/api` folder.

---

## 0. What's in this folder

```
functions/api/products.js              -> GET  /api/products
functions/api/shipping-rates.js         -> POST /api/shipping-rates
functions/api/create-checkout-session.js-> POST /api/create-checkout-session
functions/api/stripe-webhook.js         -> POST /api/stripe-webhook
shop/index.html, shop.js, shop.css      -> the storefront page
shop/success.html                       -> post-payment thank-you page
package.json                            -> pulls in the `stripe` package
```

Copy the `functions/`, `shop/`, and `package.json` into the root of your
`evethompsonphotography` repo (alongside your existing site files), commit,
and push.

---

## 1. Create your Printful private token

You were already on this screen (Printful Developers → Tokens → Add new
token):

1. **Token name**: something like `evethompsonphotography-shop`.
2. **Expiration date**: pick whatever you're comfortable with (up to 2
   years) — just put a reminder on your calendar to renew it before then,
   or you can always generate a new one later.
3. **Access level**: keep **A single store** → *Eve Thompson Photography*
   (already selected).
4. **Scopes** — check:
   - **View store products**
   - **View and manage orders of the authorized store**
   
   Leave the rest unchecked for now (files, webhooks) — you can always
   create a new token later if you need more.
5. Click **Create new token** and **copy the value immediately** — Printful
   only shows it once. Paste it somewhere safe temporarily (you'll enter it
   into Cloudflare in step 4).

---

## 2. Create a Stripe account (if you don't have one)

1. Sign up at stripe.com (free — Stripe only takes a percentage when you
   actually get paid).
2. Stay in **Test mode** for now (toggle in the Stripe dashboard) — this
   lets you run through a whole fake purchase with no real money moving,
   which you should do before going live.
3. Go to **Developers → API keys** and copy the **Secret key** (starts with
   `sk_test_...`). You do *not* need the publishable key for this setup —
   Stripe's hosted Checkout page handles the card form for us.

---

## 3. Move hosting to Cloudflare Pages

1. Sign up / log in at dash.cloudflare.com.
2. **Workers & Pages → Create → Pages → Connect to Git**, and pick your
   `evethompsonphotography` repo.
3. Build settings: if your site is currently plain HTML/CSS/JS with no
   build step, set **Framework preset: None**, leave the **Build command**
   blank, and set **Build output directory** to wherever your site's HTML
   files live now (probably `/` — the repo root — same as your current
   GitHub Pages source).
4. Deploy. Cloudflare gives you a temporary URL like
   `evethompsonphotography.pages.dev` — use that to test everything below
   before pointing your real domain at it.
5. Once you're happy (after testing in Section 6), you can point your
   custom domain at Cloudflare Pages instead of GitHub Pages: **your Pages
   project → Custom domains → add your domain**, then update your domain's
   DNS as Cloudflare instructs. You can leave GitHub Pages turned on
   harmlessly until you're ready to switch DNS over.

### Turn on Node compatibility (needed for the Stripe package)

In your Pages project: **Settings → Functions → Compatibility flags** →
add `nodejs_compat` to **both** Production and Preview. Without this, the
checkout and webhook functions will fail to load.

---

## 4. Create the KV store (temporary order storage)

We stash each verified order for a few minutes between "customer paid" and
"webhook creates the Printful order," so nothing can be tampered with in
between.

1. **Workers & Pages → KV → Create namespace**, name it `ORDERS`.
2. Back in your Pages project: **Settings → Functions → KV namespace
   bindings → Add binding**.
   - Variable name: `ORDERS` (must match exactly — the code refers to
     `env.ORDERS`)
   - KV namespace: the `ORDERS` one you just created
3. Add this binding for both Production and Preview.

---

## 5. Set environment variables

Still in your Pages project: **Settings → Environment variables**. Add
these for **Production** (and again for **Preview** if you want previews to
work too):

| Variable | Value |
|---|---|
| `PRINTFUL_TOKEN` | the token from Step 1 |
| `STRIPE_SECRET_KEY` | your `sk_test_...` key from Step 2 |
| `STRIPE_WEBHOOK_SECRET` | you'll get this in Step 6 below — come back and add it |
| `PRINTFUL_AUTO_CONFIRM` | `false` to start (orders land as drafts you approve in Printful; switch to `true` later once you trust the flow) |

Mark `PRINTFUL_TOKEN` and `STRIPE_SECRET_KEY` as **encrypted/secret** if
Cloudflare gives you that option.

(You don't need `PRINTFUL_STORE_ID` — that's only for account-level tokens
that span multiple stores, and you created a single-store token.)

---

## 6. Point Stripe's webhook at your site

This is the step that lets Stripe automatically tell your site "this
customer paid" so it can create the Printful order.

1. In Stripe: **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<your-pages-domain>/api/stripe-webhook`
   (e.g. `https://evethompsonphotography.pages.dev/api/stripe-webhook`, or
   your real domain once it's pointed at Cloudflare).
3. Select the event **`checkout.session.completed`**.
4. Save, then copy the **Signing secret** (starts with `whsec_...`) it
   shows you.
5. Go back to Cloudflare's environment variables (Step 5) and paste that in
   as `STRIPE_WEBHOOK_SECRET`. Redeploy (Cloudflare usually does this
   automatically when you save env vars, or trigger a redeploy manually).

---

## 7. Link to the shop from your site

Add a link somewhere in your existing site's navigation pointing to
`/shop/index.html` (or `/shop/` if you rename it to `shop/index.html` as
the default — most static hosts serve that automatically).

---

## 8. Test it end-to-end (Stripe test mode)

1. Visit your shop page, add a product to the cart.
2. Fill in the shipping form with a real-format US address (or wherever you
   ship) and click **Check shipping cost** — you should see live rates
   come back from Printful.
3. Pick a rate, click **Continue to payment**.
4. On Stripe's checkout page, use the test card `4242 4242 4242 4242`, any
   future expiry date, any 3-digit CVC, any ZIP.
5. Complete payment — you should land on the "Thank you" page.
6. Check:
   - **Stripe Dashboard → Payments**: shows the payment.
   - **Stripe Dashboard → Webhooks → your endpoint**: shows a successful
     `200` delivery for `checkout.session.completed`.
   - **Printful Dashboard → Orders**: a new **draft** order should appear
     with the right product and address. (It's a draft because
     `PRINTFUL_AUTO_CONFIRM` is `false` — review it, then confirm it
     manually in Printful to send it to production.)

If the Printful order doesn't show up, check the Cloudflare Pages Function
logs (**your Pages project → your latest deployment → Functions → Real-time
logs**, or `wrangler pages deployment tail`) for the error — the webhook
function logs details whenever something fails after payment.

---

## 9. Go live

Once a few test orders work end-to-end:

1. In Stripe, flip to **Live mode**, grab your **live** `sk_live_...` key,
   and create a **second** webhook endpoint (live mode has separate
   webhooks from test mode) pointing at the same `/api/stripe-webhook`
   URL — copy its live `whsec_...` secret too.
2. Update `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Cloudflare to
   the live values.
3. Consider switching `PRINTFUL_AUTO_CONFIRM` to `true` once you're
   confident you don't need to manually review every order before it goes
   to print — otherwise keep reviewing drafts by hand in Printful, which is
   a nice safety net while you're getting started.
4. Point your real domain at Cloudflare Pages (Step 3.5) if you haven't
   already.

---

## Notes / things you might want to change later

- **Pricing**: the site always charges exactly what's set as each
  variant's retail price in Printful, re-verified server-side at checkout
  — so if you update prices in Printful, the shop reflects it automatically
  with no code changes.
- **Currency**: assumes USD unless Printful reports otherwise per variant.
- **Cart persistence**: the cart lives in the browser's local storage, so
  it survives a page refresh but is per-device/browser.
- **Emails**: Stripe automatically emails a receipt. Printful sends its own
  shipping-confirmation email to the customer once the order ships (uses
  the email you pass as the recipient, which is the checkout email).

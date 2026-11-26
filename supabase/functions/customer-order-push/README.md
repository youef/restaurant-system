# Customer order push notifications

The Edge Function is deployed as `customer-order-push`. It intentionally fails closed until its secrets and database webhook are configured.

## 1. Generate VAPID keys

Run locally:

```bash
npx web-push generate-vapid-keys
```

Keep the private key secret. Do not commit it.

## 2. Set Supabase Edge Function secrets

Set these in Supabase Dashboard → Edge Functions → Secrets (or with the Supabase CLI):

- `CUSTOMER_PUSH_WEBHOOK_SECRET`: a long random value shared only with the database webhook
- `VAPID_PUBLIC_KEY`: generated public VAPID key
- `VAPID_PRIVATE_KEY`: generated private VAPID key
- `VAPID_SUBJECT`: a valid contact such as `mailto:admin@your-domain.example`

The Supabase Edge Function runtime also needs `SUPABASE_URL` and `SUPABASE_SECRET_KEYS`, which are provided by the project runtime.

## 3. Configure the customer web app

Add the public VAPID key to the Render customer service environment as:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<VAPID public key>
```

Redeploy the customer service after setting it. This key is public by design; never expose the private key in the browser.

## 4. Create the database webhook

In Supabase Dashboard → Database → Webhooks, create a webhook with:

- Table: `public.orders`
- Event: `UPDATE`
- Method: `POST`
- URL: `https://vevmowpemllrhscemstd.supabase.co/functions/v1/customer-order-push`
- Header: `Authorization: Bearer <the same CUSTOMER_PUSH_WEBHOOK_SECRET>`
- Header: `Content-Type: application/json`

The function only sends a push when an order's status changes. It looks up subscriptions using `placed_by`, and each device's own saved table URL is used when the notification is opened.

## Platform notes

The browser must grant notification permission. Background delivery depends on browser/OS support, an installed service worker, valid VAPID configuration, and the database webhook. A device in silent or focus mode may suppress notification sound.

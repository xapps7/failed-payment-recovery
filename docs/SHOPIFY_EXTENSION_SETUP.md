# Shopify Extension Setup

Use this repo as the Shopify app source of truth.

## Required scopes

The app now expects these scopes:

- `read_orders`
- `read_customers`
- `read_discounts`
- `write_discounts`
- `read_pixels`
- `write_pixels`
- `read_customer_events`

Reinstall the app after deploy so Shopify grants the expanded scopes.

## CLI packaging flow

1. Install Shopify CLI locally if it is not already installed.
2. From the repo root, run:

```bash
npm run shopify:dev
```

3. If the extension is not registered yet, generate or sync it:

```bash
npm run shopify:generate-extension
```

4. Deploy the app and extensions:

```bash
npm run shopify:deploy
```

5. In Shopify Admin, reopen the app and use `Activate store pixel` in Settings.

## Pixel behavior

The web pixel forwards:

- `payment_info_submitted`
- `checkout_completed`

to:

- `/events/web-pixel`

The backend uses those events to persist recovery payload, infer failed payment, and mark recoveries.

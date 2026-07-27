# Paystack Webhook Router

The universal webhook router has moved to its own project:

**→ [`paystack-router/`](../paystack-router/)**

That directory contains:
- Router source code (`src/index.ts`)
- Cloudflare Workers deployment config (`wrangler.toml`)
- Full setup + deployment instructions (`README.md`)

## Quick summary

- Deploy `paystack-router/` to Cloudflare Workers (free)
- Set `PAYSTACK_SECRET_KEY` as a secret via `wrangler secret put`
- Add each project's webhook URL + reference prefix to `ROUTES`
- Paste the deployed router URL into Paystack dashboard
- Done — one URL, all projects

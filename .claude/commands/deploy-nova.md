---
description: Deploy the Nova submission worker to Cloudflare
---

Deploy the Nova worker:

1. Run `cd tools/nova && npx wrangler d1 migrations apply oshi-prism-nova --remote` to apply pending migrations
2. Run `cd tools/nova && npx wrangler deploy` to deploy the worker
3. Report the deployed URL and version ID

---
description: Build and deploy the admin worker + UI to Cloudflare
---

Deploy the admin dashboard:

1. Run `cd admin/ui && npm run build` to build the React admin UI
2. Run `cd admin && npx wrangler deploy` to deploy the worker + static assets
3. Report the deployed URL and version ID

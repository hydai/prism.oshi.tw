---
description: Build and deploy the admin worker + UI to Cloudflare
---

Deploy the admin dashboard:

1. Build the React admin UI: `cd admin/ui && npm run build` (run from the project root)
2. Deploy the worker + static assets: `cd admin && npx wrangler deploy` (run from the project root)
3. Report the deployed URL and version ID

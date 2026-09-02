---
description: Build and deploy the admin worker + UI to Cloudflare
---

Deploy the admin dashboard:

1. Build the React admin UI: `cd admin/ui && npm run build` (run from the project root)
2. Schema preflight (read-only): `cd admin && npm run preflight:remote-schema` — queries the remote D1's `sqlite_master` and exits non-zero when a schema object the worker needs at runtime is missing. If it fails, STOP: apply the pending migration(s) it names, manually and per file (`npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/<file>.sql` from `admin/`, after a Time Travel bookmark — never `migrations apply`; see `docs/vod-export-rollout.md`), then re-run the preflight. Migrations are never applied automatically.
3. Deploy the worker + static assets: `cd admin && npm run deploy` (run from the project root; the script re-runs the preflight before `wrangler deploy`)
4. Report the deployed URL and version ID

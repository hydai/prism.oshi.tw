---
description: Deploy the Nova submission worker to Cloudflare
---

Deploy the Nova worker:

1. Run `cd tools/nova && npx wrangler d1 migrations list oshi-prism-nova --remote` to check for pending migrations (from the project root, read-only)
   - As of 2026-09-03 this reported nothing to apply. If it now lists anything other than the migration file(s) this deploy is meant to add, STOP: `oshi-prism-nova`'s `d1_migrations` table has drifted from the migrations directory; see `docs/vod-export-rollout.md` for why this matters before applying anything.
2. Run `cd tools/nova && npx wrangler d1 migrations apply oshi-prism-nova --remote` to apply pending migrations (from the project root)
3. Run `cd tools/nova && npx wrangler deploy` to deploy the worker (from the project root)
4. Report the deployed URL and version ID

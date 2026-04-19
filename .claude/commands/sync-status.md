---
description: Report which streamers have stale local data vs. admin DB
---

Check which streamers have drifted from the admin D1 DB since their last sync-data run:

1. `cd the project root (the git repo root)` first to ensure you are in the project root.
2. Run `npx wrangler whoami` to verify Cloudflare auth. If it fails or shows not logged in, ask the user to run `npx wrangler login` first.
3. Run `npm run sync:status` from the project root.
4. The command prints a table and exits 0 if every enabled streamer is fresh, 1 if any are stale. No commits — this is read-only.

When stale streamers are reported, suggest either `/sync-stale` (auto-sync all) or `/sync-data <slug>` (one at a time).

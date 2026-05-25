---
description: Fetch YouTube subscriber count + avatar for all approved streamers into Nova DB
---

Refresh subscriber counts and avatars for every approved streamer — the agent equivalent of
the admin "Fetch All Channel Info" button:

1. `cd` to the project root (the git repo root) first to ensure you are in the project root.
2. Run `npx wrangler whoami` to verify Cloudflare auth. If it fails or shows not logged in, ask the user to run `npx wrangler login` first.
3. Run `npm run fetch:channel-info` from the project root.
4. If the script reports `YOUTUBE_API_KEY not found in admin/.dev.vars`, ask the user to add a `YOUTUBE_API_KEY=<key>` line to `admin/.dev.vars` (the same key the admin worker uses; the file is gitignored), then re-run.
5. Report the printed summary (updated / failed counts and the per-streamer results).
6. This writes to the Nova D1 only. If the user wants the refreshed counts on the public site, suggest running `/sync-registry` (and deploying) afterward.

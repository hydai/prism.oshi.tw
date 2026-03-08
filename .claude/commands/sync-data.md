---
description: Export approved songs/streams from admin DB to data/{slug}/, commit and push
---

Export approved data from admin D1 to the fan-site static JSON:

1. Ask the user which streamer slug to export (e.g., mizuki, gabu) if not provided as argument: $ARGUMENTS
2. `cd the project root (the git repo root)` first to ensure you are in the project root.
3. Run `npx wrangler whoami` to verify Cloudflare auth. If it fails or shows not logged in, ask the user to run `npx wrangler login` first.
4. Run `npx tsx tools/sync-data/sync.ts <slug>` from the project root
5. Run `git diff data/<slug>/songs.json data/<slug>/streams.json` to show what changed
6. If there are changes, commit with message `data: sync <slug> songs and streams from DB (N songs, M performances, L streams)` using the counts from the sync output, and push
7. If no changes, say "Data already up to date for <slug>"

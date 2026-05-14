---
description: Report pending Nova Streamer, Nova VOD, and Crystal inbox items
---

Check whether any public submission/question inbox needs curator attention without opening the deployed admin website:

1. `cd the project root (the git repo root)` first to ensure you are in the project root.
2. Run `npx wrangler whoami` to verify Cloudflare auth. If it fails or shows not logged in, ask the user to run `npx wrangler login` first.
3. Run `npm run inbox:status` from the project root.
4. The command prints a read-only report for:
   - Nova Streamer submissions (`oshi-prism-nova.submissions`)
   - Nova VOD submissions (`oshi-prism-nova.vod_submissions` + `vod_songs` count)
   - Crystal tickets (`oshi-crystal.tickets`)
5. Exit code is `0` when every inbox has zero pending rows, and `1` when any inbox has pending rows. Treat exit `1` as actionable, not as a script failure.
6. No commits, DB writes, deploys, or website login are required for this check.

When pending rows are reported, summarize the IDs and links/details so the user can decide whether to open the admin UI for moderation.

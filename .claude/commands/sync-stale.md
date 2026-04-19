---
description: Auto-sync every stale streamer and commit per-streamer
---

Sync all streamers whose local data has drifted from admin D1:

1. `cd the project root (the git repo root)` first to ensure you are in the project root.
2. Run `npx wrangler whoami` to verify Cloudflare auth. If it fails or shows not logged in, ask the user to run `npx wrangler login` first.
3. Run `npm run sync:status` to show the drift report to the user. Note the list of stale slugs.
4. If no streamers are stale, say "Everything is up to date" and stop.
5. Run `npm run sync:stale`. This runs `sync-data` for each stale slug and stamps `data/.sync-state.json`. Capture the per-streamer totals from its output (`total: N songs, M performances, L streams`).
6. For each slug that was synced, create a separate commit matching the existing convention:
   - Stage only that slug's files: `git add data/<slug>/songs.json data/<slug>/streams.json`
   - Commit message: `data: sync <slug> songs and streams from DB (N songs, M performances, L streams)` using the slug's own counts.
7. After all per-streamer commits are done, stage and commit the state file: `git add data/.sync-state.json` and commit with `chore: update sync-state for <slug1>, <slug2>, ...`.
8. Push all commits in one `git push`.
9. Run `npm run sync:status` one more time to confirm everything is fresh.

Notes:
- If a streamer's `songs.json`/`streams.json` didn't actually change (e.g. only counts in state drifted from a prior tool bug), skip its data commit and include it only in the state-file commit.
- If any sync-data invocation fails, stop and report which slug failed so the user can investigate.

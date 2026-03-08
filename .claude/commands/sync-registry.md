---
description: Sync Nova DB → registry.json, commit and push
---

Sync approved streamer data from Nova D1 to the codebase:

1. Run `npx wrangler whoami` to verify Cloudflare auth. If it fails or shows not logged in, ask the user to run `npx wrangler login` first.
2. Run `npm run sync:registry` from the project root
3. Run `git diff data/registry.json lib/streamer-slugs.ts` to show what changed
4. If there are changes, commit with message `chore: sync registry from Nova DB` and push
5. If no changes, say "Registry already up to date"

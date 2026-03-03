---
description: Sync Nova DB → registry.json, commit and push
---

Sync approved streamer data from Nova D1 to the codebase:

1. Run `npm run sync:registry` from the project root
2. Run `git diff data/registry.json lib/streamer-slugs.ts` to show what changed
3. If there are changes, commit with message `chore: sync registry from Nova DB` and push
4. If no changes, say "Registry already up to date"

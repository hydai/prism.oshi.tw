---
description: Deploy the Nova submission worker to Cloudflare
---

Deploy the Nova worker:

1. Run `cd tools/nova && npx wrangler d1 migrations list oshi-prism-nova --remote` to check for pending migrations (from the project root, read-only)
   - As of 2026-09-03 this reported nothing to apply. If it now lists anything other than the migration file(s) this deploy is meant to add, STOP: `oshi-prism-nova`'s `d1_migrations` table has drifted from the migrations directory; see `docs/vod-export-rollout.md` for why this matters before applying anything.
2. Run `cd tools/nova && npx wrangler d1 migrations apply oshi-prism-nova --remote` to apply pending migrations (from the project root)
3. Run `cd tools/nova && npx wrangler deploy` to deploy the worker (from the project root)
4. Smoke — every request gets its own nonce, so headers and body must come from ONE response (`curl -si`, never `-I` plus a second call; write the captures into your scratch directory):
   - `curl -si https://nova.oshi.tw/ > nova.txt`, then `grep -i -o "'nonce-[^']*'" nova.txt` (the header's value, printed twice — once for `script-src`, once for `style-src`; both must be identical) and `grep -o 'nonce="[^"]*"' nova.txt | sort -u` (exactly one value, equal to the header's).
   - Cache: `curl -si https://nova.oshi.tw/status > s1.txt` then `curl -si https://nova.oshi.tw/status > s2.txt`. `grep -i x-status-cache s2.txt` shows `HIT` (the edge lowercases header names, so grep case-insensitively), and its body nonce equals ITS OWN header nonce — not `s1.txt`'s.
   - Open the form in a browser with DevTools open: the Turnstile widget renders, the theme toggle works, and the console shows no CSP violation. This is also the only check that sees Cloudflare's edge-injected scripts (`wrangler dev` and the curls above cannot). See `docs/csp.md`.
5. Report the deployed URL and version ID

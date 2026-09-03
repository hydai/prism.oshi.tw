---
description: Deploy the Crystal feedback worker to Cloudflare
---

Deploy the Crystal worker:

1. Run `cd tools/crystal && npx wrangler deploy` to deploy the worker (from the project root)
2. Smoke — every request gets its own nonce, so headers and body must come from ONE response (`curl -si`, never `-I` plus a second call; write the captures into your scratch directory):
   - `curl -si https://crystal.oshi.tw/ > crystal.txt`, then `grep -i -o "'nonce-[^']*'" crystal.txt` (the header's value, printed twice — once for `script-src`, once for `style-src`; both must be identical) and `grep -o 'nonce="[^"]*"' crystal.txt | sort -u` (exactly one value, equal to the header's). Repeat for `https://crystal.oshi.tw/qa` into `crystal-qa.txt`.
   - Open the form in a browser with DevTools open: the Turnstile widget renders, the theme toggle works, and the console shows no CSP violation. This is also the only check that sees Cloudflare's edge-injected scripts (`wrangler dev` and the curls above cannot). See `docs/csp.md`.
3. Report the deployed URL and version ID

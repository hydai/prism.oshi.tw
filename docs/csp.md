# Content-Security-Policy (Nova & Crystal)

Both the Nova and Crystal Workers send a real `Content-Security-Policy` header
on every response (`secureHeaders({ contentSecurityPolicy })` from
`hono/secure-headers`, registered on `*`, before `cors()` on Nova). Inline
`<script>`/`<style>` tags are allowed only through a per-request nonce —
nothing needs `'unsafe-inline'` for scripts or the `<style>` block.

## The policy

Nova (`tools/nova/src/index.ts`):

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'self';
form-action 'self';
script-src 'nonce-<random>' 'self' https://challenges.cloudflare.com;
style-src 'nonce-<random>' 'self' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
font-src https://fonts.gstatic.com;
img-src 'self' data: https://yt3.ggpht.com https://yt4.ggpht.com
        https://yt3.googleusercontent.com https://lh3.googleusercontent.com
        https://i.ytimg.com https://i1.ytimg.com https://i2.ytimg.com
        https://i3.ytimg.com https://i4.ytimg.com https://i9.ytimg.com
        https://img.youtube.com;
connect-src 'self';
frame-src https://challenges.cloudflare.com;
```

Nova also sets `Referrer-Policy: same-origin` (overriding Hono's `no-referrer`
default): its form pages' auto-fill calls are same-origin GET fetches that
carry no `Origin` header, so browsers without Fetch Metadata support
(Safari/iOS ≤ 16.3, Firefox < 90, Chrome < 76) would otherwise get a 403 from
`isTrustedRequest`'s Referer fallback on their own pages.

Crystal (`tools/crystal/src/index.ts`): identical policy except `img-src 'self'
data:` — Crystal renders no remote images, so none of Nova's YouTube/avatar
hosts apply — and it keeps Hono's default `Referrer-Policy: no-referrer`
(Crystal has no same-origin auto-fill fetch that needs the Referer restored).

The `img-src` host list (`NOVA_IMAGE_HOSTS` in
`admin/shared/nova-url-safety.ts`) is derived from the same `allowedHosts` set
`sanitizeNovaUrl()` enforces at submit time, so the two cannot drift apart —
widening one widens the other.

## Scripts Cloudflare injects at the edge

`'self'` in `script-src` is not there for anything the workers emit — every
inline tag they write carries the nonce. It is there for what the zone appends
after the worker has returned.

Cloudflare's Bot Fight Mode injects its **JavaScript Detections** bootstrap
into every HTML response: an inline `<script>` that creates a hidden 1×1
iframe and, inside it, loads
`/cdn-cgi/challenge-platform/scripts/jsd/main.js` — from *our own* origin.
Verified 2026-09-04 with a browser-UA `curl` of `https://nova.oshi.tw/` and
`/status` and of `https://crystal.oshi.tw/` and `/qa`: all four carry it.

- The **inline bootstrap** needs nothing from us. Cloudflare's docs: "If your
  CSP uses a `nonce` for script tags, Cloudflare will add these nonces to the
  scripts it injects by parsing your CSP response header." That holds on
  `/status` cache hits too — the hit path rewrites the cached body to the
  nonce its own fresh header carries (below), so the header Cloudflare parses
  is the one the served document matches.
- The **`main.js` fetch** does need a source. Same docs: "Ensure that anything
  under `/cdn-cgi/challenge-platform/` is allowed. Your CSP should allow
  scripts served from your origin domain (`script-src self`)." Hence `'self'`.
  Without it that script is blocked inside the iframe (an `about:blank` frame
  inherits its parent's policy — `frame-src` is not consulted for it), Bot
  Fight Mode loses the signal that says a visitor is a real browser, and every
  production page load logs a CSP violation.

`'self'` cannot turn a route of ours into a script source: every API route
answers `application/json`, and `X-Content-Type-Options: nosniff` (a
`secureHeaders` default) makes the browser refuse a non-JavaScript MIME type
for a script.

Cloudflare **Web Analytics is not enabled** on either host — the same curl
check finds no `static.cloudflareinsights.com` beacon tag. If it is ever
turned on for the zone, `script-src` needs
`https://static.cloudflareinsights.com` (the bare host, not the docs'
`…/beacon.min.js` path — the injected URL is `/beacon.min.js/v<hash>`, which a
path source not ending in `/` would not match) and `connect-src` needs
`https://cloudflareinsights.com`.

## Why style attributes are allowed (D1)

`style-src-attr 'unsafe-inline'`. The shared `svgIcon()`/`SPARKLE_SVG`/
`themeToggleHTML()` helpers and several per-row fallback tiles use `style="…"`
throughout. An attribute cannot execute script (unlike an inline event
handler), and every value interpolated into one has been escaped since Phase
5A — so allowing them costs nothing a nonce would otherwise buy, while
converting the ~40 call sites to classes would be a much larger refactor
(tracked as a follow-up, not done here).

Consequence accepted: `style-src-attr` is a CSP3-only directive. Browsers that
predate it (Safari < 15.4, Firefox < 116) ignore it and fall back to applying
the nonce-only `style-src` to `style="…"` attributes, silently dropping them —
a cosmetic degradation (a duplicated avatar fallback tile, a visible
broken-preview icon), not a functional or security regression. If this ever
needs tightening, the fix is a `'sha256-…'` hash of the specific inline style
(or moving those call sites to classes), never `'unsafe-inline'` in `style-src`
itself — that would defeat the nonce for every browser to spare a few. A *host*
source is not an option either: a host in `style-src` admits external
stylesheets only, never an inline `<style>` or a `style="…"` attribute.

## Why no report-only rollout (D2)

Shipped enforcing directly, not `Content-Security-Policy-Report-Only` first.
Five pages total, a local Playwright browser proof before every deploy (see
below), and `npx wrangler rollback` as a one-command undo made a report-only
phase — plus a `/api/csp-report` sink and a day of `wrangler tail` — more
machinery than this change's size warranted.

## The preview-image delta (D3)

Nova's `/` live avatar preview (`page.ts`) sets the `<img src>` from the raw
`avatar_url` field after only an `https://` check. Under the policy, a host
outside `NOVA_IMAGE_HOSTS` simply fails to load, and the existing
error-listener fallback shows the placeholder tile instead of the image.
Accepted deliberately: the server already rejects such URLs at submit time via
`sanitizeNovaUrl`, so this only affects the transient client-side preview of a
value that would be rejected on submit anyway, never anything that reaches
storage.

## How nonces flow

1. `secureHeaders({ contentSecurityPolicy: { scriptSrc: [NONCE, …], styleSrc:
   [NONCE, …] } })` generates one nonce per request (16 random bytes, 22
   base64 characters plus `==` padding) and stores it on the Hono context as
   `secureHeadersNonce` before any route handler runs.
2. Each route handler calls a local `requireNonce(c)` helper, which reads
   `c.get('secureHeadersNonce')` and throws (500) if it's missing — a missing
   nonce means the middleware was bypassed, a wiring bug rather than something
   a request could cause.
3. The nonce is passed into `pageShell({ …, nonce })`
   (`tools/shared/web/page-shell.ts`), which stamps it on the head detect
   script, the Turnstile loader `<script src=…>` (Turnstile propagates it to
   whatever it injects), the one `<style>` block, and the trailing page
   script; and into `themeToggleHTML(nonce)` (`tools/shared/web/theme.ts`),
   which stamps it on its own inline `<script>`. Both throw on an empty-string
   nonce rather than silently emitting an un-nonced tag.

No page module writes a literal `<script>`/`<style>` tag itself — only those
two shared modules do, and the hygiene guard below enforces that.

## The `/status` cache nonce rule

Nova's `GET /status` is cached at the edge (Workers Cache API, keyed by the
validated `vtuber`/`vod` filters, `STATUS_CACHE_TTL_SECONDS = 60`) to protect
D1's shared row-read budget from an ungated flood on a public page. The stored
copy is one request's render, carrying that request's nonce in its
`nonce="…"` attributes — but `secureHeaders()` stamps a *fresh* nonce on every
response, cache hits included, so serving the cached body verbatim would carry
a nonce its own header doesn't allow and the browser would drop every inline
tag. Fix: the miss path stores the copy with an extra `X-Status-Nonce` header
recording its own nonce; the hit path reads that header, reads the current
request's nonce via `requireNonce(c)`, and serves
`(await hit.text()).replaceAll(storedNonce, currentNonce)` — a same-length
string replace over the cached body — then drops `X-Status-Nonce` and marks
`X-Status-Cache: HIT`. A stored copy without the header (predating this rule)
is re-rendered rather than served with dead scripts.

## The hygiene guard

`tools/nova/src/csp-hygiene.test.ts` (run as `test:csp-hygiene` in Nova's
`npm run check`; it scans `tools/nova/src`, `tools/crystal/src`, and
`tools/shared/web` together, so Crystal's own `check` does not duplicate it)
statically scans every non-test `.ts` source for: an inline event-handler
attribute (` onclick="`, ` onerror="`, …) — CSP's `script-src`, with no
`script-src-attr` beside it, governs those too, so one would silently stop
working with nothing to catch it until someone looked; a `<script>`/`<style>`
opening tag outside `page-shell.ts`/`theme.ts`, the only two modules allowed
to emit one; and `eval(`/`new Function(`, which no nonce can ever allow.

## The browser check

`npm run check:csp-browser -- --nova <origin> --crystal <origin>` —
`tools/csp-browser-check.ts`, a manual gate (not run in CI, since it needs two
live dev servers).

**Prerequisites** (nothing else provisions these — verified against what
these runs actually needed):
- Nova's local D1 migrated and seeded: `npm --prefix tools/nova run
  db:migrate:local` then `npm --prefix tools/nova run db:seed:local`.
  `/status` also reads Nova's `ADMIN_DB` binding (`oshi-prism-db`) — load
  `admin/schema.sql` into it once: `npx --prefix tools/nova wrangler d1
  execute oshi-prism-db --local --config tools/nova/wrangler.toml
  --file=admin/schema.sql`.
- A local Nova D1 seeded before this change keeps the old `seed-mizuki`
  avatar (the seed is `INSERT OR IGNORE`, so re-seeding does not touch the
  row) and `/status` then shows a fallback tile plus an `img-src` violation.
  Rebuild the database, or point the row at the value in `tools/nova/seed.sql`:
  `npx --prefix tools/nova wrangler d1 execute oshi-prism-nova --local --config
  tools/nova/wrangler.toml --command "UPDATE submissions SET avatar_url='<value>'
  WHERE id='seed-mizuki'"`. Production needs nothing: fetch-channel-info long ago
  rewrote every live avatar onto `yt3.ggpht.com`.
- Crystal's local D1 migrated: `npm --prefix tools/crystal run
  db:migrate:local`.
- Network access to `challenges.cloudflare.com` and to `www.youtube.com`.
  Nova `/`'s auto-fill (`/api/channel-info`) fetches the typed channel's real
  YouTube page directly — no API key involved for this route — and the check
  deliberately types a real handle (`@YouTube`) so that fetch succeeds; a
  `502 (Bad Gateway)` console error here means that upstream fetch failed
  (network unreachable, or the handle no longer resolves), not a missing key.

Start both dev servers, with Cloudflare's "always passes" test Turnstile
sitekey:

```
npx --prefix tools/nova wrangler dev --config tools/nova/wrangler.toml \
  --port 18787 --var TURNSTILE_SITE_KEY:1x00000000000000000000AA

npx --prefix tools/crystal wrangler dev --config tools/crystal/wrangler.toml \
  --port 18788 --var TURNSTILE_SITE_KEY:1x00000000000000000000AA
```

Then:

```
npm run check:csp-browser -- --nova http://localhost:18787 --crystal http://localhost:18788
```

It visits Nova `/`, `/vod`, `/status` and Crystal `/`, `/qa`; asserts zero
`securitypolicyviolation` events and zero console errors on every page; that
the response header's nonce matches every `<script>`/`<style>` tag's live
`.nonce` property (read via the IDL property, not `getAttribute` — the HTML
spec blanks the content attribute once such a tag is attached to the
document); on the three Turnstile pages, that the hidden
`cf-turnstile-response` input becomes non-empty and that a
`https://challenges.cloudflare.com/` frame shows up in Playwright's
browser-level frame tree — **not** that a DOM `<iframe>` selector matches:
Turnstile mounts its iframe inside a closed shadow root that no DOM selector,
Playwright's `waitForSelector` included, can ever see; that the shared theme
toggle flips `html.dark`; and that Nova `/`'s duplicate-check fetch fires on
blur. Exits 1 with the full failure list on any violation.

One blind spot: `wrangler dev` has no Cloudflare edge in front of it, so this
local check can never see the edge-injected scripts above — the post-deploy
browser step in the deploy runbooks (DevTools console shows no CSP violation)
is what covers them.

## Rollback

`npx wrangler rollback` in the affected worker's directory (`tools/nova` or
`tools/crystal`) reverts to the previously deployed version.

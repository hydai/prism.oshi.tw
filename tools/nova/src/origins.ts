/**
 * Cross-origin allow-list for Aurora (the VOD editor), and the trusted-origin
 * check shared by every Nova route that must reject requests from arbitrary
 * third-party pages. This is the single source of truth for both — Nova used
 * to have three separate hand-rolled checks (one `cors()` origin list plus two
 * manual Referer/Origin gates), two of which compared the Referer by substring
 * (`referer.includes(host)`, `referer.startsWith(o)`) instead of by parsed
 * origin, which a crafted URL can satisfy without actually being that origin.
 */
export const ALLOWED_ORIGINS = ['https://aurora.oshi.tw', 'https://oshi-prism-aurora.pages.dev'] as const;

/**
 * True when a request is same-origin (per the `Sec-Fetch-Site` header), or
 * carries an `Origin`/`Referer` whose *parsed* origin is the worker's own
 * origin or one of `ALLOWED_ORIGINS`.
 *
 * `Origin`, when present, is authoritative — a `Referer` is consulted only
 * when there is no `Origin` header at all. Origins are compared by exact
 * string equality after parsing with `new URL()`, never by substring: e.g.
 * `https://evil.example/?nova.oshi.tw` contains the host only in its query
 * string, and `https://aurora.oshi.tw.evil.example` merely starts with an
 * allowed origin — both must be rejected. A missing or unparsable `Referer`
 * is untrusted.
 *
 * The worker's own origin comes from the request URL, not from `https://` glued
 * onto the `Host` header. That keeps the scheme honest — a Referer-only request
 * to `wrangler dev` on `http://127.0.0.1:8787` is same-origin and must pass —
 * and it leaves no degenerate case for a missing or empty `Host`, which used to
 * make the self origin the bare string `https://`.
 */
export function isTrustedRequest(request: Request): boolean {
  const headers = request.headers;
  if (headers.get('Sec-Fetch-Site') === 'same-origin') return true;

  const selfOrigin = new URL(request.url).origin;
  const isTrustedOrigin = (origin: string): boolean =>
    origin === selfOrigin || (ALLOWED_ORIGINS as readonly string[]).includes(origin);

  const origin = headers.get('Origin');
  if (origin !== null) return isTrustedOrigin(origin);

  const referer = headers.get('Referer');
  if (!referer) return false;
  try {
    return isTrustedOrigin(new URL(referer).origin);
  } catch {
    return false;
  }
}

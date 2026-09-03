// Regression guard for T7.1: Nova used three separate hand-rolled origin checks,
// two of which compared the Referer by substring (`referer.includes(host)` /
// `referer.startsWith(o)`) instead of by parsed origin. `isTrustedRequest` is the
// single replacement — these tests pin its exact-origin semantics, including the
// substring bypass the audit found. Run with: npm run test:origins
import { ALLOWED_ORIGINS, isTrustedRequest } from './origins';

declare const process: { exitCode?: number };

// --- tiny assert helper (matches admin/src/helpers.test.ts convention) ---
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const HOST = 'nova.oshi.tw';
const SELF_ORIGIN = `https://${HOST}`;

/** A request to the worker itself, carrying `headers`. */
function request(headers: Record<string, string>, url = `${SELF_ORIGIN}/api/channel-info`): Request {
  return new Request(url, { headers });
}

function testSameOriginHeaderAloneIsTrusted(): void {
  assertEqual(isTrustedRequest(request({ 'Sec-Fetch-Site': 'same-origin' })), true, 'Sec-Fetch-Site: same-origin is trusted with no other headers');
}

function testOriginMatchingHostIsTrusted(): void {
  assertEqual(isTrustedRequest(request({ Origin: SELF_ORIGIN })), true, "Origin exactly matching the request URL's origin is trusted");
}

function testOriginInAllowListIsTrusted(): void {
  for (const allowed of ALLOWED_ORIGINS) {
    assertEqual(isTrustedRequest(request({ Origin: allowed })), true, `Origin ${allowed} is in ALLOWED_ORIGINS`);
  }
}

function testOriginSuffixBypassIsRejected(): void {
  // The old `referer.startsWith(o)` check would have let this through, since the
  // string starts with an allowed origin. Exact equality must reject it.
  assertEqual(isTrustedRequest(request({ Origin: 'https://aurora.oshi.tw.evil.example' })), false, 'an origin merely prefixed by an allowed origin is rejected');
}

function testUntrustedOriginIgnoresTrustedReferer(): void {
  const req = request({ Origin: 'https://evil.example', Referer: `${SELF_ORIGIN}/dashboard` });
  assertEqual(isTrustedRequest(req), false, 'a present Origin is authoritative — a trusted Referer does not override it');
}

function testRefererMatchingHostIsTrusted(): void {
  assertEqual(isTrustedRequest(request({ Referer: `${SELF_ORIGIN}/x` })), true, "Referer whose parsed .origin matches the request URL's origin is trusted");
}

function testRefererInAllowListIsTrusted(): void {
  assertEqual(isTrustedRequest(request({ Referer: `${ALLOWED_ORIGINS[1]}/editor` })), true, "Referer whose parsed .origin is in ALLOWED_ORIGINS is trusted");
}

function testRefererSubstringBypassIsRejected(): void {
  // The audit's finding: the old `referer.includes(host)` check matched this,
  // because the host appears in the query string, not as the referer's origin.
  assertEqual(isTrustedRequest(request({ Referer: `https://evil.example/?${HOST}` })), false, 'a host that only appears as a substring of Referer is rejected');
}

function testMalformedRefererIsRejected(): void {
  assertEqual(isTrustedRequest(request({ Referer: 'not a url' })), false, 'a Referer that new URL() cannot parse is rejected');
}

function testNoHeadersIsRejected(): void {
  assertEqual(isTrustedRequest(request({})), false, 'no Sec-Fetch-Site, Origin or Referer at all is rejected');
}

function testHttpSelfOriginIsTrusted(): void {
  // `wrangler dev` (and any local workerd run) serves over http. Deriving the self
  // origin from the request URL keeps the scheme honest, so a Referer-only request
  // to the dev server is same-origin. Gluing `https://` onto the Host header — what
  // this used to do — rejected it.
  const devUrl = 'http://127.0.0.1:8787/api/channel-info';
  assertEqual(isTrustedRequest(request({ Referer: 'http://127.0.0.1:8787/' }, devUrl)), true, 'a Referer-only request to the http dev server is same-origin');
}

function testMismatchedSchemeIsRejected(): void {
  // The flip side: over https, an http Referer for the same host is a different
  // origin and stays untrusted.
  assertEqual(isTrustedRequest(request({ Referer: `http://${HOST}/` })), false, 'an http Referer is not the origin of an https request');
}

function testHostHeaderCannotForgeTheSelfOrigin(): void {
  // The self origin comes from the request URL, so a spoofed or empty Host header
  // changes nothing. An empty Host used to make the self origin the bare string
  // `https://`, which a literal `Origin: https://` then matched.
  const spoofed = request({ Host: 'evil.example', Origin: 'https://evil.example' });
  assertEqual(isTrustedRequest(spoofed), false, 'an Origin matching a spoofed Host header is still rejected');
  const degenerate = request({ Host: '', Origin: 'https://' });
  assertEqual(isTrustedRequest(degenerate), false, 'a bare "https://" Origin is nobody\'s origin, whatever Host says');
}

try {
  testSameOriginHeaderAloneIsTrusted();
  testOriginMatchingHostIsTrusted();
  testOriginInAllowListIsTrusted();
  testOriginSuffixBypassIsRejected();
  testUntrustedOriginIgnoresTrustedReferer();
  testRefererMatchingHostIsTrusted();
  testRefererInAllowListIsTrusted();
  testRefererSubstringBypassIsRejected();
  testMalformedRefererIsRejected();
  testNoHeadersIsRejected();
  testHttpSelfOriginIsTrusted();
  testMismatchedSchemeIsRejected();
  testHostHeaderCannotForgeTheSelfOrigin();
  console.log('origins.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

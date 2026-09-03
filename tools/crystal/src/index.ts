import { Hono, type Context } from 'hono';
import { NONCE, secureHeaders, type SecureHeadersVariables } from 'hono/secure-headers';
import type { Bindings, SubmitTicketBody } from './types';
import { generateId, insertTicket, listPublicReplied, searchTickets } from './db';
import { validateTicket } from './validate';
import { verifyTurnstile } from './turnstile';
import { renderFormPage } from './form-page';
import { renderQaPage } from './qa-page';
import { parseJsonBody } from '../../shared/web/json-body';

/** `Variables` carries `secureHeadersNonce`, the per-request CSP nonce (see requireNonce). */
type AppEnv = { Bindings: Bindings; Variables: SecureHeadersVariables };

const app = new Hono<AppEnv>();

/**
 * This request's CSP nonce, for the page handlers to stamp on their inline tags.
 *
 * `secureHeaders()` below is registered on `*` and generates the nonce while
 * building the policy — before any route handler runs — so a missing value means
 * the middleware was bypassed and the page would render script the browser then
 * refuses to run. That is a wiring bug, not a request the user can cause, so it
 * throws (a 500) instead of silently shipping a dead page.
 */
function requireNonce(c: Context<AppEnv>): string {
  const nonce = c.get('secureHeadersNonce');
  if (!nonce) throw new Error('secureHeaders did not run before this handler');
  return nonce;
}

// Security headers (Hono defaults: X-Frame-Options SAMEORIGIN, Referrer-Policy
// no-referrer, X-Content-Type-Options nosniff, Strict-Transport-Security,
// Cross-Origin-Opener-Policy, etc.). Crystal has no cors() middleware, and unlike
// Nova it has no same-origin auto-fill fetch that would need the Referer restored
// on browsers without Fetch Metadata — so the default no-referrer stays as-is.
//
// Content-Security-Policy. Inline scripts and styles exist only where the shared
// page shell and theme toggle emit them, and both stamp this request's nonce
// (NONCE makes Hono generate one before the route runs; handlers read it via
// requireNonce). Turnstile is allowed by host — its loader script and the iframe
// it renders in — and is documented to carry the nonce from its own script tag
// over to what it injects; the browser proof before deploy is what confirms that,
// and if it ever stops holding the fix is a 'sha256-…' hash of the style it
// injects (or restoring that nonce propagation), never 'unsafe-inline': a host in
// style-src admits external stylesheets only, never an inline <style> or a
// style="…" attribute.
//
// Cloudflare's Bot Fight Mode injects an inline JavaScript-detections bootstrap
// into every HTML response at the edge (verified on both live hosts 2026-09-04).
// Cloudflare stamps this header's nonce onto the scripts it injects by parsing the
// CSP response header, and the bootstrap then loads
// /cdn-cgi/challenge-platform/scripts/jsd/main.js from our own origin — which is
// why 'self' is in script-src, as Cloudflare's docs require. 'self' cannot turn a
// JSON route into a script source: secureHeaders' X-Content-Type-Options: nosniff
// makes the browser refuse a non-JavaScript MIME type for a script. Web Analytics
// is not enabled on either host; if it ever is, script-src needs
// https://static.cloudflareinsights.com and connect-src https://cloudflareinsights.com.
//
// Images: Crystal renders no remote images, so img-src is just 'self' plus data:
// for the shared .form-select chevron, which PRISM_CSS draws with an inline SVG
// URI. Style *attributes* are allowed (the
// svgIcon/sparkle helpers and the per-row fallback tiles are full of them): an
// attribute cannot run script, and every value interpolated into one is escaped.
// style-src-attr is a CSP3 directive, so browsers that predate it (Safari < 15.4,
// Firefox < 116) ignore it and apply the nonce-only style-src to style="…" instead,
// dropping those attributes — cosmetic on this site and accepted, because the
// alternative, 'unsafe-inline' in style-src, would defeat the policy for every
// browser to spare those. Report-only was skipped deliberately — two pages, a
// browser proof before deploy, and `wrangler rollback` as the undo.
//
// The CSP hygiene guard (tools/nova/src/csp-hygiene.test.ts, run via Nova's
// `check`) scans tools/crystal/src too, so a stray inline handler or an un-nonced
// <script>/<style> tag here fails Nova's suite — Crystal's own `check` does not
// duplicate that walker.
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    scriptSrc: [NONCE, "'self'", 'https://challenges.cloudflare.com'],
    styleSrc: [NONCE, "'self'", 'https://fonts.googleapis.com'],
    styleSrcAttr: ["'unsafe-inline'"],
    fontSrc: ['https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    frameSrc: ['https://challenges.cloudflare.com'],
  },
}));

// --- Form page ---

app.get('/', (c) => {
  return c.html(renderFormPage(c.env.TURNSTILE_SITE_KEY, requireNonce(c)));
});

// --- Submit ticket ---

app.post('/api/submit', async (c) => {
  const parsedBody = await parseJsonBody<SubmitTicketBody>(c.req);
  if (!parsedBody.ok) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const body = parsedBody.body;

  // Validate fields
  const validation = validateTicket(body);
  if (!validation.ok) {
    return c.json({ errors: validation.errors }, 400);
  }

  // Verify Turnstile
  const ip = c.req.header('CF-Connecting-IP');
  const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstile_token, ip);
  if (!ok) {
    return c.json({ error: '驗證失敗，請重試' }, 403);
  }

  // Insert ticket
  const id = generateId();
  const contextUrl = (body.context_url ?? '').trim();
  await insertTicket(c.env.DB, id, body, contextUrl);

  return c.json({ id }, 201);
});

// No origin/CORS gate on the GET routes below (deliberate, not an oversight): they
// serve public Q&A data anyone may read. The only write route above (POST
// /api/submit) is Turnstile-gated instead — the right control for a write, not a read.

// --- Q&A page (HTML) ---

app.get('/qa', async (c) => {
  const typeFilter = c.req.query('type') ?? '';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const q = (c.req.query('q') ?? '').trim();
  const limit = 20;

  const { tickets, total } = q
    ? await searchTickets(c.env.DB, { q, scope: 'public_replied', typeFilter, page, limit })
    : await listPublicReplied(c.env.DB, typeFilter, page, limit);
  return c.html(renderQaPage(tickets, total, page, limit, typeFilter, q, requireNonce(c)));
});

// --- Q&A data (JSON) ---

app.get('/api/qa', async (c) => {
  const typeFilter = c.req.query('type') ?? '';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const q = (c.req.query('q') ?? '').trim();

  const { tickets, total } = q
    ? await searchTickets(c.env.DB, { q, scope: 'public_replied', typeFilter, page, limit })
    : await listPublicReplied(c.env.DB, typeFilter, page, limit);
  return c.json({ data: tickets, total, page, limit, q });
});

// --- Similar tickets for duplicate detection on the submission form ---

app.get('/api/similar', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const limit = Math.min(10, Math.max(1, parseInt(c.req.query('limit') ?? '5', 10) || 5));

  // Min chars — 2 if query contains any CJK char (common 2-char compound words), else 3.
  const hasCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(q);
  const minChars = hasCJK ? 2 : 3;
  if (q.length < minChars) return c.json({ data: [] });

  const { tickets } = await searchTickets(c.env.DB, {
    q,
    scope: 'public_replied',
    page: 1,
    limit,
  });

  // Lean response — omit body / admin_reply / contact to minimize payload and PII surface.
  const data = tickets.map((t) => ({
    id: t.id,
    type: t.type,
    title: t.title,
    status: t.status,
    replied_at: t.replied_at,
    submitted_at: t.submitted_at,
  }));
  return c.json({ data });
});

export default app;

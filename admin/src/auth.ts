import type { Context, Next } from 'hono';
import type { AuthUser, Role } from '../shared/types';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

// Reads never change state, so they are exempt from the authenticity check.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type Bindings = {
  DB: D1Database;
  CURATOR_EMAILS: string;
  DEV_AUTH_EMAIL?: string;
};

type Env = { Bindings: Bindings; Variables: { user: AuthUser } };

function resolveRole(email: string, curatorEmails: string): Role {
  const curators = curatorEmails.split(',').map((e) => e.trim().toLowerCase());
  return curators.includes(email.toLowerCase()) ? 'curator' : 'contributor';
}

export async function requireAuth(c: Context<Env>, next: Next) {
  // In local dev, Miniflare strips CF-Access-* headers.
  // Use DEV_AUTH_EMAIL env var as fallback (never set in production).
  const email = c.req.header('CF-Access-Authenticated-User-Email') || c.env.DEV_AUTH_EMAIL;
  if (!email) {
    return c.json({ error: 'Unauthorized: missing CF Access header' }, 401);
  }
  const role = resolveRole(email, c.env.CURATOR_EMAILS);
  c.set('user', { email, role });
  await next();
}

export async function requireCurator(c: Context<Env>, next: Next) {
  const user = c.get('user');
  if (!user || user.role !== 'curator') {
    return c.json({ error: 'Forbidden: curator access required' }, 403);
  }
  await next();
}

// CSRF defense for state-changing /api/* requests. See admin/shared/csrf.ts and
// docs/superpowers/specs/2026-06-14-admin-csrf-design.md.
export async function requireApiRequestAuthenticity(c: Context<Env>, next: Next) {
  if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
    await next();
    return;
  }

  // Hard gate: a custom header a cross-origin attacker cannot set without a
  // CORS preflight (which this Worker never satisfies).
  if (c.req.header(REQUEST_AUTHENTICITY_HEADER) !== REQUEST_AUTHENTICITY_VALUE) {
    return c.json({ error: 'Forbidden: missing request authenticity header' }, 403);
  }

  // Defense-in-depth: reject only when the browser explicitly tells us the
  // request is cross-origin. Absent headers fall through to the hard gate above,
  // so legitimate same-origin requests are never falsely blocked.
  const secFetchSite = c.req.header('Sec-Fetch-Site');
  if (secFetchSite && secFetchSite !== 'same-origin') {
    return c.json({ error: 'Forbidden: cross-site request blocked' }, 403);
  }

  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: 'Forbidden: origin mismatch' }, 403);
  }

  await next();
}

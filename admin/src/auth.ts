import type { Context, Next } from 'hono';
import type { AuthUser, Role } from '../shared/types';

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

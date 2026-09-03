/**
 * The Worker's binding surface, declared once.
 *
 * `Env` is generated from wrangler.toml by `npm run types` (every binding plus
 * the `[vars]` block). What this file adds is exactly what that generator
 * cannot know, because it is deliberately absent from wrangler.toml: the
 * production secrets (`wrangler secret put`) and the local-dev-only values
 * curators keep in `.dev.vars`. Nothing else in the Worker declares a binding
 * shape — routes, middleware and tests all derive from these types, so a
 * binding added to wrangler.toml can never drift out of the code's view.
 *
 * `wrangler types` also injects any keys found in a local `admin/.dev.vars`
 * (gitignored, machine-specific) into the generated file — regenerate with
 * `npm run types` on a checkout without one, or revert such extra keys before
 * committing; that exact leak produced the three secret keys this file replaced.
 */
import type { AuthUser } from '../shared/types';

export type Bindings = Env & {
  /** Secret: `wrangler secret put YOUTUBE_API_KEY`. Pipeline routes 500 when unset. */
  YOUTUBE_API_KEY: string;
  /** Secret, optional: the Discord feedback relay no-ops when it is unset. */
  DISCORD_WEBHOOK_FEEDBACK?: string;
  /** `.dev.vars` only: Miniflare strips the CF-Access-* headers in local dev. */
  DEV_AUTH_EMAIL?: string;
};

/** Context values the auth middleware sets and every route may read. */
export type Variables = {
  user: AuthUser;
};

/** The Hono generic every app, sub-app and middleware in this Worker is typed with. */
export type AppEnv = { Bindings: Bindings; Variables: Variables };

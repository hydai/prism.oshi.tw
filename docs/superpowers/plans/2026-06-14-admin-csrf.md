# Admin CSRF Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop cross-site requests from driving state-changing admin `/api/*` calls (the bodyless `approve-all`/`unapprove-all` routes and every other write) by requiring an app-issued request-authenticity header, backed by Origin/`Sec-Fetch-Site` checks.

**Architecture:** A single Hono middleware `requireApiRequestAuthenticity` mounted globally on `/api/*` right after `requireAuth`. Safe methods (GET/HEAD/OPTIONS) pass through. State-changing methods must carry `X-Prism-Admin-Request: fetch` (hard gate; un-forgeable cross-origin because custom headers force a CORS preflight the Worker never satisfies) and, when `Origin`/`Sec-Fetch-Site` are present, they must indicate same-origin (defense-in-depth, reject-only-on-present-mismatch → no false positives). The admin SPA is the only HTTP caller of these routes and sends the header via its single `request()` wrapper; offline tools use `wrangler d1` directly and are unaffected (see spec §5).

**Tech Stack:** Cloudflare Workers, Hono 4, TypeScript (strict), Vite/React UI, `tsx`-run tests (no framework — inline asserts, matching `admin/src/helpers.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-14-admin-csrf-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `admin/shared/csrf.ts` | Single source of truth for the header name + value (imported by Worker and UI) | Create |
| `admin/src/auth.ts` | Add `requireApiRequestAuthenticity` middleware next to existing auth middleware | Modify |
| `admin/src/auth.test.ts` | Unit tests for the middleware (tsx + inline asserts) | Create |
| `admin/package.json` | Register `test:auth`; add it to `check` | Modify |
| `admin/src/index.ts` | Mount the middleware globally on `/api/*` | Modify |
| `admin/ui/src/api/client.ts` | Send the header on every API call (one chokepoint) | Modify |

**Commit grouping (each commit leaves a working system):**
- **Commit 1** (Tasks 1–3): the unit-tested mechanism — constants + middleware + test. Middleware is defined but **not yet mounted**, so there is no behavior change → releasable.
- **Commit 2** (Tasks 4–5): activation — UI sends the header **and** the Worker mounts the middleware, landed atomically so the SPA is never rejected by its own server → releasable.

---

## Task 1: Failing test for the middleware + register the test script

**Files:**
- Create: `admin/src/auth.test.ts`
- Modify: `admin/package.json` (scripts)

- [ ] **Step 1: Write the failing test**

Create `admin/src/auth.test.ts` with this exact content (style mirrors `admin/src/helpers.test.ts`: inline `assertEqual`, top-level `main()`, `process.exitCode` on failure). It imports things that do not exist yet (`requireApiRequestAuthenticity`, `../shared/csrf`) — that is the expected failure.

```ts
import { Hono } from 'hono';
import { requireApiRequestAuthenticity } from './auth';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';
import type { AuthUser } from '../shared/types';

declare const process: { exitCode?: number };

type Bindings = {
  DB: D1Database;
  CURATOR_EMAILS: string;
  DEV_AUTH_EMAIL?: string;
};
type Variables = { user: AuthUser };

// app.request() with a bare path builds an http://localhost/... URL,
// so the request "origin" the middleware compares against is this:
const SAME_ORIGIN = 'http://localhost';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function buildApp(): Hono<{ Bindings: Bindings; Variables: Variables }> {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('/api/*', requireApiRequestAuthenticity);
  app.get('/api/probe', (c) => c.json({ ok: true }));
  app.post('/api/probe', (c) => c.json({ ok: true }));
  return app;
}

async function status(method: string, headers?: Record<string, string>): Promise<number> {
  const res = await buildApp().request('/api/probe', { method, headers });
  return res.status;
}

const VALID = { [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE };

async function main(): Promise<void> {
  // Safe methods never require the header.
  assertEqual(await status('GET'), 200, 'safe GET passes without the authenticity header');

  // Hard gate: the custom header.
  assertEqual(await status('POST'), 403, 'POST without the header is rejected');
  assertEqual(
    await status('POST', { [REQUEST_AUTHENTICITY_HEADER]: 'nope' }),
    403,
    'POST with a wrong header value is rejected',
  );
  assertEqual(await status('POST', { ...VALID }), 200, 'POST with the correct header passes');

  // Defense-in-depth: reject only when the signal is PRESENT and cross-origin.
  assertEqual(
    await status('POST', { ...VALID, 'Sec-Fetch-Site': 'cross-site' }),
    403,
    'POST with cross-site Sec-Fetch-Site is rejected',
  );
  assertEqual(
    await status('POST', { ...VALID, Origin: 'https://attacker.invalid' }),
    403,
    'POST with a mismatched Origin is rejected',
  );
  assertEqual(
    await status('POST', { ...VALID, Origin: SAME_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }),
    200,
    'POST with the correct header + same-origin Origin/Sec-Fetch passes',
  );

  console.log('✓ requireApiRequestAuthenticity');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Register the test script**

In `admin/package.json`, add a `test:auth` script and append it to `check`. Replace:

```json
    "test:db": "npx tsx src/db.test.ts",
    "check": "npm run typecheck && npm run test:helpers && npm run test:itunes && npm run test:discord && npm run test:db"
```

with:

```json
    "test:db": "npx tsx src/db.test.ts",
    "test:auth": "npx tsx src/auth.test.ts",
    "check": "npm run typecheck && npm run test:helpers && npm run test:itunes && npm run test:discord && npm run test:db && npm run test:auth"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd admin && npm run test:auth`
Expected: FAILS — `tsx` cannot resolve `../shared/csrf` (module does not exist yet), e.g. `Cannot find module '.../shared/csrf'`.

---

## Task 2: Shared constants (single source of truth)

**Files:**
- Create: `admin/shared/csrf.ts`

- [ ] **Step 1: Create the constants module**

Create `admin/shared/csrf.ts`:

```ts
// Anti-CSRF request-authenticity marker for the admin API.
//
// The admin SPA (admin/ui) and the admin Worker API (admin/src) are same-origin,
// and the Worker sets no CORS headers. Requiring this custom header on
// state-changing requests defeats classic form / simple-request CSRF: a
// cross-origin attacker cannot add a custom header without triggering a CORS
// preflight, which fails (no Access-Control-Allow-Origin), so the real request is
// never sent. The value is NOT a secret — the protection comes from "custom
// headers force a preflight", not from the value being unguessable.
//
// Single source of truth: imported by both the Worker middleware (src/auth.ts)
// and the UI fetch wrapper (ui/src/api/client.ts) to prevent the two from drifting.
export const REQUEST_AUTHENTICITY_HEADER = 'X-Prism-Admin-Request';
export const REQUEST_AUTHENTICITY_VALUE = 'fetch';
```

- [ ] **Step 2: Run the test to verify it still fails (now for the right reason)**

Run: `cd admin && npm run test:auth`
Expected: FAILS — now because `requireApiRequestAuthenticity` is not exported from `./auth` (e.g. `requireApiRequestAuthenticity is not a function` / import is `undefined`).

---

## Task 3: Implement the middleware (turn the test green) — Commit 1

**Files:**
- Modify: `admin/src/auth.ts`

- [ ] **Step 1: Add imports and the safe-method set**

In `admin/src/auth.ts`, replace the top import/type block:

```ts
import type { Context, Next } from 'hono';
import type { AuthUser, Role } from '../shared/types';

type Bindings = {
```

with:

```ts
import type { Context, Next } from 'hono';
import type { AuthUser, Role } from '../shared/types';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

// Reads never change state, so they are exempt from the authenticity check.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type Bindings = {
```

- [ ] **Step 2: Append the middleware**

At the END of `admin/src/auth.ts` (after `requireCurator`), append:

```ts

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
```

- [ ] **Step 3: Run the middleware test to verify it passes**

Run: `cd admin && npm run test:auth`
Expected: PASS — prints `✓ requireApiRequestAuthenticity`.

- [ ] **Step 4: Run the full check (typecheck + all tests)**

Run: `cd admin && npm run check`
Expected: PASS — `tsc --noEmit` clean (it typechecks `src/auth.test.ts` and `shared/csrf.ts` too) and all test scripts including `test:auth` print their `✓` lines.

- [ ] **Step 5: Lint changed files**

Run: `cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw/.claude/worktrees/fix+admin-csrf-bulk-approve && lineguard admin/shared/csrf.ts admin/src/auth.ts admin/src/auth.test.ts admin/package.json`
Expected: all files pass.

- [ ] **Step 6: Commit 1 (mechanism, not yet wired)**

```bash
cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw/.claude/worktrees/fix+admin-csrf-bulk-approve
git status
git add admin/shared/csrf.ts admin/src/auth.ts admin/src/auth.test.ts admin/package.json
git commit -m "fix(admin): add CSRF request-authenticity middleware + tests" \
  -m "Adds requireApiRequestAuthenticity (custom header hard gate + reject-on-present-mismatch Origin/Sec-Fetch-Site) and a tsx unit test. Not yet mounted, so no behavior change. Header name/value live in shared/csrf.ts as the single source of truth for Worker + UI." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 4: Send the header from the UI client

**Files:**
- Modify: `admin/ui/src/api/client.ts`

- [ ] **Step 1: Import the constants**

In `admin/ui/src/api/client.ts`, immediately after the existing `} from '../../../shared/types';` import block (around line 43), add:

```ts
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../../../shared/csrf';
```

- [ ] **Step 2: Add the header to the fetch wrapper**

In the `request()` function, replace:

```ts
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
```

with:

```ts
    headers: {
      'Content-Type': 'application/json',
      [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      ...init?.headers,
    },
```

- [ ] **Step 3: Typecheck the UI**

Ensure UI deps exist (first run only), then typecheck:

Run: `cd admin/ui && npm install && npx tsc -b`
Expected: PASS — no type errors (the import resolves via `ui/tsconfig.json`'s `include: ["src", "../shared"]`). If `tsc -b` reports a non-composite project error, use `npx tsc --noEmit` instead; either must be clean.

- [ ] **Step 4: Do NOT commit yet**

This change is a harmless no-op until the server enforces it. It is committed together with the wiring in Task 5 so enforcement and compliance land in the same commit.

---

## Task 5: Mount the middleware globally — Commit 2 (activation)

**Files:**
- Modify: `admin/src/index.ts`

- [ ] **Step 1: Import the middleware**

In `admin/src/index.ts`, replace the existing auth import (line 2):

```ts
import { requireAuth, requireCurator } from './auth';
```

with:

```ts
import { requireApiRequestAuthenticity, requireAuth, requireCurator } from './auth';
```

- [ ] **Step 2: Mount it after requireAuth**

Replace:

```ts
// All routes require authentication
app.use('/api/*', requireAuth);
```

with:

```ts
// All routes require authentication, and state-changing requests must carry an
// app-issued authenticity header (CSRF defense). See admin/shared/csrf.ts.
app.use('/api/*', requireAuth);
app.use('/api/*', requireApiRequestAuthenticity);
```

- [ ] **Step 3: Run the full check**

Run: `cd admin && npm run check`
Expected: PASS — typecheck clean, all tests green.

- [ ] **Step 4: Lint changed files**

Run: `cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw/.claude/worktrees/fix+admin-csrf-bulk-approve && lineguard admin/src/index.ts admin/ui/src/api/client.ts`
Expected: all files pass.

- [ ] **Step 5: Commit 2 (activation + client header, atomic)**

```bash
cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw/.claude/worktrees/fix+admin-csrf-bulk-approve
git status
git add admin/src/index.ts admin/ui/src/api/client.ts
git commit -m "fix(admin): enforce request-authenticity on /api/* and send it from the UI" \
  -m "Mounts requireApiRequestAuthenticity globally on /api/* so cross-site state-changing requests (incl. the bodyless approve-all/unapprove-all) are rejected, and adds the matching header to the UI client's request() wrapper so the SPA keeps working. Closes the CSRF finding." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 6: Final verification

- [ ] **Step 1: Confirm the green baseline end-to-end**

Run: `cd admin && npm run check`
Expected: PASS — typecheck + `test:helpers`, `test:itunes`, `test:discord`, `test:db`, `test:auth` all print `✓`.

- [ ] **Step 2: Confirm the UI builds with the change**

Run: `cd admin/ui && npx tsc -b` (or `npx tsc --noEmit`)
Expected: PASS.

- [ ] **Step 3: Reason about the negative case (no test runtime for the real Worker)**

Confirm by reading `admin/src/index.ts` that the middleware is mounted after `requireAuth` on `/api/*`, and that `bulkApproveStream`'s route (`POST /api/streams/:streamId/approve-all`) sits under that `app.use`. A cross-site bodyless POST now hits `requireApiRequestAuthenticity` first → 403 (no header). The admin SPA sends the header on every call via `request()`, so the UI is unaffected.

- [ ] **Step 4: Deployment note (do NOT auto-run)**

Per `CLAUDE.md`, `admin/` changes only take effect after `/deploy-admin` (which also rebuilds `ui/dist`). Deployment is user-triggered — surface this as a reminder; do not deploy automatically.

---

## Self-Review (completed during planning)

- **Spec coverage:** §3.1 constants → Task 2; §3.2 middleware (5-step logic) → Task 3; §3.3 wiring → Task 5; §3.4 client header → Task 4; §4 test cases (all 7) → Task 1; §5 compatibility (no other callers) → Task 6 Step 3 reasoning. No gaps.
- **Placeholder scan:** none — every code/command step is concrete.
- **Type consistency:** `REQUEST_AUTHENTICITY_HEADER`/`REQUEST_AUTHENTICITY_VALUE` and `requireApiRequestAuthenticity` are spelled identically across Tasks 1–5; the test's `Bindings`/`Variables` mirror `auth.ts`'s `Env`.

# VOD Import Retry (Issue #10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VOD approval re-runnable after a failed admin-DB import by gating the import on admin-DB existence (`videoIdExists`) instead of the Nova status transition.

**Architecture:** Extract the import decision into a pure `shouldImportVod(targetStatus, alreadyImported)` in `admin/src/status.ts`. In `PATCH /api/nova/vods/:id/status`, fetch the VOD row when the target is `approved`, compute `alreadyImported = videoIdExists(...)`, and import only when `shouldImportVod` is true. `importVodToAdminDb` writes via an atomic `db.batch()`, so a failed import leaves zero admin rows and the next retry re-imports; a re-approve of an already-imported VOD sees `alreadyImported === true` and skips, preserving curated performances.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1. Tests are self-contained `tsx` scripts with top-level `assertEqual` (no test framework, no D1 mock).

**Spec:** `docs/superpowers/specs/2026-06-14-pr9-followups-design.md` §2.

**Branch:** `fix/vod-import-retry` (already created; carries the spec + this plan).

---

## File Structure

- `admin/src/status.ts` — add the pure `shouldImportVod` next to `isValidTransition`. Needs `NovaStatus` added to its existing `import type` from `../shared/types`.
- `admin/src/helpers.test.ts` — the existing catch-all unit test for `status.ts`; append `shouldImportVod` assertions and add it to the `./status` import.
- `admin/src/index.ts` — VOD status endpoint (~lines 1223–1240): add `shouldImportVod` to the line-4 `./status` import and rewire the gate. `videoIdExists` is already imported from `./db`.

No `package.json` change: `helpers.test.ts` is already wired into `npm run check`.

All admin commands run from the `admin/` directory (it has its own `package.json`).

---

## Task 1: Add `shouldImportVod` pure helper (TDD)

**Files:**
- Modify: `admin/src/status.ts`
- Test: `admin/src/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

In `admin/src/helpers.test.ts`, update the `./status` import (line 3) to include `shouldImportVod`:

```ts
import { canHardDeleteStream, isValidTransition, shouldImportVod, VALID_STATUSES } from './status';
```

Then append this block immediately after the `canHardDeleteStream` assertions (after the line `assertEqual(canHardDeleteStream('excluded'), true, ...)`):

```ts
// shouldImportVod: the VOD import is gated on admin-DB existence, not Nova status,
// so a failed import stays retryable (absent → import) while a re-approve of an
// already-imported VOD is skipped (present → no overwrite of curated performances).
assertEqual(shouldImportVod('approved', false), true, 'first approve (not yet in admin DB) imports');
assertEqual(shouldImportVod('approved', true), false, 're-approve (already imported) skips');
assertEqual(shouldImportVod('rejected', false), false, 'rejected target never imports');
assertEqual(shouldImportVod('pending', false), false, 'pending target never imports');
console.log('✓ shouldImportVod');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npm run test:helpers`
Expected: FAIL — `shouldImportVod is not a function` (or a TS error that the export is missing).

- [ ] **Step 3: Write the minimal implementation**

In `admin/src/status.ts`, change the first import line to add `NovaStatus`:

```ts
import type { NovaStatus, Status } from '../shared/types';
```

Then append at the end of the file:

```ts
// VOD import is gated on whether the video already exists in the admin DB, not on the
// Nova submission status. This keeps an approval whose import previously failed
// retryable (absent → import), while a re-approve of an already-imported VOD won't
// delete/recreate its curated performances (present → skip). Relies on importVodToAdminDb
// writing atomically via db.batch(), so a failed import leaves nothing behind to detect.
export function shouldImportVod(targetStatus: NovaStatus, alreadyImported: boolean): boolean {
  return targetStatus === 'approved' && !alreadyImported;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npm run test:helpers`
Expected: PASS — output includes `✓ shouldImportVod`.

- [ ] **Step 5: Typecheck**

Run: `cd admin && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
lineguard admin/src/status.ts admin/src/helpers.test.ts
git add admin/src/status.ts admin/src/helpers.test.ts
git commit -m "feat(admin): add shouldImportVod gate helper for VOD import"
```

---

## Task 2: Gate the VOD import on admin-DB existence

**Files:**
- Modify: `admin/src/index.ts` (line 4 import; gate block ~1223–1240)

> No automated test: the endpoint needs a live D1 binding and the admin harness has no D1 mock (the spec's "regression test if feasible" is satisfied by Task 1's pure-function test). Verification here is typecheck + the full check suite + a manual smoke test after deploy.

- [ ] **Step 1: Add `shouldImportVod` to the `./status` import**

In `admin/src/index.ts`, line 4, change:

```ts
import { canHardDeleteStream, isValidTransition, VALID_STATUSES } from './status';
```

to:

```ts
import { canHardDeleteStream, isValidTransition, shouldImportVod, VALID_STATUSES } from './status';
```

- [ ] **Step 2: Rewire the gate**

Replace this block (the current `if (body.status === 'approved' && existing.status !== 'approved') { ... }`):

```ts
  // On a real transition to approved, import VOD songs into admin DB as pending
  // records. Gating on the transition (not just body.status) prevents a re-approve
  // from deleting/recreating already-curated performances via importVodToAdminDb.
  if (body.status === 'approved' && existing.status !== 'approved') {
    const vod = await c.env.NOVA_DB
      .prepare('SELECT * FROM vod_submissions WHERE id = ?')
      .bind(id)
      .first<NovaVodSubmission>();
    const { results: vodSongs } = await c.env.NOVA_DB
      .prepare('SELECT * FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order')
      .bind(id)
      .all<NovaVodSong>();

    if (vod && vodSongs.length > 0) {
      const user = c.get('user');
      await importVodToAdminDb(c.env.DB, vod, vodSongs, user.email);
    }
  }
```

with:

```ts
  // Import VOD songs into the admin DB as pending records when approved. The outer
  // `approved` guard is a fast path (only an approval can import — fetch the VOD lazily);
  // the authoritative gate is shouldImportVod, keyed on whether the video already exists
  // in the admin DB. That keeps a failed import retryable (absent → import) while a
  // re-approve of an already-imported VOD won't delete/recreate its curated performances
  // (present → skip). importVodToAdminDb writes via an atomic db.batch(), so a failed
  // import leaves no admin rows and the next retry re-imports cleanly.
  if (body.status === 'approved') {
    const vod = await c.env.NOVA_DB
      .prepare('SELECT * FROM vod_submissions WHERE id = ?')
      .bind(id)
      .first<NovaVodSubmission>();
    const { results: vodSongs } = await c.env.NOVA_DB
      .prepare('SELECT * FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order')
      .bind(id)
      .all<NovaVodSong>();

    if (vod && vodSongs.length > 0) {
      const alreadyImported = await videoIdExists(c.env.DB, vod.video_id, vod.streamer_slug);
      if (shouldImportVod(body.status, alreadyImported)) {
        const user = c.get('user');
        await importVodToAdminDb(c.env.DB, vod, vodSongs, user.email);
      }
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd admin && npm run typecheck`
Expected: no errors. (Confirms `vod.video_id` / `vod.streamer_slug` exist on `NovaVodSubmission` and `videoIdExists` is in scope.)

- [ ] **Step 4: Full check suite**

Run: `cd admin && npm run check`
Expected: typecheck + helpers (incl. `✓ shouldImportVod`) + itunes + discord all pass.

- [ ] **Step 5: Commit**

```bash
lineguard admin/src/index.ts
git add admin/src/index.ts
git commit -m "fix(admin): gate VOD import on admin-DB existence, not Nova status (#10)

A failed importVodToAdminDb left the Nova row approved but nothing imported;
the old transition gate then skipped the import on retry. Gate on videoIdExists
instead so a previously-failed import re-runs, while a re-approve of an
already-imported VOD still skips and won't overwrite curated performances.

Closes #10"
```

---

## Task 3: Push, open PR, deploy

- [ ] **Step 1: Final full check**

Run: `cd admin && npm run check`
Expected: all pass.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin fix/vod-import-retry
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "fix(admin): retryable VOD import after a failed import (#10)" --body "$(cat <<'EOF'
## Summary

Follow-up from PR #9 review (Codex). The VOD approval endpoint marked the Nova
row `approved` *before* `importVodToAdminDb`; if the import threw (e.g. a transient
D1 batch failure), the row stayed `approved` but nothing was imported, and the old
gate (`existing.status !== 'approved'`) made a curator retry **skip** the import.

This gates the import on whether the video already exists in the admin DB
(`videoIdExists`) instead of the Nova status:

- first approve → absent → import
- re-approve (already imported) → present → skip (no overwrite of curated data)
- approve, import failed, retry → absent (db.batch is atomic) → re-import

The decision is a pure `shouldImportVod(targetStatus, alreadyImported)` with unit
tests in `helpers.test.ts`.

Design: `docs/superpowers/specs/2026-06-14-pr9-followups-design.md` §2.

## Test Plan

- [x] `cd admin && npm run check` (typecheck + helpers incl. shouldImportVod + itunes + discord)
- [ ] Deploy via `/deploy-admin`, then smoke-test: approve a VOD (imports), re-approve it (no duplicate/overwrite).

Closes #10

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Deploy the admin worker**

Admin is a Cloudflare Worker — the fix only takes effect after deploy. Run the `/deploy-admin` slash command.

- [ ] **Step 5: Manual smoke test (post-deploy)**

In the admin UI:
1. Approve a pending VOD with songs → confirm a stream + pending songs/performances appear in the admin DB.
2. Re-approve the same VOD (toggle to pending then approved, or re-PATCH approved) → confirm performances are **not** deleted/recreated (no duplicates, curated edits preserved).

---

## Self-Review

- **Spec coverage (§2):** existence-gate (Task 2) ✓; `shouldImportVod` pure helper (Task 1) ✓; 3-case unit test in `helpers.test.ts` (Task 1) ✓; deploy requirement (Task 3) ✓; acceptance (re-approve no overwrite / failed-retry re-imports) covered by Tasks 1–2 + manual smoke.
- **Placeholder scan:** none — every code/command step is concrete.
- **Type consistency:** `shouldImportVod(targetStatus: NovaStatus, alreadyImported: boolean)` defined in Task 1, called with `body.status` (typed `NovaStatus`) + `alreadyImported` (from `videoIdExists`, returns `Promise<boolean>`) in Task 2. `videoIdExists(db, videoId, streamerId)` matches `vod.video_id` / `vod.streamer_slug`.

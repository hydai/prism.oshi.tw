# Phase 7 — consistency and performance

This phase fixes the reproduced asynchronous editor, browser-storage, catalog-import,
sync-export and playback-history races. It preserves public archive IDs and existing
localStorage formats; it does not clean up existing duplicate songs or rewrite archive data.

## Measured changes

| Path | Before | After |
| --- | --- | --- |
| Import 200 distinct songs into an existing stream | 1,000 SQL statements in 5 batches | 4 statements in 1 atomic batch |
| Admin initial JS bundle | 486.48 kB / 134.03 kB gzip | approximately 250 kB / 80 kB gzip |
| Global-work count | joins every matching performance | groups linked songs only |
| Global-work statistics | aggregate on each pagination request | recompute only when the catalog revision differs, if the isolate has a cached entry |
| Fan-site export | 6 separate reads for data and freshness | 1 SQL statement containing records, counts, timestamps and export revision |

These are local statement counts and production-build sizes, not production latency
measurements. Additional route chunks are downloaded when their page is opened.

## Consistency boundaries

- Editor writes target stable row IDs. Stream/session generations reject obsolete
  responses and stop the remainder of duration batches. A request already sent to the
  server can still finish for its original row; navigation is not a server rollback.
- Aurora also compares the expected song metadata/timestamps before applying a duration,
  preserving manual edits made during the lookup.
- Playlists, likes and history use Web Locks around read/validate/write. Storage events
  update other tabs. On browsers without Web Locks, re-reading before each write still
  prevents stale sequential overwrites but cannot guarantee simultaneous-tab exclusion.
  Refresh older open tabs after rollout: old clients do not participate in these locks.
- Active-player volume and mute remain tab-local so the controls reflect that player's
  actual audio; newly created players still read the saved preferences from storage.
- Catalog imports resolve exact local identities inside the write batch. Approved rows
  win over pending ones; aliases remain authoritative, and intentionally existing local
  duplicates are not constrained or automatically merged. A failed replace rolls back
  its leading deletes together with the inserts. This follows [D1 batch transaction
  semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- Global-work statistics are non-authoritative derived cache entries, one per D1 binding.
  SQL checks `work_match_state` in the same transaction as the page; cache misses only
  cost work. No TTL or isolate-local state decides correctness.
- Export revision triggers cover approved songs, performances, streams and work links,
  including notes, credit, deletion, same-second updates and tenant moves. Pending-only
  changes do not invalidate the published export. The revision and JSON source rows are
  read together, with one JSON cell per record rather than one oversized aggregate cell.

## Rollout

No production database or deployment is changed by opening this PR.

1. Before using the new sync tools, apply the additive, idempotent migration to Admin D1:

   ```sh
   cd admin
   npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0009_fan_export_revisions.sql
   ```

2. Deploy the reviewed Admin Worker/UI and Aurora through the existing deployment
   workflows. Aurora Pages must use `--branch main`.
3. Run `npm run sync:status` from the repository root. Legacy stamps without
   `exportRevision` are deliberately stale. Re-export the affected streamers with
   `npm run sync:data <slug>`, review the JSON/stamp diff, and publish via the normal
   data commit workflow. No automatic sync/commit/push is part of this refactor.
4. Refresh open editors and fan-site tabs. Smoke-test a stream switch, a timestamp
   write, playlist creation in two tabs, and previous/next playback.

Rollback code by redeploying the previous reviewed artifacts; leave migration 0009 in
place. Its table/triggers are additive, and the previous sync code ignores the extra
stamp field. Do not remove the revision table while any new sync clients still use it.

## Verification

Root unit tests/build, Admin checks (including real SQLite transactions and migration
tests), Admin UI checks, Aurora tests/build, sync tool typechecks/tests, and React Doctor
0.9.12 full scope. Root ESLint retains the three pre-existing TanStack Virtual warnings.
The deliberately guarded loading reset in `finally` has a narrow documented Doctor
annotation: an obsolete request must not stop the newer request's loading indicator.

Local browser checks cover two-tab playlist updates, a deliberately held Web Lock
(no early success), and quota failure (existing playlists retained, failure displayed).

# VOD export rollout runbook

This runbook provisions and releases the approved `vod-export-spec.md` v1
implementation. The implementation lives in the existing Admin Worker; there
is no separate `data.oshi.tw` application runtime. `data.oshi.tw` is the public
R2 Custom Domain only.

Do not run these production steps until the code review, source-data repair,
and launch gates below are complete. Repository implementation and local tests
do not create Cloudflare resources or mutate remote D1 data.

## 1. Local release gates

From `admin/`:

```sh
npm ci
npm run check
cd ui
npm ci
npm run build
npm run test:nova-links
npm run test:streams-filter
npm run test:streams-render
npm run test:vod-export
```

Also complete the production-like simultaneous-limit stress test required by
D-020.3: peak isolate memory must remain at or below 96 MiB and CPU time at or
below 30 seconds. The ordinary unit suite does not substitute for this launch
gate.

## 2. D1 backup and migration

The existing databases may have migration history that was applied with
`d1 execute` and is not represented in `d1_migrations`. Do **not** blindly run
`wrangler d1 migrations apply` across either full directory.

The current `db:migrate` package scripts execute `schema.sql`; those files are
idempotent fresh-database bootstraps, not a replacement for the two incremental
migrations below. In particular, SQLite's `CREATE TABLE IF NOT EXISTS` cannot
add the NOVA verification columns to an existing `submissions` table. After the
incremental migrations have succeeded, re-running either bootstrap schema is
safe, but it must not be used to skip or baseline migration history.

First record Time Travel information for both databases:

```sh
npx wrangler d1 time-travel info oshi-prism-db
npx wrangler d1 time-travel info oshi-prism-nova
```

Then apply only the three new reviewed files:

```sh
npx wrangler d1 execute oshi-prism-db --remote --file=migrations/0002_add_vod_export_state.sql
npx wrangler d1 execute oshi-prism-nova --remote --file=../tools/nova/migrations/0014_add_vod_export_state.sql
npx wrangler d1 execute oshi-prism-db --remote --file=migrations/0003_add_vod_export_source_indexes.sql
```

Treat each state-table file as a one-time migration. Before running it, inspect the target
for its new singleton table, exact triggers, audit/resolution tables, and verification
columns. Apply the file only when all of that migration's objects are absent;
if the target is partially migrated, stop and reconcile it from the Time Travel
bookmark instead of re-running non-idempotent `ALTER TABLE` statements. Do not
manually insert a fake `d1_migrations` baseline during this rollout. A future
conversion to `wrangler d1 migrations apply` needs a separately reviewed
baseline procedure for every migration that was previously run with
`d1 execute`.

The `0003` index migration is intentionally idempotent. Verify that
`idx_performances_stream_id` exists on `performances(stream_id)` after applying
it; reapplying this one index-only file is safe.

Verify the singleton state rows, exact trigger names, Admin audit/resolution tables, and the
two NOVA verification columns before deploying. Existing YouTube channel IDs
must remain unverified after migration; do not infer verification from their
shape.

## 3. R2 buckets and safeguards

Create the two Standard buckets:

```sh
npx wrangler r2 bucket create prism-vod-export-public
npx wrangler r2 bucket create prism-vod-export-private
```

Disable `r2.dev` on both:

```sh
npx wrangler r2 bucket dev-url disable prism-vod-export-public
npx wrangler r2 bucket dev-url disable prism-vod-export-private
```

Add the private candidate cleanup backstop and the public snapshot lock:

```sh
npx wrangler r2 bucket lifecycle add prism-vod-export-private expire-private-candidates candidates/v1/ --expire-days 2
npx wrangler r2 bucket lock add prism-vod-export-public retain-v1-snapshots vod/v1/snapshots/ --retention-days 400
```

Do not add an age-only deletion lifecycle to the public snapshot prefix.
Program maintenance checks retained manifests and the separate 400-day
unreferenced interval before attempting a delete; the bucket lock is the
independent minimum-retention defense.

Configure no CORS policy on either bucket. Attach only the public bucket to
`data.oshi.tw`; the private bucket must remain binding-only. With the zone ID in
an environment variable, the Custom Domain command is:

```sh
npx wrangler r2 bucket domain add prism-vod-export-public --domain data.oshi.tw --zone-id YOUR_ZONE_ID --min-tls 1.2
```

The public bucket also contains the source-controlled consumer guide and
versioned v1-compatible baseline JSON Schemas under `vod/v*/guide.md` and
`vod/v*/schemas/*`. Admin remains the only application writer for
`manifest.json` and `snapshots/*`; the fixed documentation release command is
an operationally constrained maintainer tool whose allowlist contains only
those guide/schema keys. Its Cloudflare credential is bucket-scoped rather
than key-scoped, so keep that credential out of ordinary push/PR CI.

## 4. CDN and hostname policy

Create one Cache Rule for hostname `data.oshi.tw` and path prefix `/vod/`:

- only `GET` and `HEAD` are cache eligible;
- JSON objects are explicitly eligible for cache;
- exclude the query string from this prefix's cache key;
- do not set an Edge Cache TTL override;
- preserve object `Cache-Control` metadata;
- enable Smart Tiered Cache;
- disable Always Online for this data host.

Expected object metadata is:

- snapshot: `public, max-age=31536000, immutable`;
- manifest: `public, max-age=60, stale-if-error=86400`;
- guide: `public, max-age=3600, stale-if-error=86400`;
- versioned v1 baseline schemas: `public, max-age=31536000, immutable`;
- manifest and snapshot: `application/json; charset=utf-8`;
- guide: `text/markdown; charset=utf-8`;
- schemas: `application/schema+json; charset=utf-8`;
- no public object has stored `Content-Encoding` or `Content-Disposition`.

Before any future hostname migration, keep the old hostname serving identical
paths for every referencing manifest plus the following 400-day retention
window.

### 4.1 Public consumer documentation

The reviewed public source mapping is:

```text
docs/vod-export-consumer-guide.md
  -> vod/v1/guide.md
docs/vod-export-schemas/1.0.0/manifest.schema.json
  -> vod/v1/schemas/1.0.0/manifest.schema.json
docs/vod-export-schemas/1.0.0/snapshot.schema.json
  -> vod/v1/schemas/1.0.0/snapshot.schema.json
```

From `admin/`, validate, publish, and later re-verify with:

```sh
npm run test:vod-export-docs
npm run publish:vod-export-docs
npm run verify:vod-export-docs
```

Before the first schema release, protect its prefix at the storage layer:

```sh
npx wrangler r2 bucket lock add prism-vod-export-public \
  retain-v1-schemas vod/v1/schemas/ --retention-indefinite --force
```

Confirm `retain-v1-schemas` is enabled with:

```sh
npx wrangler r2 bucket lock list prism-vod-export-public
```

The indefinite prefix lock permits new schema keys but prevents deletion or
overwriting of existing schema objects, including concurrent releases. Removing
that lock is a separately reviewed recovery operation, never a normal schema
release step.

The release command uses the locally installed Wrangler, a fixed bucket/key
allowlist, and the metadata above. It compares existing R2 bytes first, refuses
to overwrite a different immutable schema, uploads schemas before the guide,
and always rewrites the mutable guide so its origin metadata is repaired even
when its bytes have not changed. It reads every written object back, then
validates the public guide/schemas and current manifest/snapshot. Public
verification requires the complete `Content-Type` (including UTF-8 charset),
exact `Cache-Control`, and no `Content-Disposition`. Published schema metadata
is immutable with its bytes; fix it at a new versioned schema path. The command
does not publish VOD data or alter the manifest.

If a public guide update still returns earlier cached bytes or metadata, purge
only `https://data.oshi.tw/vod/v1/guide.md` and rerun the verification command.
A first upload can also remain behind a previously cached 404 for its short
error TTL; wait for expiry or purge only the affected new URL. Never purge
immutable snapshot URLs as part of a documentation release.

Do not overwrite a published schema path. Correct a schema by adding a newly
reviewed versioned baseline path, update the guide only after that schema is
public, and retain prior schema URLs for existing consumers. `llms.txt` is
intentionally outside this initial documentation release.

## 5. Admin origin and Access

`wrangler.toml` disables `workers.dev` and version preview URLs so they cannot
bypass the Cloudflare Access application protecting the Admin Custom Domain.
Before deploy, verify there is no other Worker route or Custom Domain that can
reach this Worker without the same Access policy. If an alternate origin is
ever introduced, implement and require cryptographic Access JWT validation for
that origin before enabling it.

## 6. Source remediation before first publication

Use the Nova Admin page's `Verify channel` action for every approved, enabled
streamer. It calls YouTube `channels.list`, requires the exact returned channel
ID, and stores the ID and verification timestamp atomically. A failed or absent
verification remains a blocking export finding.

Repair the known timestamp and range failures listed in
`vod-export-data-issues.md`. Generate preview again until it reports no blocking
findings. Do not edit source records from the exporter itself.

## 7. Deploy and first publication

Deploy only after bindings resolve to the two intended buckets and the exact D1
database IDs in `wrangler.toml` have been independently checked. The Admin
workflow is:

1. load authoritative publication status;
2. generate a private preview;
3. review all findings, counts, bytes, SHA-256, and capacity indicators;
4. download the exact candidate if desired;
5. use the second confirmation action to publish that candidate.

After the manifest advances, verify through the Custom Domain:

- canonical compact JSON with no BOM or trailing newline;
- exact snapshot SHA-256 and uncompressed byte count;
- required response metadata and cache behavior;
- manifest URL references a readable immutable snapshot;
- `r2.dev` remains disabled and the private bucket is unreachable publicly.

## 8. Ongoing maintenance

The curator-only `POST /api/vod-export/maintenance` operation shares the v1
publication control slot. It therefore cannot anonymize or delete against a
stale manifest reference set while a publisher is moving the manifest. It:

- clears unreferenced markers for re-referenced snapshots;
- starts a new unreferenced interval when a reference is removed;
- removes curator identity and candidate ID only after two years and after the
  snapshot is no longer referenced;
- finalizes crash-interrupted failed/no-op resolution rows and deletes them only
  after their 30-day post-resolution retention interval;
- attempts snapshot deletion only after 400 unreferenced days;
- emits a structured storage-review warning at 8 GiB.

Run it periodically under curator authentication and monitor structured Worker
logs for control recovery, deletion failure, and storage-review events. Before
automating it with a Cron Trigger, add a scheduled-handler integration test and
have the handler call the same control-guarded function; do not create a second
maintenance implementation.

## 9. Unresolved control recovery

Do not delete or unconditionally overwrite either private control object. An
owner that is merely older than 15 minutes is not presumed dead. First try the
normal curator-only `POST /api/vod-export/reconcile` for a prepared publication.

If an acquired generation/publication owner remains, or a prepared intent still
cannot be classified, use the following last-resort CAS workflow only after all
of these checks:

1. the status warning has been present for at least 15 minutes;
2. Worker request logs identify the owner and confirm that exact invocation has
   terminated (not merely that the browser disconnected);
3. no deploy, maintenance run, preview, or publication using that owner is
   still active;
4. two curators record the incident reason and agree to the release.

With an authenticated curator Access session, inspect the exact owner and ETag:

```sh
curl --fail-with-body \
  --cookie "CF_Authorization=YOUR_ACCESS_JWT" \
  "${ADMIN_ORIGIN}/api/vod-export/control-recovery"
```

Copy the `ownerId` and `etag` from either `generation` or `publication` without
editing them. Then submit the exact state, the fixed confirmation sentence, and
the incident reason:

```sh
curl --fail-with-body \
  --cookie "CF_Authorization=YOUR_ACCESS_JWT" \
  -H 'Content-Type: application/json' \
  -H 'X-Prism-Admin-Request: fetch' \
  -X POST \
  "${ADMIN_ORIGIN}/api/vod-export/control-recovery" \
  --data '{
    "control": "generation",
    "ownerId": "COPY_EXACT_OWNER_ID",
    "etag": "COPY_EXACT_ETAG",
    "confirmation": "I CONFIRM THE OWNER INVOCATION HAS TERMINATED",
    "reason": "Incident reference and evidence that the exact invocation terminated"
  }'
```

Use `"control": "publication"` only for the matching publication record. The
server enforces the 15-minute threshold and performs a one-shot CAS against the
submitted ETag; it never follows the same owner onto a newer ETag. For prepared
state it first recognizes an exact committed/equivalent manifest, otherwise it
releases only when the public manifest is still the exact expected prior state.
A `409` means state changed or remains ambiguous: stop, inspect again, and never
retry with stale values. Every successful manual recovery emits the curator,
owner, expected ETag, reason, and outcome as one structured audit log event.

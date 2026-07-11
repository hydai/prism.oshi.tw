# VOD Export Specification

- Date: 2026-07-10
- Last updated: 2026-07-11
- Status: **Approved** — one hundred forty-nine decisions confirmed
- Final approval: 2026-07-11
- Target: Prism Admin
- Contract version: `1.0.0`

## 1. Review protocol

This document is intentionally decision-led. All 149 registered v1 decisions
are confirmed, and the product owner has given final approval to the reconciled
complete document. Implementation may now begin; first publication remains
subject to the validation and data-remediation gates defined here.

Decision states:

- **Confirmed** — accepted by the product owner.
- **Pending** — requires product-owner confirmation.
- **Rejected** — considered and explicitly not selected.

Every confirmed decision records the selected behavior, confirmation date, and
resulting contract changes. Decisions were initially reviewed one at a time;
later error-handling details were delegated for consolidated review and the
remaining decisions were reviewed in explicit product-owner-approved batches.

The header count tracks 149 confirmed atomic product decisions. Pure summary
headings are not counted; the nine lettered D-006 field decisions are counted
individually, and D-007.4 is recorded as part of D-007.1 rather than as an
additional atomic decision.

## 2. Confirmed request

The following requirements come directly from the initial request:

1. Prism Admin must provide an export capability.
2. The export must cover streamers, their VODs, and the songs performed in
   those VODs.
3. The result will be consumed by a separate website.
4. The export contract must be documented here and reviewed before it is
   implemented.

The decision register below records the confirmed choices that extend these
requirements.

## 3. Existing-system baseline

### 3.1 Sources

Prism currently has two relevant representations of the same approved data:

1. **Admin D1 data** — the current admin source, split across `streams`,
   `performances`, and `songs`.
2. **Published static JSON** — `data/{slug}/streams.json` and
   `data/{slug}/songs.json`, generated from approved D1 rows by
   `tools/sync-data/sync.ts` and deployed with the current website.

Streamer profiles come from a separate NOVA D1 database. The generated public
representation is `data/registry.json`.

### 3.2 Existing legacy exports

Admin already exposes curator-only endpoints for one selected streamer:

- `GET /api/export/streams?streamer={slug}`
- `GET /api/export/songs?streamer={slug}`

They return two unversioned top-level arrays in the current fan-site format.
They are also consumed by Prismlens, so their routes and response shapes are a
compatibility boundary and must not be changed by this project. A unified
format uses separate R2 paths and new types.

### 3.3 Relationship and canonical-field constraints

The admin relationship is:

```text
streamer slug
  ├── streams.streamer_id
  ├── songs.streamer_id
  └── performances.streamer_id

streams.id  <── performances.stream_id  (logical relation; no foreign key)
songs.id    <── performances.song_id    (foreign key)
```

`performances` repeats the VOD date, title, and video ID. Those repeated values
can drift after a VOD is edited. A new VOD-oriented export should therefore use
the `streams` row as the canonical source for VOD metadata, and use
`performances` only for the relationship and timestamps. D-007 confirms this
canonical-source rule.

### 3.4 Current published-data scale and exceptions

The committed snapshot inspected on 2026-07-10 contains:

- 36 approved, enabled streamers
- 554 VODs
- 6,376 song records
- 8,534 performance records
- about 4.3 MiB across the current pretty-printed song and stream JSON files

Known exceptions in that committed snapshot include:

- 4 performances where `endTimestamp < timestamp`
- 10 performances whose repeated `date` is empty
- 18 performances whose repeated `date` differs from the canonical stream date
- 15 performances with a missing required end time (`endTimestamp: null`)
- 144 song records with an empty artist value
- 140 VODs without credit information
- 4 song/artist strings that are not Unicode NFC
- multiple distinct song IDs with the same title and artist
- possible repeated performances of the same song within one VOD
- at least one YouTube video ID used by more than one streamer, so `videoId`
  is not a safe global record key

These exceptions mean the contract must define validation, normalization, and
error behavior instead of assuming all approved rows are internally clean.

## 4. Confirmed contract overview

The export will be a public, sanitized feed generated from the current approved
Admin `DB` and `NOVA_DB` state. It will use one all-streamers JSON data file,
organized by streamer and then by VOD. Each VOD will be self-contained and nest
its song occurrences. The old two-file export remains unchanged.

Version 1 is confirmed as a **complete replacement snapshot**, not an
incremental feed. A separately versioned optional delta feed may be added
later. A prototype of the illustrated VOD-oriented shape built from the
committed data measured about 1.56 MiB compact and 0.36 MiB gzip, while the
database has no deletion tombstones or monotonic change cursor.

Illustrative shape only:

```json
{
  "schemaVersion": "1.0.0",
  "streamers": [
    {
      "slug": "mizuki",
      "displayName": "浠Mizuki",
      "youtubeChannelId": "UCxxxxxxxxxxxxxxxxxxxxxx",
      "avatarUrl": "https://example.com/avatar.jpg",
      "group": "子午計畫",
      "socialLinks": {
        "youtube": "https://www.youtube.com/@example"
      },
      "vods": [
        {
          "title": "VOD title",
          "date": "2026-03-01",
          "videoId": "6cs97bYUn5M",
          "performances": [
            {
              "performanceId": "p-248b289c",
              "songId": "song-00b328b0",
              "title": "微笑みのその前で",
              "originalArtist": "山下久美子",
              "startSeconds": 2069,
              "endSeconds": 2236
            }
          ]
        }
      ]
    }
  ]
}
```

Reasons for the selected direction:

- It directly represents “a streamer's VODs and the songs in each VOD.”
- A consumer can render a VOD page without joining separate files.
- Both `performanceId` and `songId` are retained because a song may occur more
  than once and title plus artist is not a unique key.
- VOD metadata has one canonical source instead of using the repeated values on
  performance rows.

The VOD-oriented nesting, envelope, content fields, and null/missing-value rules
shown above are confirmed through D-004 and D-007 through D-009. Example values
are illustrative; the property set and types are normative.

### 4.1 Confirmed Cloudflare publication direction

The confirmed public-feed direction is:

```text
Admin D1 approved data
  -> explicit curator Preview + Confirm + Publish action
  -> validate and serialize one all-streamers JSON snapshot once
  -> write immutable snapshot to R2
  -> update a small manifest only after the snapshot write succeeds
  -> serve both through an R2 Custom Domain and Cloudflare CDN Cache Rules
  -> new website build/server job checks the manifest
  -> fetch a snapshot only when its hash changes
```

Illustrative public URLs:

```text
https://data.oshi.tw/vod/v1/manifest.json
https://data.oshi.tw/vod/v1/snapshots/{sha256}.json
```

The snapshot remains the single data file selected in D-004. The manifest is a
small control document that points to the current immutable snapshot; it does
not split the streamer data into multiple export files.

Confirmed cache policy:

- immutable snapshot path: cache for a long period and return
  `Cache-Control: public, max-age=31536000, immutable`;
- mutable manifest path: return
  `Cache-Control: public, max-age=60, stale-if-error=86400` and support `ETag`
  revalidation;
- create a Cache Rule that explicitly makes these JSON paths eligible for
  caching, because Cloudflare CDN does not cache JSON by default;
- enable Smart Tiered Cache to reduce R2 reads after misses in different edge
  locations;
- publish in this order: snapshot first, manifest second. A stale manifest then
  always points to an existing valid snapshot.

Confirmed operational guards:

- use separate public and private R2 Standard buckets, with only published
  export artifacts in the public bucket;
- disable `r2.dev` for both buckets so public consumers use the Custom Domain,
  Cache Rules, and WAF path;
- allow only `GET` and `HEAD` on the documented public paths;
- exclude query strings from the `/vod/` cache key and do not define query
  parameters as a freshness or versioning mechanism;
- retain referenced snapshots through major-version retirement and retain
  unreferenced snapshots for at least 400 additional days;
- monitor R2 Class A/B operations and review policy at 8 GB of public snapshot
  storage;
- prevent concurrent publishers from moving the manifest backwards with a
  conditional update against its prior ETag.

Why R2 was selected instead of querying D1 on every public request:

- the expensive transformation happens once per publish rather than once per
  visitor;
- CDN hits do not repeatedly read D1 or regenerate JSON;
- an immutable URL makes browser and edge caching safe without cache purges;
- direct R2 Custom Domain delivery avoids putting a billed dynamic Worker on
  the public read path;
- R2 is designed for object delivery and currently has no Internet egress fee.

Current Cloudflare limits and prices are operational context, not a permanent
contract. As checked on 2026-07-11, the official documentation states:

- R2 Standard includes 10 GB-month storage, 1 million Class A operations, and
  10 million Class B operations per month in its free tier; Internet egress is
  free;
- Workers static assets are free and unlimited, but an asset update would
  normally require a deployment;
- requests that invoke a dynamic Worker remain request-billable even when
  Workers caching serves the response, although cache hits avoid Worker CPU;
- Workers Paid currently has a US$5 account minimum and supports the D-020.1
  30-second CPU budget, while Workers Free is limited to 10 ms per invocation;
- the Free/Pro/Business CDN cacheable-object limit is 512 MB, far above the
  roughly 1.56 MiB compact prototype snapshot.

Official references:

- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Caching R2 with a Custom Domain](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [Cloudflare default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers static-assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

#### Cost and cache implications at the current scale

A prototype of the confirmed VOD-oriented, all-streamers shape measured about
1.56 MiB as compact JSON and 0.36 MiB with gzip. At this size:

- the object is far below Cloudflare's current 512 MB CDN cacheable-file limit;
- approximately three baseline R2 writes per successful freshly generated
  publication (private candidate, public snapshot, and manifest) plus a small
  number of cache-miss reads are tiny relative to the current R2 Standard
  free-tier allowances;
- even direct R2 delivery currently has no Internet egress charge;
- a CDN cache hit prevents another R2 read, although Cloudflare still delivers
  bytes from the edge to the consumer;
- keeping one new 1.56 MiB snapshot every day for a year would use roughly
  0.56 GiB before dataset growth and compression, still below the current
  10 GB-month R2 free storage allowance once fully accumulated.

For illustration, one million downloads of a 0.355 MiB compressed snapshot is
roughly 347 GiB delivered from the edge. Under the current R2 pricing model,
that does not create an R2 egress line item. If every request missed cache, one
million R2 Class B reads would still be within the current 10-million/month free
tier; with the confirmed cache policy, R2 reads should be much lower. Account
usage is shared with other projects, Cloudflare pricing can change, and abuse
traffic still needs monitoring, so these numbers are not a permanent cost
guarantee.

D-004 has one important cache trade-off: when any streamer changes, the hash of
the all-streamers file changes. Each consumer that adopts the new version must
download the complete new snapshot; unchanged streamers cannot be reused as
separate cached objects. At the current size this is reasonable, but the spec
enforces the D-020 count and 10 MiB byte limits and requires D-004 to be
revisited rather than silently splitting an oversized feed.

## 5. Decision register

### D-001 — Delivery and refresh model

- Status: **Confirmed**
- Selected: **C. Public sanitized artifact/feed**
- Confirmed: 2026-07-10
- Blocking: No

Options:

- **A. Manual admin download** — a curator downloads a snapshot and transfers
  it to the new website. This is the narrowest interpretation of the request.
- **B. Authenticated build-time API** — the new website fetches the export using
  service credentials during its build.
- **C. Public sanitized artifact/feed** — Admin publishes a stable, versioned
  artifact that the new website can fetch without Cloudflare Access.

The choice determines authentication, caching, deployment, and whether a UI
download alone is sufficient.

Confirmed implication: Admin remains authenticated and curator-controlled, but
the published artifact must be safe for anonymous public reads and must not
contain admin identities, reviewer notes, or other private workflow data.
Hosting, publication cadence, and cache configuration are fixed by D-014 and
D-017 through D-020.

### D-002 — Snapshot source

- Status: **Confirmed**
- Selected: **A. Current approved Admin D1 rows**
- Confirmed: 2026-07-10
- Blocking: No

Options:

- **A. Current approved Admin D1 rows** — freshest curator-approved state, even
  if it has not yet been synchronized and deployed to the current site.
- **B. Currently published static JSON** — exactly matches what visitors can
  already see, but may lag behind approved admin changes.
- **C. Both** — expose the distinction and allow the curator to choose.

Confirmed implication: the public feed may be newer than the data deployed on
the existing Prism website. The feed needs its own visible publication time and
must not claim to represent the current website deployment.

### D-003 — Data organization

- Status: **Confirmed**
- Selected: **A. VOD-oriented nesting**
- Confirmed: 2026-07-10
- Blocking: No

Options:

- **A. VOD-oriented nesting** — each VOD contains complete song occurrence
  objects, as illustrated above.
- **B. Normalized entities** — separate `vods`, `songs`, and `performances`
  arrays joined by IDs; less duplication but more work for the consumer.
- **C. Legacy-compatible pairs** — retain separate stream-oriented and
  song-oriented arrays inside a versioned envelope.

Confirmed implication: song metadata is repeated in each VOD occurrence for
simple consumption. Each occurrence retains both confirmed IDs, `songId` and
`performanceId`, under D-007.7 and D-007.8.

### D-004 — Packaging scope

- Status: **Confirmed**
- Selected: **A. One JSON data file containing all approved, enabled streamers**
- Confirmed: 2026-07-10
- Blocking: No

Options:

- **A. One JSON file containing all approved, enabled streamers**.
- **B. One JSON file for the currently selected streamer**.
- **C. A ZIP containing a manifest plus one JSON file per streamer**.
- **D. Provide both an all-streamers export and a selected-streamer export**.

The present snapshot is small enough for one file; D-020 defines hard count and
byte limits and forbids silently truncating, sampling, or splitting it.

Confirmed implication: all approved, enabled streamers use the same data snapshot. Under
D-005.4, streamers with no eligible VODs remain present with `vods: []`; under
D-005.2, individual VODs with no eligible songs are omitted. A small manifest
that points to this data file does not change the one-data-file rule.

### D-005 — Eligibility and approval intersection

- Status: **Confirmed**
- Selected: **Triple-approved occurrences; omit empty VODs; retain empty
  approved, enabled streamers; block broken relationships**
- Confirmed: 2026-07-10
- Blocking: No

#### D-005.1 — Eligible song occurrence

- Status: **Confirmed**
- Selected: **A. Triple-approved intersection**
- Confirmed: 2026-07-10

- **A. Triple-approved intersection** — recommended. Export a song occurrence
  only when its VOD, performance, and song are all `approved` and belong to the
  same streamer.
- **B. Approved performance is sufficient** — may expose song or VOD data that
  curators have not approved.
- **C. Include other statuses** — requires public status fields and is not
  recommended for the sanitized production feed.

Confirmed implication: a record with any other status is retained in Admin but
absent from the public snapshot. A merely incomplete approval chain does not
block publication; the occurrence becomes eligible in a later snapshot after
all three records are approved.

#### D-005.2 — Approved VOD with zero eligible songs

- Status: **Confirmed**
- Selected: **B. Omit until at least one song occurrence is eligible**
- Confirmed: 2026-07-10

- **A. Include it with `performances: []`** — preserves the complete approved
  VOD list and lets songs appear in a later snapshot.
- **B. Omit it until at least one song occurrence is eligible** — smaller, but
  the feed is then a “VODs with songs” list rather than the approved VOD list.

Confirmed implication: an exported VOD always contains at least one song
occurrence that satisfies D-005.1. Empty `performances` arrays are not emitted.
If a VOD loses its final eligible occurrence, that VOD is absent from the next
full snapshot even when the VOD row itself remains approved. This avoids making
the consumer infer whether an empty VOD is unfinished, contains no songs, or is
not a song stream.

#### D-005.3 — Broken approved relationship

- Status: **Confirmed**
- Selected: **A. Block publication and show actionable errors**
- Confirmed: 2026-07-10

Examples: an approved performance references a missing VOD or song, or links
records belonging to different streamers. A parent that exists but is not yet
approved is merely ineligible under D-005.1; it is not a broken relationship.

- **A. Block publication and show actionable errors** — recommended for an
  authoritative snapshot; the last valid public snapshot remains active.
- **B. Exclude the broken records and publish with warnings** — more available,
  but silently leaves approved content out of the authoritative feed.
- **C. Preserve the broken relationship** — not recommended; the VOD-oriented
  output cannot represent a missing parent safely.

Confirmed implication: any broken relationship aborts the complete candidate
publication. Admin displays the affected streamer and record IDs with an
actionable reason, R2's public manifest is not advanced, and the last valid
snapshot remains active until the source data is repaired and republished.

#### D-005.4 — Approved, enabled streamer with zero eligible VODs

- Status: **Confirmed**
- Selected: **A. Include the streamer with `vods: []`**
- Confirmed: 2026-07-10

- **A. Include the streamer with `vods: []`** — keeps every approved, enabled
  streamer in the snapshot and states that this streamer currently has no
  publishable VOD.
- **B. Omit the streamer** — every exported streamer then has at least one VOD,
  but absence can mean either “not enabled” or “enabled with no eligible VOD.”

Confirmed implication: every approved, enabled streamer is represented exactly
once. An empty `vods` array has the defined meaning “approved, enabled streamer
with zero VODs eligible for this snapshot”; it does not mean the streamer is
missing, unapproved, or disabled.

### D-006 — Streamer profile fields

- Status: **Confirmed**
- Selected fields: **`slug`, `displayName`, `youtubeChannelId`, `avatarUrl`,
  `group`, `socialLinks`**
- Excluded fields: **`description`, `brandName`, `externalUrl`,
  `subscriberCount`, `theme`, `enabled`, and all admin workflow fields**
- Confirmed: 2026-07-10
- Blocking: No

To support one-at-a-time review, the streamer field set is split into the
following sub-decisions.

#### D-006.1 — Streamer identity fields

- Status: **Confirmed**
- Selected: **B. `slug`, `displayName`, and `youtubeChannelId`**
- Confirmed: 2026-07-10

- **A. `slug` and `displayName` only** — enough to identify and label a Prism
  streamer.
- **B. Add required `youtubeChannelId`** — keeps `slug` as the Prism identity
  while also exposing the strongly bound external YouTube identity.

Confirmed implication: `slug` remains the Prism primary identity;
`youtubeChannelId` is a required external platform identifier and does not
replace it. Every approved, enabled streamer must be strongly bound to exactly one
YouTube channel ID. Internal NOVA submission IDs are not exported.

#### D-006.2 — Descriptive profile fields

- Status: **Confirmed**
- Selected: **Include `avatarUrl` and `group`; exclude `description` and
  `brandName`**
- Confirmed: 2026-07-10

This group is reviewed one field at a time:

- **D-006.2a** — `avatarUrl`: Confirmed — include
- **D-006.2b** — `description`: Confirmed — exclude
- **D-006.2c** — `brandName`: Confirmed — exclude
- **D-006.2d** — `group`: Confirmed — include

Confirmed D-006.2a implication: export the approved, validated HTTPS avatar
URL as metadata, not image bytes. Consumers may use the remote URL or fetch and
proxy the image during their own build. Under D-008.3, the key is always
present and its value is `null` when no safe URL is available.

Confirmed D-006.2b implication: `description` is absent from the v1 schema,
not emitted as an empty or null field. This avoids republishing the data feed
for frequently edited profile prose and prevents consumers from depending on
its formatting or content.

Confirmed D-006.2c implication: `brandName` is absent from the v1 schema.
Consumers use `slug` for Prism identity and `displayName` for presentation;
they must not depend on a current-site brand label.

Confirmed D-006.2d implication: export the current approved `group` string as
display metadata. It is explicitly not a stable ID, controlled vocabulary, or
safe machine-filter key. Replacing it later with a normalized affiliation
object requires a separately reviewed, versioned contract change. Under
D-008.4, the key is always present and its value is `null` when no label is
known; the exporter never infers an affiliation.

#### D-006.3 — Public links

- Status: **Confirmed**
- Selected: **Include `socialLinks`; exclude `externalUrl`**
- Confirmed: 2026-07-10

This group is reviewed one field at a time:

- **D-006.3a** — `socialLinks`: Confirmed — include
- **D-006.3b** — `externalUrl`: Confirmed — exclude

Confirmed D-006.3a implication: export a `socialLinks` object restricted to the
fixed keys `youtube`, `twitter`, `facebook`, `instagram`, and `twitch`. Every
emitted value must be an approved, sanitized HTTPS URL for the corresponding
provider. Under D-008.5, the object is always present and is empty when there
are no safe supported links. Under D-008.6, unavailable provider keys are
omitted rather than assigned null values.

Confirmed D-006.3b implication: `externalUrl` is absent from v1. It is a
current Prism navigation override rather than canonical streamer profile data;
consumers must not inherit it as their own routing rule.

#### D-006.4 — Volatile or presentation-specific fields

- Status: **Confirmed**
- Selected: **Exclude `subscriberCount`, `theme`, and `enabled`**
- Confirmed: 2026-07-10

This group is reviewed one field at a time:

- **D-006.4a** — `subscriberCount`: Confirmed — exclude
- **D-006.4b** — `theme`: Confirmed — exclude
- **D-006.4c** — `enabled`: Confirmed — exclude

Confirmed D-006.4a implication: `subscriberCount` is absent from v1. The
current localized, rounded string has no observation timestamp and must not
cause VOD snapshot churn. Any future channel-statistics feed requires a numeric
value and explicit `observedAt` under a separate contract.

Confirmed D-006.4b implication: `theme` is absent from v1. The feed does not
expose or depend on the current Prism CSS/design-token model; visual-only theme
changes do not create a new VOD snapshot.

Confirmed D-006.4c implication: `enabled` is absent from v1 because every
exported streamer is enabled by definition. When a streamer becomes disabled,
it is absent from the next authoritative full snapshot and the consumer removes
it during atomic replacement.

Admin submission/review fields, email addresses, internal NOVA submission IDs,
and reviewer notes are excluded from every sub-decision.

### D-007 — VOD and song fields

- Status: **Confirmed**
- Included VOD fields: **`title`, `date`, `videoId`, `performances`**
- Included performance fields: **`performanceId`, `songId`, `title`,
  `originalArtist`, `startSeconds`, `endSeconds`**
- Excluded: **Admin VOD `id`, `youtubeUrl`, `credit`, `tags`, `note`, all
  derived/enrichment fields, and all Admin workflow/audit fields**
- Confirmed: 2026-07-11
- Blocking: No

The fields below were confirmed individually, beginning with the VOD object.

#### D-007.1 — VOD `id`

- Status: **Confirmed**
- Selected: **Exclude Prism VOD `id`; use `videoId` and the scoped composite
  `(streamer.slug, videoId)`**
- Confirmed: 2026-07-10

Decision: whether each nested VOD exposes its stable, opaque Admin stream ID as
`id` in addition to its YouTube video identity.

Confirmed implication: v1 does not expose the Admin stream ID. `videoId`
identifies the underlying YouTube video and may intentionally repeat under
multiple streamers for collaborations. The identity of a VOD within the
streamer-oriented dataset is `(streamer.slug, videoId)`. Consumers must not use
the full `youtubeUrl` string as a key because equivalent URLs can have different
spellings or query parameters.

#### D-007.2 — VOD `title`

- Status: **Confirmed**
- Selected: **Include canonical Admin stream `title`**
- Confirmed: 2026-07-10

Decision: whether each VOD includes the curator-approved title from its
canonical Admin stream row.

Confirmed implication: `title` is approved plain text sourced only from the
canonical `streams` row, never the denormalized performance copy and never a
live YouTube lookup during export. A title edit is a meaningful content change
and creates a new snapshot.

#### D-007.3 — VOD `date`

- Status: **Confirmed**
- Selected: **Include canonical Admin stream `date` as `YYYY-MM-DD`**
- Confirmed: 2026-07-10

Decision: whether each VOD includes the curator-approved date-only value from
its canonical Admin stream row.

Confirmed implication: `date` is the curator-approved VOD/stream date from the
canonical `streams` row. It is a date-only value with no instant or timezone
semantics. D-009.6 and D-010 define strict syntax and invalid-value handling.

#### D-007.4 — VOD `videoId`

- Status: **Confirmed as part of D-007.1**
- Selected: **Include canonical YouTube `videoId`**

`videoId` identifies the underlying YouTube resource and combines with
`streamer.slug` for the scoped VOD identity.

#### D-007.5 — VOD `youtubeUrl`

- Status: **Confirmed**
- Selected: **Exclude; derive canonical watch URL from `videoId`**
- Confirmed: 2026-07-10

Decision: whether to emit a canonical watch URL in addition to `videoId`, even
though the consumer can derive it deterministically.

Confirmed implication: v1 has no `youtubeUrl` field. Consumers construct
`https://www.youtube.com/watch?v={videoId}` when needed and must not treat an
arbitrary stored URL spelling as identity.

#### D-007.6 — VOD song-list `credit`

- Status: **Confirmed**
- Selected: **Exclude the complete `credit` object**
- Confirmed: 2026-07-10

Decision: whether to include public provenance/attribution for the source that
supplied the VOD's timestamp list. Individual credit members are reviewed only
if the object itself is approved.

Confirmed implication: v1 exposes no `credit`, `author`, `authorUrl`, or
`commentUrl` fields. The consumer receives the curated result without source
attribution metadata.

#### D-007.7 — Song-occurrence `performanceId`

- Status: **Confirmed**
- Selected: **Include opaque `performanceId`**
- Confirmed: 2026-07-10

Decision: whether each song occurrence exposes its opaque Admin performance ID
as a stable record key.

Confirmed implication: every exported song occurrence has a non-empty,
globally unique `performanceId`. Consumers treat it as opaque and do not parse
its prefix. Timestamp corrections do not change occurrence identity; deleting
and recreating an occurrence may assign a new ID.

#### D-007.8 — Song-occurrence `songId`

- Status: **Confirmed**
- Selected: **Include opaque `songId`**
- Confirmed: 2026-07-10

Decision: whether each occurrence exposes the opaque Admin song-row ID so a
consumer can relate performances currently curated as the same song.

Confirmed implication: `songId` relates occurrences attached to the same
current curated Admin song row. It is not a global composition/work ID and does
not guarantee that duplicate song rows have already been harmonized. A curator
merge may move occurrences to the surviving `songId` in a later snapshot.

#### D-007.9 — Song `title`

- Status: **Confirmed**
- Selected: **Include canonical song `title`**
- Confirmed: 2026-07-10

Decision: whether every song occurrence includes the current curator-approved
song title from its canonical Admin song row.

Confirmed implication: every occurrence includes the current approved plain
text `songs.title`. A curator title correction updates all occurrences attached
to that `songId` in the next snapshot.

#### D-007.10 — Song `originalArtist`

- Status: **Confirmed**
- Selected: **Include canonical nullable `originalArtist`**
- Confirmed: 2026-07-10

Decision: whether every song occurrence includes the current curator-approved
original-artist display string from its canonical Admin song row.

Confirmed implication: every occurrence includes the `originalArtist` key. A
known value is the current approved display string; under D-008.7, an unknown
value is JSON `null`. It is not a normalized artist ID, and consumers must not
parse multi-artist free text into identities.

#### D-007.11 — Song `tags`

- Status: **Confirmed**
- Selected: **Exclude free-form `tags` from v1**
- Confirmed: 2026-07-10

Decision: whether every occurrence includes the canonical song row's free-form
string tag array.

Confirmed implication: v1 has no `tags` field. The current dataset contains no
populated tags, and the existing free-form strings have no controlled
vocabulary. A future normalized tag contract requires separate review.

#### D-007.12 — Song occurrence `startSeconds`

- Status: **Confirmed**
- Selected: **Include required integer `startSeconds`**
- Confirmed: 2026-07-10

Decision: whether every occurrence includes its required numeric start offset
from the beginning of the YouTube video, named `startSeconds`.

Confirmed implication: `startSeconds` is a required JSON integer measured from
the beginning of the YouTube video; zero is valid. The legacy field name
`timestamp` and formatted time strings are not part of v1.

#### D-007.13 — Song occurrence `endSeconds`

- Status: **Confirmed**
- Selected: **Include required integer `endSeconds`**
- Confirmed: 2026-07-10
- Revised: 2026-07-11

Decision: whether an occurrence can carry its known numeric end offset from the
beginning of the YouTube video, named `endSeconds`.

Confirmed implication: `endSeconds` is a required integer offset measured from
the beginning of the YouTube video and must be greater than `startSeconds`. It
is never inferred from the next song and invalid ranges are never silently
swapped. A missing or null value is invalid under revised D-008.1. Known
source-data issues are tracked separately in `vod-export-data-issues.md` and
will not be repaired until this specification is finished.

#### D-007.14 — Song occurrence `note`

- Status: **Confirmed**
- Selected: **Exclude free-text `note` from v1**
- Confirmed: 2026-07-10

Decision: whether each occurrence exposes the curator-maintained free-text
performance note.

Confirmed implication: v1 has no `note` field. The current published dataset
contains no populated notes, and no public semantics or content policy exists
for the free-text value. A future public annotation field requires separate
review.

#### D-007.15 — VOD `thumbnailUrl`

- Status: **Confirmed**
- Selected: **Exclude derived/fetched `thumbnailUrl`**
- Confirmed: 2026-07-10

Decision: whether each VOD includes a derived or fetched YouTube thumbnail URL
in addition to `videoId`.

Confirmed implication: v1 has no `thumbnailUrl`. Consumers may derive or fetch
the desired YouTube thumbnail size from `videoId` during their own build; feed
generation does not call YouTube for thumbnails.

#### D-007.16 — Song occurrence timestamped watch URL

- Status: **Confirmed**
- Selected: **Exclude; derive from `videoId` and `startSeconds`**
- Confirmed: 2026-07-10

Decision: whether each occurrence includes a complete YouTube watch URL with
its `startSeconds` encoded as a query parameter.

Confirmed implication: v1 has no timestamped URL field. Consumers construct
their preferred watch/embed URL from the canonical `videoId` and
`startSeconds` values.

#### D-007.17 — Song occurrence `durationSeconds`

- Status: **Confirmed**
- Selected: **Exclude; derive as `endSeconds - startSeconds`**
- Confirmed: 2026-07-10

Decision: whether to emit a computed duration in addition to `startSeconds`
and `endSeconds`.

Confirmed implication: v1 has no `durationSeconds`. Consumers calculate it for
every exported performance because both offsets are required and validated;
the feed has no separate value that can drift from the canonical offsets.

#### D-007.18 — Song occurrence `position`

- Status: **Confirmed**
- Selected: **Exclude; array order represents position**
- Confirmed: 2026-07-10

Decision: whether each song occurrence includes an explicit ordinal position
inside its VOD in addition to its array order and `startSeconds`.

Confirmed implication: v1 has no `position`. Consumers use the deterministic
`performances` array order for display numbering and `performanceId` for stable
identity; inserting or moving an occurrence does not rewrite redundant ordinal
fields.

#### D-007.19 — Song album art

- Status: **Confirmed**
- Selected: **Exclude all album-art metadata from v1**
- Confirmed: 2026-07-10

Decision: whether occurrences include album-art URLs from the separate,
partially populated music-metadata cache.

Confirmed implication: v1 has no album-art URL or image variants. Music-service
matching and artwork remain a separate optional enrichment concern and do not
change the authoritative VOD snapshot.

#### D-007.20 — Song iTunes identifiers

- Status: **Confirmed**
- Selected: **Exclude all iTunes identifiers from v1**
- Confirmed: 2026-07-10

Decision: whether occurrences include cached `itunesTrackId`,
`itunesCollectionId`, or `itunesArtistId` values from music-service matching.

Confirmed implication: v1 has no music-service identifiers. Track, collection,
and artist matching remain outside the authoritative VOD contract and may be
provided only by a separately reviewed enrichment feed.

#### D-007.21 — Public `status` fields

- Status: **Confirmed**
- Selected: **Exclude all Admin `status` fields**
- Confirmed: 2026-07-10

Decision: whether streamer/VOD/song-occurrence objects expose their Admin
approval status even though D-005 permits only approved content.

Confirmed implication: v1 exposes no workflow status. Snapshot membership means
the object is approved and publicly eligible; losing eligibility is represented
by absence from a later authoritative snapshot.

#### D-007.22 — Admin `submittedBy`

- Status: **Confirmed**
- Selected: **Exclude Admin `submittedBy`**
- Confirmed: 2026-07-10

Decision: whether public objects expose the Admin contributor identity/email
that originally submitted a record.

Confirmed implication: v1 exposes no submitter identity or email. Submission
provenance remains private Admin workflow data and cannot be used as public
credit.

#### D-007.23 — Admin `reviewedBy`

- Status: **Confirmed**
- Selected: **Exclude Admin `reviewedBy`**
- Confirmed: 2026-07-10

Decision: whether public objects expose the curator identity/email that
approved or last reviewed a record.

Confirmed implication: v1 exposes no reviewer identity or email. Approval
history remains private Admin audit data; public eligibility is represented
only by snapshot membership.

#### D-007.24 — Admin reviewer notes

- Status: **Confirmed**
- Selected: **Exclude all Admin/NOVA reviewer notes**
- Confirmed: 2026-07-10

Decision: whether any internal reviewer note/reason from Admin or NOVA is
included in the public feed.

Confirmed implication: v1 exposes no reviewer notes, rejection reasons, or
internal processing commentary. The feed contains only final public content,
not its review history.

#### D-007.25 — Admin row `createdAt`

- Status: **Confirmed**
- Selected: **Exclude Admin row `createdAt`**
- Confirmed: 2026-07-11

Decision: whether public VOD/song-occurrence objects include the time their
Admin database row was created.

Confirmed implication: v1 exposes no Admin row creation timestamps. Content
dates come from their explicit domain fields, while snapshot generation and
publication times belong to the envelope/manifest.

#### D-007.26 — Admin row `updatedAt`

- Status: **Confirmed**
- Selected: **Exclude Admin row `updatedAt`**
- Confirmed: 2026-07-11

Decision: whether public VOD/song-occurrence objects include the last time
their Admin database row was updated.

Confirmed implication: v1 exposes no Admin row update timestamps. Consumers
detect public-data changes through the snapshot hash and use snapshot-level
generation/publication times rather than internal workflow timestamps.

#### D-007.27 — Nested song-occurrence array name

- Status: **Confirmed**
- Selected: **`performances`**
- Confirmed: 2026-07-11

Decision: whether the VOD's nested occurrence array is named `songs` or
`performances`.

Confirmed implication: `performances[]` contains song-performance occurrences,
not a deduplicated song catalog. The same `songId` may legally appear more than
once in one VOD.

### D-008 — Null, empty, and optional-field policy

- Status: **Confirmed**
- Selected: **Explicit nulls for confirmed nullable scalars, empty objects or
  arrays for confirmed empty collections, and sparse `socialLinks` provider
  keys**
- Confirmed: 2026-07-11
- Blocking: No

Missing-value rules are reviewed one field at a time.

#### D-008.1 — Missing `endSeconds`

- Status: **Confirmed**
- Selected: **Invalid state; `endSeconds` is required and cannot be null**
- Confirmed: 2026-07-11 (revised from nullable to required)

Decision: whether an occurrence with no known end emits `"endSeconds": null`
or omits the key, or is rejected as invalid.

Confirmed implication: every performance object contains the `endSeconds` key.
Its value must be an integer greater than `startSeconds`; JSON `null`, an empty
string, and key omission are invalid. The 15 currently known missing ends
remain listed in `vod-export-data-issues.md` and must be repaired after this
specification is fully approved.

#### D-008.2 — Unknown `youtubeChannelId`

- Status: **Confirmed**
- Selected: **Invalid state; `youtubeChannelId` is required**
- Confirmed: 2026-07-11

Decision: whether an approved, enabled streamer with no known YouTube channel ID emits
`"youtubeChannelId": null`, omits the key, or is rejected as invalid.

Confirmed implication: the export contract never represents a missing channel
ID. Every streamer object contains a non-empty, validated `youtubeChannelId`
because a streamer and YouTube channel ID are strongly bound. A missing or
invalid source value fails validation, blocks publication of the complete
snapshot, and leaves the previous valid snapshot active. `null`, an empty
string, and key omission are forbidden.

#### D-008.3 — Unknown `avatarUrl`

- Status: **Confirmed**
- Selected: **Always emit `"avatarUrl": null` when no safe URL is available**
- Confirmed: 2026-07-11

Decision: whether an approved, enabled streamer with no approved avatar URL emits
`"avatarUrl": null` or is rejected as invalid. The URL key is not silently
omitted.

Confirmed implication: every streamer object contains the `avatarUrl` key.
Its value is either a sanitized HTTPS URL or JSON `null`. A missing or unsafe
avatar URL becomes `null` and does not block publication of otherwise valid VOD
data. An empty string and key omission are forbidden.

#### D-008.4 — Unknown `group`

- Status: **Confirmed**
- Selected: **Always emit `"group": null` when no label is known**
- Confirmed: 2026-07-11

Decision: whether an approved, enabled streamer with no group label emits
`"group": null`, emits an empty string, or receives an inferred label such as
`"個人勢"`.

Confirmed implication: every streamer object contains the `group` key. Its
value is either a display string or JSON `null`. A missing or blank source value
becomes `null`; the exporter never invents `"個人勢"` or another affiliation.
An empty output string and key omission are forbidden.

#### D-008.5 — Empty `socialLinks`

- Status: **Confirmed**
- Selected: **Always emit an object; use `"socialLinks": {}` when empty**
- Confirmed: 2026-07-11

Decision: whether a streamer with no safe supported social link emits
`"socialLinks": {}` or `"socialLinks": null`. Provider-key handling is a
separate decision.

Confirmed implication: every streamer object contains a `socialLinks` object.
When no safe supported URL is available, it is an empty object. JSON `null`, an
empty string, and omission of the `socialLinks` key are forbidden.

#### D-008.6 — Missing individual social provider

- Status: **Confirmed**
- Selected: **Omit unavailable provider keys**
- Confirmed: 2026-07-11

Decision: whether an unavailable provider is omitted from `socialLinks` or is
included with a JSON `null` value. Only the five providers confirmed in
D-006.3a are eligible as keys.

Confirmed implication: `socialLinks` is a sparse map containing only safe,
usable links. Every emitted provider value is a sanitized HTTPS URL;
unavailable or unsafe providers have no key. Provider values are never JSON
`null` or empty strings.

#### D-008.7 — Unknown `originalArtist`

- Status: **Confirmed**
- Selected: **Always emit `"originalArtist": null` when unknown**
- Confirmed: 2026-07-11

Decision: whether a performance whose approved song row has no
`originalArtist` emits `"originalArtist": null` or is rejected as invalid. A
known current example is tracked as `p621-1` in
`vod-export-data-issues.md`.

Confirmed implication: every performance object contains the
`originalArtist` key. Its value is either a non-empty display string or JSON
`null`. A missing or blank source value becomes `null` without dropping the
otherwise eligible performance. An empty output string, a guessed artist, and
key omission are forbidden. The known source gap remains queued for later
repair even though the contract can represent it safely.

### D-009 — Normalization rules

- Status: **Confirmed**
- Selected: **Explicit, deterministic output-only normalization; never mutate
  or silently repair source data**
- Confirmed: 2026-07-11
- Blocking: No

Confirmed rules include:

- camelCase output keys
- UTF-8 encoding and Unicode NFC normalization
- trimming surrounding whitespace without changing meaningful internal text
- preserve validated source URLs without provider-specific rewriting
- `YYYY-MM-DD` date-only values
- integer seconds relative to VOD start
- validate and normalize output in memory without mutating source values

#### D-009.1 — JSON property naming convention

- Status: **Confirmed**
- Selected: **Use `camelCase` for every public JSON property**
- Confirmed: 2026-07-11

Decision: whether every public JSON property uses `camelCase` or preserves the
source database's `snake_case` names.

Confirmed implication: all property names at every nesting level are
case-sensitive `camelCase` contract names, including `schemaVersion`,
`youtubeChannelId`, `socialLinks`, `performanceId`, `songId`, `startSeconds`,
and `endSeconds`. Source database column names remain internal and are mapped
explicitly; adding or renaming a database column cannot silently alter the
public schema.

#### D-009.2 — JSON text encoding

- Status: **Confirmed**
- Selected: **UTF-8 without BOM**
- Confirmed: 2026-07-11

Decision: whether the exported JSON file is encoded as UTF-8 without a byte
order mark (BOM).

Confirmed implication: the artifact's bytes are UTF-8 and begin directly with
JSON content, never a BOM. Traditional Chinese, Japanese, and other Unicode
text are supported. Content hashes are calculated from these final UTF-8 bytes;
the exact JSON serialization and direct non-ASCII policy are fixed by D-014.

#### D-009.3 — Unicode normalization for display text

- Status: **Confirmed**
- Selected: **Normalize human-readable display text to Unicode NFC**
- Confirmed: 2026-07-11

Decision: whether human-readable text fields are normalized to Unicode NFC
before serialization. This applies to `displayName`, `group`, VOD and song
`title`, and `originalArtist`; opaque IDs and URLs are excluded.

Confirmed implication: canonically equivalent Unicode sequences produce the
same exported string and snapshot bytes. NFC does not translate Traditional
and Simplified Chinese, change case, or apply compatibility folding such as
full-width-to-half-width conversion. Opaque IDs and URLs are never changed by
this rule.

#### D-009.4 — Surrounding whitespace in display text

- Status: **Confirmed**
- Selected: **Trim surrounding Unicode whitespace only**
- Confirmed: 2026-07-11

Decision: whether the exporter removes leading and trailing Unicode whitespace
from human-readable display text while preserving all meaningful whitespace
inside the value.

Confirmed implication: `displayName`, `group`, VOD and song `title`, and
`originalArtist` are trimmed at both ends after NFC normalization. The exact
trim set is U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028,
U+2029, U+202F, U+205F, U+3000, and U+FEFF—the pinned ECMAScript
WhiteSpace-plus-LineTerminator set. D-009.5 URL trimming uses this same set
without applying NFC. Internal whitespace is not collapsed or rewritten. A
nullable field that becomes empty uses its D-008 null representation; a
required field that becomes empty fails validation under D-010.

#### D-009.5 — Provider-specific URL rewriting

- Status: **Confirmed**
- Selected: **Validate safe URLs but do not rewrite them provider-by-provider**
- Confirmed: 2026-07-11

Decision: after safety checks, whether the exporter preserves approved
`avatarUrl` and `socialLinks` URL spellings or rewrites them into
provider-specific canonical forms, such as changing hosts, removing query
parameters, or altering trailing slashes.

Confirmed implication: the exporter trims surrounding whitespace, parses a
copy for HTTPS and provider safety validation, and emits the remaining approved
source string unchanged. It does not reserialize the URL, follow redirects,
change hosts such as `twitter.com` to `x.com`, remove query parameters or
fragments, or alter trailing slashes. Export therefore performs no network
request solely to canonicalize a URL.

The validation-only allowlist is exact after ASCII-lowercasing the hostname and
removing one leading `www.` for comparison: YouTube allows `youtube.com`,
`m.youtube.com`, and `youtu.be`; Twitter/X allows `twitter.com`,
`mobile.twitter.com`, and `x.com`; Facebook allows `facebook.com`,
`m.facebook.com`, and `fb.com`; Instagram allows `instagram.com`; Twitch allows
`twitch.tv`; avatars allow `yt3.ggpht.com`, `yt4.ggpht.com`,
`yt3.googleusercontent.com`, and `lh3.googleusercontent.com`. Require HTTPS,
empty URL credentials, and no explicit port. Reject YouTube `/redirect` URLs
rather than unwrapping or emitting them. Subdomains not listed above are not
implicitly trusted. The exporter uses a dedicated validation-only helper and
must not call the existing rewriting `sanitizeNovaUrl()` path.

#### D-009.6 — VOD date syntax and semantics

- Status: **Confirmed**
- Selected: **Require an exact valid `YYYY-MM-DD` date-only value**
- Confirmed: 2026-07-11

Decision: whether every exported VOD `date` must already be a valid calendar
date in exact `YYYY-MM-DD` form, with no time, timezone, or exporter inference.

Confirmed implication: values such as `2026-7-1`, `2026-02-30`, and
`2026-07-11T20:00:00+08:00` are invalid. The exporter does not pad components,
extract a date from a timestamp, apply a timezone, or guess the intended date.
Invalid-value publication behavior is governed by D-010.

#### D-009.7 — Timestamp numeric coercion

- Status: **Confirmed**
- Selected: **Require integers; never coerce, round, truncate, clamp, or swap**
- Confirmed: 2026-07-11

Decision: whether `startSeconds` and `endSeconds` must be non-negative JSON
integers without converting numeric strings, rounding fractions, or clamping
invalid values.

Confirmed implication: `startSeconds` is an integer greater than or equal to
zero. `endSeconds` is a required integer greater than `startSeconds`. Query each
field's SQLite `typeof()` and a lossless decimal-text representation in the same
transaction; accept only storage class `integer`, parse the transport text
losslessly, and require a JavaScript safe integer before conversion to a JSON
number. An underlying SQLite `TEXT` value such as `"123"` remains invalid even
though the accepted integer is also transported to TypeScript as decimal text.
Fractions, null or negative values, unsafe integers, and invalid ranges fail
validation. The exporter never rounds, truncates, clamps, swaps, or infers
either offset.

#### D-009.8 — Source mutation and automatic correction

- Status: **Confirmed**
- Selected: **Export is strictly read-only**
- Confirmed: 2026-07-11

Decision: whether export is strictly read-only and limits output changes to the
explicitly confirmed normalization rules, without updating Admin data or
silently correcting any other source value.

Confirmed implication: export applies only the confirmed property mapping,
NFC, surrounding-whitespace trimming, and missing-value representations to its
in-memory output. It never writes back to D1, edits committed/generated source
files, fixes timestamps, infers dates, or otherwise changes source data.
Validation reports lead to the separately confirmed D-010 behavior and are
repaired only through an explicit later Admin operation.

### D-010 — Invalid-data behavior

- Status: **Confirmed**
- Selected: **Atomic blocking errors, safe non-blocking fallbacks, and private
  structured findings with a fixed v1 code catalog**
- Confirmed: 2026-07-11
- Blocking: No

Failure classes and reporting behavior were reviewed one at a time. The exporter
must never silently invent an end time or silently swap invalid start and end
values.

Validation begins with approved, enabled streamer rows. For each such streamer,
relationship checks inspect every approved performance: a missing referenced
VOD or song and a cross-streamer relationship are blocking even when that
performance later fails triple-approval eligibility. Public-field validation
then applies to the streamer and only to approved VOD, song, and performance
rows that can participate in an occurrence under D-005.1; a VOD with no such
occurrence is omitted under D-005.2 rather than made blocking by fields that
would never be exported. Rows belonging only to an unapproved or disabled
streamer, unreferenced song rows, and otherwise ineligible VOD/song rows do not
create export findings. This scope does not weaken the all-or-nothing behavior
for any row that is eligible or required to establish an eligible relationship.

#### D-010.1 — Required-field or range validation failure

- Status: **Confirmed**
- Selected: **Fail the complete publication atomically**
- Confirmed: 2026-07-11

Decision: when any otherwise eligible source record has an invalid required
field or range, whether publication fails atomically or the exporter skips that
record and publishes a partial snapshot. Examples include an invalid date,
missing required identity or title, non-integer `startSeconds`, missing
`endSeconds`, and `endSeconds <= startSeconds`.

Confirmed implication: the exporter never drops an invalid performance, VOD,
or streamer and then presents the remainder as a complete snapshot. Any such
error prevents snapshot and manifest publication. The previous valid public
snapshot remains active; if no valid snapshot has ever been published, no
public snapshot is created. The 19 known end-time errors in
`vod-export-data-issues.md` must therefore be repaired after specification
approval and before a successful publication.

#### D-010.2 — Validation error collection

- Status: **Confirmed**
- Selected: **Validate the complete candidate and report all errors together**
- Confirmed: 2026-07-11

Decision: whether one export attempt validates the complete candidate dataset
and reports every discovered error, or stops after the first error.

Confirmed implication: validation continues safely across the full candidate
dataset after finding an error and returns the complete set from that attempt.
This does not weaken D-010.1: any blocking error still prevents all artifact
and manifest publication. Error record shape, Admin presentation, and resource
limits are specified separately.

#### D-010.3 — Unsafe value in an optional URL field

- Status: **Confirmed**
- Selected: **Use the safe fallback and emit a non-blocking warning**
- Confirmed: 2026-07-11

Decision: when a non-empty `avatarUrl` or supported `socialLinks` value fails
HTTPS/provider safety validation, whether its D-008 null/omission fallback is
silent or accompanied by a non-blocking warning. A genuinely absent optional
URL is not an error under this decision.

Confirmed implication: an unsafe non-empty avatar becomes `avatarUrl: null`,
and an unsafe social provider key is omitted. Validation emits a warning that
identifies the source field, but this warning alone does not block publication.
A genuinely missing optional URL uses the same public fallback without a
warning. Unsafe source content is never copied into either the public artifact
or an unescaped Admin display.

#### D-010.4 — Missing `originalArtist` warning

- Status: **Confirmed**
- Selected: **Emit a non-blocking data-quality warning**
- Confirmed: 2026-07-11

Decision: when an otherwise eligible performance emits
`"originalArtist": null` under D-008.7, whether Admin validation reports a
non-blocking data-quality warning or treats the null as fully silent.

Confirmed implication: affected performances remain eligible and publication
may proceed. Validation emits one song-level warning per affected canonical
song row, with integer `details.affectedPerformanceCount`, rather than
duplicating the same source issue for every occurrence. The committed-data scan
on 2026-07-10 found 144 affected song rows spanning 148 performances; `p621-1`
is the one that also appears in the end-time issue report.

#### D-010.5 — Public exposure of validation warnings

- Status: **Confirmed**
- Selected: **Keep findings private to authenticated Admin**
- Confirmed: 2026-07-11

Decision: whether non-blocking validation warnings are included in the public
snapshot or manifest, or remain private to the authenticated Admin workflow.

Confirmed implication: neither the public snapshot nor its manifest contains
validation errors, warnings, repair notes, or unsafe source values. A consumer
sees only the confirmed public fallback such as `originalArtist: null`,
`avatarUrl: null`, or an omitted social provider key. Authenticated Admin users
receive the private findings separately.

#### D-010.6 — Validation finding representation

- Status: **Confirmed**
- Selected: **Structured objects with stable code, severity, and message**
- Confirmed: 2026-07-11

Decision: whether the Admin validation response returns structured finding
objects with stable machine-readable codes and severity, in addition to human
messages, or returns only free-form text strings.

Confirmed implication: every finding object has a stable `code`, a `severity`
of `"error"` or `"warning"`, and a human-readable `message`. Admin behavior and
tests branch on `code` and `severity`, never message wording. Context fields are
reviewed individually below.

#### D-010.7 — Finding `streamerSlug` context

- Status: **Confirmed**
- Selected: **Include `streamerSlug` when available and safe**
- Confirmed: 2026-07-11

Decision: whether every finding tied to streamer data includes the affected
public `streamerSlug`, allowing Admin to filter and navigate without parsing an
ID or message. Non-data system failures are outside this field decision.

Confirmed implication: every validation finding caused by streamer, VOD, song,
or performance data contains the exact public `streamerSlug` when one is
available and safe. Export-wide system failures and rows whose streamer slug is
itself missing or unsafe omit this context; they never use JSON `null`, an
empty slug, or an unsafe source value as a placeholder. A private typed locator
is used where the public context cannot exist.

#### D-010.8 — Finding `entityType` context

- Status: **Confirmed**
- Selected: **Required fixed enum for every streamer-data finding**
- Confirmed: 2026-07-11

Decision: whether every streamer-data finding identifies the primary affected
entity using a fixed `entityType` enum: `"streamer"`, `"vod"`, `"song"`, or
`"performance"`.

Confirmed implication: each streamer-data finding uses exactly one of the four
case-sensitive values. The public concept is always `"vod"`; internal table
names such as `"streams"` never appear in this field. A finding is assigned to
the most directly repairable affected entity.

#### D-010.9 — Finding `entityId` context

- Status: **Confirmed**
- Selected: **Include the entity's existing public identifier**
- Confirmed: 2026-07-11

Decision: whether every streamer-data finding includes a stable `entityId`
whose meaning is determined by `entityType`: streamer slug, VOD `videoId`,
`songId`, or `performanceId`. The separate `streamerSlug` keeps a VOD video ID
properly scoped and no private Admin stream ID is exposed.

Confirmed implication: `entityId` is a non-empty safe public identifier when
one exists. For `entityType: "streamer"` it is the slug; for `"vod"` it is
`videoId`; for `"song"` it is `songId`; and for `"performance"` it is
`performanceId`. When the problem is a missing or unsafe public identifier,
the finding omits `entityId` and uses the context-fallback locator defined
in D-010.34. Consumers interpret `entityId` together with `entityType` and
`streamerSlug` and never substitute a mutable title or URL.

#### D-010.10 — Finding `field` context

- Status: **Confirmed**
- Selected: **Use the public camelCase property name when field-specific**
- Confirmed: 2026-07-11

Decision: whether a field-specific finding includes the affected public
camelCase property name, such as `"endSeconds"`, rather than the source database
column name such as `"end_timestamp"`. Entity-wide findings would omit the key.

Confirmed implication: a field-specific finding has a non-empty `field` that
matches the public contract exactly. Findings about an entity as a whole or a
cross-entity relationship omit `field`; they never emit JSON `null`, an empty
string, or an internal D1 column name.

#### D-010.11 — Raw offending value in findings

- Status: **Confirmed**
- Selected: **Do not include a generic raw source value**
- Confirmed: 2026-07-11

Decision: whether a finding includes a generic copy of the raw source value
that failed validation, including potentially unsafe URLs or untrusted text.
Safe typed diagnostic details can be considered separately.

Confirmed implication: finding objects have no generic `value`, `rawValue`, or
source-row dump, and `message` never interpolates untrusted raw content. Admin
uses the confirmed identifiers to open the protected source record. This rule
reduces accidental disclosure, oversized responses, and unsafe rendering; it
does not prevent separately whitelisted typed diagnostics.

#### D-010.12 — Whitelisted typed diagnostic details

- Status: **Confirmed**
- Selected: **Allow a code-specific, strictly typed `details` object**
- Confirmed: 2026-07-11

Decision: whether a finding may include a `details` object whose allowed keys
and primitive types are fixed per stable finding `code`, such as integer
`startSeconds` and `endSeconds` for `INVALID_END_RANGE`. Arbitrary text, URLs,
objects, and source-row copies remain forbidden.

Confirmed implication: each finding code's schema explicitly enumerates any
permitted `details` keys and primitive value types. Unknown keys, arbitrary
text, URLs, nested objects, arrays, and source-row copies are rejected. A
finding with no approved typed diagnostic and no context-fallback locator omits
`details`; it never emits JSON `null` or an empty object merely as a placeholder.

#### D-010.13 — Findings collection shape

- Status: **Confirmed**
- Selected: **Return one `findings` array classified by `severity`**
- Confirmed: 2026-07-11

Decision: whether the private validation response returns one `findings` array
whose entries carry `severity`, or duplicates the classification by returning
separate `errors` and `warnings` arrays.

Confirmed implication: the response has exactly one `findings` array, which is
empty when no findings exist. Errors and warnings are never duplicated into
parallel arrays; Admin filters the single collection by each entry's required
`severity`.

#### D-010.14 — Validation `canPublish` result

- Status: **Confirmed**
- Selected: **Include a server-derived, server-enforced `canPublish` boolean**
- Confirmed: 2026-07-11

Decision: whether the validation response includes an authoritative boolean
`canPublish`, derived solely from whether the candidate has any finding with
`severity: "error"`. Warnings alone would leave it true.

Confirmed implication: `canPublish` is false if and only if at least one
finding has `severity: "error"`; it is true for warnings-only and finding-free
candidates. The server recomputes and enforces the condition during publication,
so a client cannot bypass it by changing UI state or a request payload.

#### D-010.15 — Deterministic finding order

- Status: **Confirmed**
- Selected: **Sort by severity, scope, streamer, entity, field, and code**
- Confirmed: 2026-07-11

Decision: whether `findings` is deterministically ordered with errors before
warnings, then by `streamerSlug`, fixed `entityType` order, `entityId`, optional
`field`, and finally `code`, rather than relying on query or discovery order.

Confirmed implication: sorting uses, in order: errors before warnings;
export-wide system findings before streamer-data findings; slugless data
findings before valid `streamerSlug` values; `streamerSlug` ascending; entity
types in `streamer`, `vod`, `song`, `performance` order; missing `entityId`
before present values; then `entityId`, present `field`, and `code` ascending.
Message text and code-specific diagnostic details never affect order. Only when
public identity is unavailable does the approved context-fallback locator in
D-010.34 act as a final tie-breaker, so multiple broken source rows remain
deterministic.
Identical candidate data therefore produces the same finding order regardless
of query or validation discovery order.

#### D-010.16 — Finding code granularity and spelling

- Status: **Confirmed**
- Selected: **One stable `SCREAMING_SNAKE_CASE` code per validation rule**
- Confirmed: 2026-07-11

Decision: whether each validation rule receives a specific stable
`SCREAMING_SNAKE_CASE` code, such as `MISSING_END_SECONDS` or
`INVALID_END_RANGE`, or many unrelated rules share a generic code such as
`INVALID_DATA` and rely on message text for distinction.

Confirmed implication: Admin logic, tests, and repair tooling distinguish
rules by their specific code and never parse message text. Codes are
case-sensitive and remain stable while message wording may change. The v1
catalog is confirmed one relationship or field rule at a time below.

#### D-010.17 — Missing VOD relationship code

- Status: **Confirmed**
- Selected: **Blocking `MISSING_VOD_RELATION` on the performance**
- Confirmed: 2026-07-11

Decision: whether an approved performance whose referenced VOD row is absent
uses the blocking code `MISSING_VOD_RELATION`. A referenced VOD that exists but
is not approved remains merely ineligible under D-005.1 and does not produce
this error.

Confirmed implication: the finding has `severity: "error"`, the performance's
`streamerSlug`, `entityType: "performance"`, and its `performanceId` as
`entityId`. Because this is a cross-entity relationship failure, it omits
`field`. Private source foreign-key values and raw rows are not included.

#### D-010.18 — Missing song relationship code

- Status: **Confirmed**
- Selected: **Blocking `MISSING_SONG_RELATION` on the performance**
- Confirmed: 2026-07-11

Decision: whether an approved performance whose referenced song row is absent
uses the blocking code `MISSING_SONG_RELATION`. A referenced song that exists
but is not approved remains merely ineligible under D-005.1 and does not
produce this error.

Confirmed implication: the finding has `severity: "error"`, the performance's
`streamerSlug`, `entityType: "performance"`, and its `performanceId` as
`entityId`. It omits `field` and all private foreign-key or raw-row content.

#### D-010.19 — VOD streamer mismatch code

- Status: **Confirmed**
- Selected: **Blocking `VOD_STREAMER_MISMATCH` on the performance**
- Confirmed: 2026-07-11

Decision: whether an approved performance and its existing referenced VOD
belonging to different streamers uses the blocking code
`VOD_STREAMER_MISMATCH` on the performance.

Confirmed implication: the finding has `severity: "error"`, the performance's
`streamerSlug`, `entityType: "performance"`, and its `performanceId` as
`entityId`. It omits `field` and blocks the complete publication.

#### D-010.20 — Song streamer mismatch code

- Status: **Confirmed**
- Selected: **Blocking `SONG_STREAMER_MISMATCH` on the performance**
- Confirmed: 2026-07-11

Decision: whether an approved performance and its existing referenced song
belonging to different streamers uses the blocking code
`SONG_STREAMER_MISMATCH` on the performance.

Confirmed implication: the finding has `severity: "error"`, the performance's
`streamerSlug`, `entityType: "performance"`, and its `performanceId` as
`entityId`. It omits `field` and blocks the complete publication.

#### D-010.21 — Missing streamer slug finding context

- Status: **Confirmed**
- Selected: **Blocking `MISSING_STREAMER_SLUG` with a private Admin locator**
- Confirmed: 2026-07-11

Decision: how to report an approved streamer row whose required `slug` is
missing or blank, because that state cannot populate the otherwise required
`streamerSlug` or slug-based `entityId`. The Admin schema is `NOT NULL` but
currently permits an empty string.

Confirmed implication: this finding has `severity: "error"`,
`code: "MISSING_STREAMER_SLUG"`, `entityType: "streamer"`, and `field: "slug"`.
It is one of the two slug-identity findings permitted to omit `streamerSlug`
and `entityId`; its code-specific `details.submissionId` is the bounded internal
NOVA ID used to open the protected Admin row. That ID never appears in the
public snapshot or manifest.

#### D-010.22 — Missing YouTube channel ID code

- Status: **Confirmed**
- Selected: **Blocking `MISSING_YOUTUBE_CHANNEL_ID` on the streamer field**
- Confirmed: 2026-07-11

Decision: whether an approved, enabled streamer with a missing or blank
required `youtubeChannelId` uses the blocking code
`MISSING_YOUTUBE_CHANNEL_ID` on the streamer and field.

Confirmed implication: the finding has `severity: "error"`, the streamer's
slug as both `streamerSlug` and `entityId`, `entityType: "streamer"`, and
`field: "youtubeChannelId"`. It has no `details` and blocks the complete
publication, enforcing the confirmed strong binding.

#### D-010.23 — YouTube channel ID verification source

- Status: **Confirmed**
- Selected: **Verify through YouTube when changed; export from persisted state**
- Confirmed: 2026-07-11

Decision: whether channel identity is verified through YouTube's official
`channels.list(id=...)` response when the ID is entered or changed in Admin,
then persisted as internal verification state, rather than inferred from a
hard-coded `UC...` length regex or rechecked over the network during export.
YouTube documents channel IDs as the unique identifier accepted by the API but
does not publish a fixed length/prefix contract in the channel resource schema:
[YouTube channel resource](https://developers.google.com/youtube/v3/docs/channels),
[channels.list](https://developers.google.com/youtube/v3/docs/channels/list).

Confirmed implication: Admin verifies an entered or changed value by requiring
`channels.list(id=...)` to return that exact channel ID, then stores the
verified ID and verification time as private state. Any ID change clears the
old state and requires re-verification. Export accepts the ID only when it
exactly matches the persisted verified ID; export performs no YouTube network
request and does not depend on API availability or quota. Verification state
is never part of the public snapshot or manifest.

The migration that introduces this state marks every pre-existing channel ID
unverified; it must not infer success from the current value, its `UC` prefix,
or its length. Before the first publication, curators run the same official API
verification for every approved, enabled streamer. Any value that cannot be
verified remains blocking under D-010.24 and is appended to
`vod-export-data-issues.md` for explicit remediation rather than being blindly
backfilled as verified.

#### D-010.24 — Unverified YouTube channel ID code

- Status: **Confirmed**
- Selected: **Blocking `UNVERIFIED_YOUTUBE_CHANNEL_ID` on the streamer field**
- Confirmed: 2026-07-11

Decision: whether a non-empty current `youtubeChannelId` that does not exactly
match persisted successful verification state uses the blocking code
`UNVERIFIED_YOUTUBE_CHANNEL_ID`. The missing-value case remains the distinct
`MISSING_YOUTUBE_CHANNEL_ID` rule.

Confirmed implication: the finding has `severity: "error"`, the streamer's
slug as both `streamerSlug` and `entityId`, `entityType: "streamer"`, and
`field: "youtubeChannelId"`. It has no `details` and blocks publication. A
missing or blank value never uses this code; it uses
`MISSING_YOUTUBE_CHANNEL_ID`.

#### D-010.25 — Missing streamer display name code

- Status: **Confirmed**
- Selected: **Blocking `MISSING_DISPLAY_NAME` on the streamer field**
- Confirmed: 2026-07-11

Decision: whether an approved, enabled streamer whose `displayName` is missing
or becomes empty after confirmed trimming uses the blocking code
`MISSING_DISPLAY_NAME` on the streamer field.

Confirmed implication: the finding has `severity: "error"`, the streamer's
slug as both `streamerSlug` and `entityId`, `entityType: "streamer"`, and
`field: "displayName"`. It has no `details`, does not substitute the slug as a
display label, and blocks the complete publication.

#### D-010.26 — Invalid streamer slug code and safe locator

- Status: **Confirmed**
- Selected: **Blocking `INVALID_STREAMER_SLUG` with a private Admin locator**
- Confirmed: 2026-07-11

Decision: whether a non-empty slug outside the repository's existing canonical
format uses blocking `INVALID_STREAMER_SLUG`, omits the unsafe value from
`streamerSlug` and `entityId`, and uses the private `details.submissionId`
locator. The canonical format is 1–50 lowercase ASCII letters, digits, or
internal hyphens, with no leading or trailing hyphen.

Confirmed implication: the exporter applies the existing canonical slug
validator and never lowercases or otherwise repairs a value. The finding has
`severity: "error"`, `entityType: "streamer"`, `field: "slug"`, and the private
bounded `details.submissionId`; it omits the invalid slug from `streamerSlug`
and `entityId` and blocks publication.

#### D-010.27 — Duplicate streamer slug code

- Status: **Confirmed**
- Selected: **One blocking `DUPLICATE_STREAMER_SLUG` per duplicate slug**
- Confirmed: 2026-07-11

Decision: whether two or more approved, enabled streamer rows with the same
valid slug produce one blocking `DUPLICATE_STREAMER_SLUG` finding for that
slug, with a whitelisted integer `details.duplicateCount`.

Confirmed implication: the single finding has `severity: "error"`, the shared
valid slug as both `streamerSlug` and `entityId`, `entityType: "streamer"`,
`field: "slug"`, and integer `details.duplicateCount`. Admin finds all
conflicting rows by slug; individual internal submission IDs and duplicate
findings are not emitted. Publication is blocked.

#### D-010.28 — Duplicate YouTube channel binding

- Status: **Confirmed**
- Selected: **One verified channel ID may bind only one approved, enabled streamer**
- Confirmed: 2026-07-11

Decision: whether one verified `youtubeChannelId` may be bound to more than one
approved, enabled streamer. The confirmed behavior is one blocking
`DUPLICATE_YOUTUBE_CHANNEL_ID` finding on each conflicting streamer, with
`field: "youtubeChannelId"` and integer `details.duplicateCount`.

Confirmed implication: each conflicting streamer receives a finding with
`severity: "error"`, `code: "DUPLICATE_YOUTUBE_CHANNEL_ID"`, its slug as
`streamerSlug` and `entityId`, `entityType: "streamer"`, field
`youtubeChannelId`, and integer `details.duplicateCount`. The raw channel ID is
not copied into the finding. Any conflict blocks publication.

#### D-010.29 — Missing VOD video ID finding context

- Status: **Confirmed**
- Selected: **Blocking `MISSING_VIDEO_ID` with a private Admin locator**
- Confirmed: 2026-07-11

Decision: how to report an approved VOD whose required `videoId` is missing or
blank, because that state cannot populate its video-ID-based `entityId`. The
confirmed blocking code is `MISSING_VIDEO_ID`, with `streamerSlug`,
`entityType: "vod"`, `field: "videoId"`, and a private bounded
`details.streamId` Admin locator while omitting `entityId`.

Confirmed implication: the finding has `severity: "error"` and the exact
context described above. The internal stream ID is allowed only by this
code-specific details schema and appears only in authenticated Admin. No VOD
title, URL, or other mutable value is used as a fallback identity. Publication
is blocked.

#### D-010.30 — Invalid VOD video ID code and syntax

- Status: **Confirmed**
- Selected: **Blocking `INVALID_VIDEO_ID` with the 11-character allowlist**
- Confirmed: 2026-07-11

Decision: whether a non-empty VOD `videoId` outside the repository's existing
safe lookup-key format—exactly 11 ASCII letters, digits, underscores, or
hyphens—uses blocking `INVALID_VIDEO_ID`, omits the unsafe `entityId`, and uses
private `details.streamId` for Admin navigation. No URL parsing or YouTube
network lookup is performed during export.

Confirmed implication: the finding has `severity: "error"`, the VOD's
`streamerSlug`, `entityType: "vod"`, `field: "videoId"`, and private bounded
`details.streamId`; it omits the invalid `entityId` and blocks publication. The
exporter neither extracts a replacement from a URL nor checks current YouTube
availability, so removed or private historical videos remain representable
when their stored ID is syntactically valid.

#### D-010.31 — Duplicate VOD video ID within one streamer

- Status: **Confirmed**
- Selected: **One blocking `DUPLICATE_VOD_VIDEO_ID` per scoped identity**
- Confirmed: 2026-07-11

Decision: whether two or more approved VOD rows with the same scoped identity
`(streamerSlug, videoId)` produce one blocking `DUPLICATE_VOD_VIDEO_ID` finding
with integer `details.duplicateCount`. The same `videoId` under different
streamers remains explicitly valid.

Confirmed implication: the finding has `severity: "error"`, the shared
`streamerSlug`, `entityType: "vod"`, the valid shared `videoId` as `entityId`,
`field: "videoId"`, and integer `details.duplicateCount`. Exactly one finding
is emitted per duplicated scoped identity. Cross-streamer reuse is never an
error, and any same-streamer duplicate blocks publication.

#### D-010.32 — Missing VOD title code

- Status: **Confirmed**
- Selected: **Blocking `MISSING_VOD_TITLE` on the canonical VOD field**
- Confirmed: 2026-07-11

Decision: whether an approved VOD whose canonical `title` is missing or becomes
empty after confirmed normalization uses the blocking code
`MISSING_VOD_TITLE` on the VOD field, without falling back to repeated
performance metadata or a live YouTube title.

Confirmed implication: the finding has `severity: "error"`, the VOD's
`streamerSlug`, `entityType: "vod"`, its valid `videoId` as `entityId`, and
`field: "title"`. It has no `details`. The exporter neither uses denormalized
performance text nor performs a network lookup; publication is blocked.

#### D-010.33 — Missing VOD date code

- Status: **Confirmed**
- Selected: **Blocking `MISSING_VOD_DATE` on the canonical VOD field**
- Confirmed: 2026-07-11

Decision: whether an approved VOD whose canonical `date` is missing or blank
uses the blocking code `MISSING_VOD_DATE` on the VOD field, without falling
back to repeated performance metadata, YouTube metadata, or filesystem dates.

Confirmed implication: the finding has `severity: "error"`, the VOD's
`streamerSlug`, `entityType: "vod"`, its valid `videoId` as `entityId`, and
`field: "date"`. It has no diagnostic details. The exporter does not infer a
date, and publication is blocked.

#### D-010.34 — Remaining v1 code catalog and precedence

- Status: **Confirmed**
- Selected: **Complete the minimal catalog and deterministic emission rules
  below**
- Confirmed: 2026-07-11 under the product owner's delegated authority for the
  remaining error-handling details

Decision: complete the v1 finding catalog without adding public fields or
silently changing source data. This table is normative; a new validation rule
requires a new stable code and a reviewed specification change.

##### Blocking error catalog

| Code | Primary entity / field | Allowed code-specific `details` | Trigger |
|---|---|---|---|
| `MISSING_STREAMER_SLUG` | streamer / `slug` | private `submissionId` | Enabled approved streamer has no non-blank slug. |
| `INVALID_STREAMER_SLUG` | streamer / `slug` | private `submissionId` | Non-empty slug fails the confirmed canonical allowlist. |
| `DUPLICATE_STREAMER_SLUG` | streamer / `slug` | integer `duplicateCount` | A valid slug occurs on multiple approved, enabled streamer rows. |
| `MISSING_DISPLAY_NAME` | streamer / `displayName` | none | Normalized display name is empty. |
| `MISSING_YOUTUBE_CHANNEL_ID` | streamer / `youtubeChannelId` | none | Strong-bound channel ID is absent. |
| `UNVERIFIED_YOUTUBE_CHANNEL_ID` | streamer / `youtubeChannelId` | none | Current non-empty ID does not match persisted verification state. |
| `DUPLICATE_YOUTUBE_CHANNEL_ID` | streamer / `youtubeChannelId` | integer `duplicateCount` | A verified ID is bound to multiple approved, enabled streamers. |
| `MISSING_VOD_RELATION` | performance / relationship | none | Approved performance references no VOD row. |
| `MISSING_SONG_RELATION` | performance / relationship | none | Approved performance references no song row. |
| `VOD_STREAMER_MISMATCH` | performance / relationship | none | Performance and referenced VOD have different streamers. |
| `SONG_STREAMER_MISMATCH` | performance / relationship | none | Performance and referenced song have different streamers. |
| `MISSING_VIDEO_ID` | VOD / `videoId` | private `streamId` | Canonical VOD video ID is absent. |
| `INVALID_VIDEO_ID` | VOD / `videoId` | private `streamId` | Non-empty video ID fails the confirmed 11-character allowlist. |
| `DUPLICATE_VOD_VIDEO_ID` | VOD / `videoId` | integer `duplicateCount` | Scoped `(streamerSlug, videoId)` occurs more than once. |
| `MISSING_VOD_TITLE` | VOD / `title` | none | Normalized canonical VOD title is empty. |
| `MISSING_VOD_DATE` | VOD / `date` | none | Canonical VOD date is absent. |
| `INVALID_VOD_DATE` | VOD / `date` | none | Non-empty date is not a real exact `YYYY-MM-DD` date. |
| `MISSING_SONG_ID` | song / `songId` | private integer `rowId` | Canonical song row has no non-empty public ID. |
| `MISSING_SONG_TITLE` | song / `title` | none | Normalized canonical song title is empty. |
| `MISSING_PERFORMANCE_ID` | performance / `performanceId` | private integer `rowId` | Performance row has no non-empty public ID. |
| `INVALID_UNICODE_TEXT` | affected entity / affected public text field | none | A text value that would be exported contains an unpaired UTF-16 surrogate or cannot be represented as valid Unicode scalar values. |
| `MISSING_START_SECONDS` | performance / `startSeconds` | none | Start offset is absent or null. |
| `INVALID_START_SECONDS` | performance / `startSeconds` | none | Start offset is not an integer greater than or equal to zero. |
| `MISSING_END_SECONDS` | performance / `endSeconds` | none | Required end offset is absent or null. |
| `INVALID_END_SECONDS` | performance / `endSeconds` | none | End offset is not a non-negative integer. |
| `INVALID_END_RANGE` | performance / `endSeconds` | integer `startSeconds`, integer `endSeconds` | Both offsets are valid integers but end is not greater than start. |

##### Non-blocking warning catalog

| Code | Primary entity / field | Allowed `details` | Trigger and safe output |
|---|---|---|---|
| `UNSAFE_AVATAR_URL` | streamer / `avatarUrl` | none | Non-empty value fails URL safety; emit `avatarUrl: null`. |
| `UNSAFE_SOCIAL_LINK` | streamer / `socialLinks` | fixed boolean keys `youtube`, `twitter`, `facebook`, `instagram`, `twitch` | One finding aggregates rejected non-empty provider URLs; omit each rejected provider key. |
| `MISSING_ORIGINAL_ARTIST` | song / `originalArtist` | integer `affectedPerformanceCount` | Canonical artist is blank; emit `originalArtist: null` for every affected occurrence. |

All error codes have `severity: "error"` and make `canPublish` false. All warning
codes have `severity: "warning"`, apply the confirmed safe output, and do not
block publication. A missing optional avatar, social link, or group is valid
and produces no finding.

##### Context fallback for missing public identifiers

Independent findings on a row are still reported when that row's own public
identifier is missing or unsafe. In that case every finding for the row omits
the unavailable `entityId` and carries its approved private locator:

- streamer: `details.submissionId`; also omit unavailable `streamerSlug`;
- VOD: `details.streamId`;
- song or performance: integer `details.rowId`.

These locators are authenticated-Admin-only, never public, and may be used only
to navigate to the source row. They are context fallbacks permitted in addition
to the table's code-specific `details`; therefore a table entry of `none` does
not prohibit the applicable fallback locator. They do not change the public
identity contract.

##### Finding emission precedence

To collect all actionable issues without cascading noise:

1. For one field, `MISSING_*` takes precedence over its `INVALID_*` code.
2. A missing relationship suppresses only that relationship's mismatch check.
3. Duplicate checks consider only non-empty, syntactically valid identifiers.
4. `INVALID_END_RANGE` runs only when both offsets are valid integers; invalid
   offset types still produce their own field finding.
5. Independent invalid fields on the same entity are all reported.
6. Emit at most one finding for each `(code, streamer context, entity context,
   field)` tuple; the explicitly defined duplicate and unsafe-social findings
   aggregate their counts or provider flags.

The private response contains only `canPublish` and the complete `findings`
array at this layer. It does not duplicate derived error/warning counts; Admin
computes those from the complete array.

### D-011 — Ordering and reproducibility

- Status: **Confirmed**
- Selected: **Stable public-field ordering and no volatile snapshot timestamp**
- Confirmed: 2026-07-11
- Blocking: No

Confirmed array ordering:

1. streamers by slug ascending;
2. VODs by date descending, then video ID ascending;
3. performances within a VOD by start seconds ascending, then performance ID
   ascending.

The snapshot carries no volatile generation/export timestamp, so identical
content can serialize to identical bytes.

Every string comparison in D-011 and D-010.15 uses ascending ordinal UTF-8
bytes after the field's confirmed validation/normalization. Do not use
`localeCompare()`, locale-aware database collation, case folding, or mutable
display labels. Descending date order reverses only the already validated ASCII
`YYYY-MM-DD` key; numeric seconds use exact integer comparison.

#### D-011.1 — Streamer array order

- Status: **Confirmed**
- Selected: **`slug` ascending**
- Confirmed: 2026-07-11

Decision: whether `streamers` is ordered by stable `slug` ascending, or by the
mutable private NOVA `displayOrder` followed by slug. `displayOrder` is not a
public v1 field under the confirmed schema.

Confirmed implication: `streamers` uses ascending case-sensitive slug order.
NOVA `displayOrder` does not affect exported bytes or hashes and remains
private. A future shared presentation order requires an explicit public field
and reviewed contract change.

#### D-011.2 — VOD array order

- Status: **Confirmed**
- Selected: **`date` descending, then `videoId` ascending**
- Confirmed: 2026-07-11

Decision: whether each streamer's `vods` array is ordered by `date` descending
and then `videoId` ascending, giving newest dates first with a stable public
tie-breaker.

Confirmed implication: newest VOD dates appear first. VODs on the same date use
ascending case-sensitive `videoId` order. Internal stream IDs, titles, and
database query order never affect the array. An empty `vods` array remains
valid under D-005.4.

#### D-011.3 — Performance array order

- Status: **Confirmed**
- Selected: **`startSeconds` ascending, then `performanceId` ascending**
- Confirmed: 2026-07-11

Decision: whether each VOD's `performances` array is ordered by `startSeconds`
ascending and then `performanceId` ascending, preserving chronological playback
order with a stable public tie-breaker.

Confirmed implication: occurrences follow playback chronology. Equal start
offsets use ascending case-sensitive `performanceId` order; song title, artist,
end offset, source query order, and any inferred position never affect the
array order.

#### D-011.4 — Volatile timestamp inside snapshot bytes

- Status: **Confirmed**
- Selected: **Exclude all volatile generation/export timestamps**
- Confirmed: 2026-07-11

Decision: whether the content-addressed snapshot itself includes an
`exportedAt` or generation timestamp, which would change its bytes and hash on
every run even when all public content is unchanged. Manifest timestamp fields
are defined by D-014.

Confirmed implication: the snapshot has no `exportedAt`, `generatedAt`, or
`publishedAt`. Repeated generation from identical normalized content produces
the same logical document and, under D-014 serialization, the same bytes,
hash, and immutable URL. Operational timestamps belong only to the manifest or
private Admin response.

### D-012 — Versioning and compatibility

- Status: **Confirmed**
- Selected: **Semantic schema versions, isolated major namespaces, 90-day
  migration updates, retained frozen majors, and unchanged legacy endpoints**
- Confirmed: 2026-07-11
- Blocking: No

Confirmed model summary:

- use a semantic string such as `schemaVersion: "1.0.0"`;
- additive optional fields increment the minor version;
- removals, renames, type changes, nullability changes, and meaning changes
  increment the major version;
- keep old major-version endpoints available for a documented migration period;
- never change the existing legacy export endpoint shapes.

The individual versioning decisions below are normative.

#### D-012.1 — Snapshot schema-version field

- Status: **Confirmed**
- Selected: **Required top-level string `schemaVersion: "1.0.0"` for this
  initial contract**
- Confirmed: 2026-07-11

Decision: whether every snapshot produced under this initial v1.0.0 contract
has required top-level string `"schemaVersion": "1.0.0"`, rather than a numeric
version or an implicit version known only from its URL.

Confirmed implication: every snapshot is self-describing even when detached
from its URL. Consumers compare the semantic-version string before processing
the document and must not infer the schema solely from the object path.

#### D-012.2 — Breaking-change major version rule

- Status: **Confirmed**
- Selected: **Increment major for every backward-incompatible contract change**
- Confirmed: 2026-07-11

Decision: whether any backward-incompatible contract change increments the
major version, including field removal or rename, type or nullability change,
identity or nesting change, ordering or replacement-semantics change, and a
meaning change to an existing field.

Confirmed implication: incompatible changes start a new major contract and
object path, such as `2.0.0` under `/vod/v2/`. A consumer that does not support
the observed major version rejects the snapshot rather than guessing. A new
value in a previously closed enum is also breaking unless that enum was
explicitly documented as open.

#### D-012.3 — Backward-compatible minor version rule

- Status: **Confirmed**
- Selected: **Increment minor for safely ignorable additive public fields**
- Confirmed: 2026-07-11

Decision: whether adding public fields or metadata that existing consumers may
safely ignore increments the minor version, while preserving every existing
field's type, meaning, nullability, identity, and ordering behavior. Consumers
within a supported major are required to ignore unknown properties.

Confirmed implication: an additive compatible contract moves, for example,
from `1.0.0` to `1.1.0`. Consumers supporting major version 1 ignore unknown
properties, while consumers that need the new field check the minimum minor
version. An additive field must not reinterpret or conditionally remove any
existing data.

#### D-012.4 — Patch version rule

- Status: **Confirmed**
- Selected: **Patch only for compatible specification corrections**
- Confirmed: 2026-07-11

Decision: whether patch increments are reserved for backward-compatible
specification corrections or clarifications that do not change the structure,
types, nullability, identity, ordering, or meaning of any valid snapshot. Data
updates and implementation fixes that merely restore conformance would keep the
same schema version.

Confirmed implication: content-only snapshot changes never alter
`schemaVersion`. A producer fix that restores already specified behavior also
keeps the same version. Patch increments are limited to compatible corrections
to the documented contract itself and never disguise an additive or breaking
change.

#### D-012.5 — Major-version URL namespace separation

- Status: **Confirmed**
- Selected: **Separate immutable prefixes and manifests for every major**
- Confirmed: 2026-07-11

Decision: whether every major version has a separate immutable snapshot prefix
and mutable manifest, such as `/vod/v1/...` and `/vod/v2/...`, and publishing a
new major is forbidden from repointing or changing the meaning of an older
major's URLs.

Confirmed implication: each major has its own content-addressed snapshots and
manifest. Introducing a new major never changes existing older-major bytes,
paths, or semantics; consumers opt in by changing the major-version manifest
they follow.

#### D-012.6 — Previous-major active update window

- Status: **Confirmed**
- Selected: **Minimum 90-calendar-day synchronized update window**
- Confirmed: 2026-07-11

Decision: after a successor major becomes the recommended production version,
how long the immediately previous major must continue receiving synchronized
content updates. The confirmed minimum is 90 calendar days.

Confirmed implication: the 90-day clock starts when the successor major becomes
the documented recommended production version. During that window, normal
publications update both current and immediately previous major contracts from
the same approved source state. The window may be extended but not shortened.

#### D-012.7 — Frozen previous-major retention

- Status: **Confirmed**
- Selected: **Freeze and retain until separately retired**
- Confirmed: 2026-07-11

Decision: after the synchronized update window ends, whether the previous
major's manifest freezes on its last valid snapshot and remains readable with
that snapshot until a separate explicit retirement decision, rather than being
automatically deleted on a timer.

Confirmed implication: after active updates stop, the old manifest continues
to resolve to its last valid immutable snapshot. Automated lifecycle cleanup
must exempt both objects. Complete removal requires a separately reviewed,
documented retirement action; continued readability does not imply continued
freshness.

#### D-012.8 — Existing legacy export endpoints

- Status: **Confirmed**
- Selected: **Leave both existing curator-only endpoints unchanged**
- Confirmed: 2026-07-11

Decision: whether the new public snapshot contract is strictly additive and
must not change the response shape, authorization, behavior, or URL of the
existing curator-only `/api/export/songs` and `/api/export/streams` endpoints.

Confirmed implication: the new VOD snapshot has separate routes, storage, and
tests. Existing clients of both legacy endpoints observe no URL, authorization,
query-default, response-shape, sorting, or behavior change. Any future legacy
deprecation requires its own migration decision.

#### D-012.9 — Future multi-major publication cutover

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: v1 guarantees atomic cutover only for its single v1
manifest. Before any v2 contract can become the recommended production major,
its design must separately define how one approved source state produces and
publishes both active-major artifacts, including partial-failure recovery and
the order or release pointer used to switch multiple manifests.

D-012.6 still requires both majors to receive content from the same logical
source state during the 90-day window, but v1 must not implement an undocumented
best-effort sequence of two mutable manifest writes. This deferred v2 protocol
does not block implementing or publishing v1.

### D-013 — Admin UX and authorization

- Status: **Confirmed**
- Selected: **Curator-only explicit preview, immutable candidates, actionable
  findings, guarded publication, and private audit history**
- Confirmed: 2026-07-11
- Blocking: No

Confirmed UX summary:

- add a dedicated `VOD Export` page;
- restrict preview and publication actions to curators while keeping only the
  sanitized published artifact anonymous;
- display schema version, snapshot source, counts, validation warnings, and the
  currently published snapshot hash/time;
- publish the exact previewed snapshot bytes rather than running a second query;
- hide the navigation entry from contributors;
- allow a curator-only download of the exact candidate bytes for diagnostics.

The individual Admin behavior decisions below are normative.

#### D-013.1 — Dedicated Admin page

- Status: **Confirmed**
- Selected: **Add a dedicated `VOD Export` page**
- Confirmed: 2026-07-11

Decision: whether the Admin navigation gains a dedicated `VOD Export` page for
validation, preview metadata, and publication, instead of adding controls to an
existing Songs, Streams, or NOVA page.

Confirmed implication: validation state, candidate metadata, publication
controls, and current public-state information are colocated on one new page.
Existing Songs, Streams, NOVA, and legacy export interfaces remain unchanged.

#### D-013.2 — Admin authorization boundary

- Status: **Confirmed**
- Selected: **Curator-only page and management endpoints**
- Confirmed: 2026-07-11

Decision: whether the page plus all candidate-validation, preview, download,
and publication endpoints are curator-only, with navigation hidden from
contributors and server-side authorization returning a denial even if a
contributor calls an endpoint directly.

Confirmed implication: both UI routing and every management API enforce the
existing curator authorization boundary. Contributor navigation omits the page,
and direct unauthorized requests are denied without generating a candidate or
revealing private findings. Only the separately hosted sanitized snapshot and
manifest permit anonymous reads.

#### D-013.3 — Candidate-generation trigger

- Status: **Confirmed**
- Selected: **Explicit curator `Generate preview` action**
- Confirmed: 2026-07-11

Decision: whether opening the page automatically queries, validates, and
serializes the full candidate, or initially loads only current publication
status and requires an explicit curator action such as `Generate preview`.

Confirmed implication: initial page load retrieves only lightweight current
publication state. A full source read, validation pass, and serialization occur
only after an explicit curator action. Refreshing or revisiting the page does
not silently create a new candidate.

#### D-013.4 — Immutable server-side preview candidate

- Status: **Confirmed**
- Selected: **Privately store exact validated bytes by candidate ID and hash**
- Confirmed: 2026-07-11

Decision: whether `Generate preview` stores the exact serialized candidate bytes
privately on the server under an opaque candidate ID and hash, so later download
and publication use those same bytes instead of querying and serializing the
databases again.

Confirmed implication: validation runs before candidate creation. If
`canPublish` is false, Admin receives findings but no publishable candidate. If
true, the server stores immutable bytes, SHA-256, metadata, and an opaque
unguessable candidate ID in non-public storage. Download and publish read those
stored bytes; the client never supplies or replaces snapshot content.

#### D-013.5 — Unpublished candidate lifetime

- Status: **Confirmed**
- Selected: **Expire 24 hours after successful generation**
- Confirmed: 2026-07-11

Decision: how long an unpublished private candidate remains usable before it
expires and requires a fresh `Generate preview`. The confirmed lifetime is 24
hours from successful generation.

Confirmed implication: expired candidate IDs cannot be downloaded or
published, Admin clearly marks them expired, and a curator must generate and
review a fresh candidate. Expiration never affects a snapshot that was already
published. Private expired bytes may be removed asynchronously.

#### D-013.6 — Source change after preview

- Status: **Confirmed**
- Selected: **Any approved-source change detected by the ordered
  revision-vector fence invalidates the candidate**
- Confirmed: 2026-07-11

Decision: whether a still-unexpired candidate becomes stale and unpublishable
when the approved source state changes after its generation and the ordered
final revision-vector fence defined by D-016.3 detects that change.

Confirmed implication: publication rechecks the candidate's source fingerprint.
Any mismatch rejects publication without changing the public manifest and tells
the curator to generate a fresh preview. The 24-hour lifetime is only an upper
bound and never permits publishing a revision that fails the final fence. A
`DB` transaction after the fence's first matching read belongs to the next
publication. A `NOVA_DB` transaction between the first and second reads is
conservatively rejected; one after the second matching read belongs to the next
publication.

#### D-013.7 — Candidate content counts

- Status: **Confirmed**
- Selected: **Show exact `streamers`, `vods`, and `performances` counts**
- Confirmed: 2026-07-11

Decision: whether a successful preview displays exact exported counts named
`streamers`, `vods`, and `performances`, calculated after all approval,
eligibility, and empty-VOD rules are applied.

Confirmed implication: counts describe the exact candidate bytes, not raw D1
table totals. `performances` counts occurrences after the triple-approved
intersection; it is not a distinct-song count. The same count definitions are
reused by the D-014.10 manifest.

#### D-013.8 — Candidate hash and byte size display

- Status: **Confirmed**
- Selected: **Show full SHA-256 and exact uncompressed byte length**
- Confirmed: 2026-07-11

Decision: whether a successful preview visibly displays the candidate's full
lowercase SHA-256 and exact uncompressed UTF-8 byte length, allowing comparison
with the downloaded file and current published snapshot.

Confirmed implication: Admin displays all 64 lowercase hexadecimal hash
characters and provides a copy action. A shortened hash may be supplemental but
never the only identifier. Byte length refers to the exact uncompressed UTF-8
candidate bytes, not transfer-compressed size.

#### D-013.9 — Candidate generation and expiration times

- Status: **Confirmed**
- Selected: **Show exact UTC `generatedAt` and `expiresAt`**
- Confirmed: 2026-07-11

Decision: whether Admin displays both `generatedAt` and `expiresAt` for the
private candidate as exact UTC RFC 3339 timestamps, while optionally rendering
a localized relative time for convenience.

Confirmed implication: exact UTC timestamps are the authoritative display and
API values. Localized absolute or relative labels may supplement but never
replace them. These private candidate timestamps do not enter snapshot bytes
or affect snapshot hash identity.

#### D-013.10 — Finding repair navigation

- Status: **Confirmed**
- Selected: **Provide safe direct repair navigation for actionable findings**
- Confirmed: 2026-07-11

Decision: whether every finding with sufficient confirmed entity context or a
private source locator provides an `Open record` action to the relevant Admin
edit/detail view, while aggregate duplicate findings open a pre-filtered list
of all conflicting rows.

Confirmed implication: server-controlled routes resolve confirmed public
context or private locators; the client never converts arbitrary raw values
into navigation targets. Aggregate duplicate findings navigate to a safe
pre-filtered conflict list. A genuinely export-wide system finding without a
repairable row has no fake action.

#### D-013.11 — Finding groups and filters

- Status: **Confirmed**
- Selected: **Derived counts plus severity and streamer filters**
- Confirmed: 2026-07-11

Decision: whether Admin shows error and warning counts, errors before warnings,
and filters for severity and `streamerSlug`, while preserving the server's
deterministic finding order within the selected view.

Confirmed implication: counts are derived from the complete single `findings`
array. Errors are the default first group, warnings follow, and curator filters
may narrow by severity or valid streamer slug. Filtering never changes server
order, mutates findings, or hides total counts.

#### D-013.12 — Publish-button eligibility

- Status: **Confirmed**
- Selected: **Enable only for a current valid publishable candidate**
- Confirmed: 2026-07-11

Decision: whether `Publish` is enabled only for an existing candidate whose
server result has `canPublish: true`, has not expired, and still matches current
source state, with a specific disabled reason shown for every other state.

Confirmed implication: no candidate, blocking errors, expiration, stale source,
or an in-progress publication each disables the action with a distinct reason.
The server authoritatively repeats and enforces every eligibility check within
the publish request using D-016.3's ordered revision-vector fence and
conditional-write protocol. This is not a cross-D1/R2 transaction; the
conditional manifest write is the sole public commit point. UI state grants no
authority and cannot bypass validation.

#### D-013.13 — Publish confirmation dialog

- Status: **Confirmed**
- Selected: **Require a metadata-rich second confirmation action**
- Confirmed: 2026-07-11

Decision: whether clicking an enabled `Publish` first opens a confirmation
dialog that shows schema version, full candidate hash, content counts, warning
count, and the fact that the public manifest will advance, then requires a
second explicit `Publish snapshot` action.

Confirmed implication: the modal displays the exact candidate identity and
scope before any mutation. Closing it changes nothing. The second explicit
button authorizes only that candidate ID; typed confirmation text is not
required, and all server eligibility checks still apply afterward.

#### D-013.14 — Candidate already published

- Status: **Confirmed**
- Selected: **Treat identical current stable manifest identity as a no-op**
- Confirmed: 2026-07-11

Decision: when a valid candidate SHA-256 and the desired stable manifest
identity equal the current publication for that major, whether publication is a
no-op that leaves the manifest and timestamps unchanged instead of manufacturing
a new publication event. Stable identity comprises `schemaVersion`,
`snapshotUrl`, `sha256`, `uncompressedBytes`, and `counts`; it excludes
`publishedAt`.

Confirmed implication: Admin displays `Already published`; the candidate may
still be downloaded. No public snapshot object, public manifest, `publishedAt`,
or successful-publication audit event is created or changed. After the current
expiry, exporter-build, and revision-vector checks pass, the server updates a
private per-major source-equivalence checkpoint that records the current
manifest SHA-256 and candidate fingerprint: both database IDs and revisions,
`schemaVersion`, and exporter build ID. This checkpoint is control state, not a
publication event.

Equal content hash alone is insufficient. If D-017.3 changes the configured
snapshot hostname or path, the same immutable bytes require a real conditional
manifest advance with a new `publishedAt` and successful audit after the new URL
is proven to serve that exact object. That manifest-only advance need not create
another snapshot object, and its previous and candidate hashes may be equal.

#### D-013.15 — Current-publication status panel

- Status: **Confirmed**
- Selected: **Always show complete current-publication identity and scope**
- Confirmed: 2026-07-11

Decision: whether the page always shows the current major's schema version,
full snapshot hash, public snapshot URL, `publishedAt`, byte length, and three
confirmed content counts, or a clear `Never published` state.

Confirmed implication: the panel uses authoritative manifest data, provides
copy/open actions for hash and URL, and never invents zero values when no
publication exists. Its empty state is explicitly `Never published`.

#### D-013.16 — Candidate diagnostic download

- Status: **Confirmed**
- Selected: **Allow curator download of exact unexpired candidate bytes**
- Confirmed: 2026-07-11

Decision: whether a curator may download the exact unexpired private candidate
bytes using a deterministic hash-based filename, with no reserialization or
client-generated content.

Confirmed implication: the authenticated endpoint streams the server-stored
bytes and supplies the D-014 filename. Expired, missing, unauthorized, or
client-supplied content is rejected.

#### D-013.17 — Private publication audit record

- Status: **Confirmed**
- Selected: **Append a private record for every successful manifest advance**
- Confirmed: 2026-07-11

Decision: whether every successful manifest advance records the curator
identity, candidate and previous hashes, previous and new snapshot URLs, schema
version, counts, warning count, source revisions, and UTC publication time in
private Admin audit state.

Confirmed implication: audit records are authenticated-Admin-only and do not
contain snapshot bytes, raw invalid values, or findings. A stable-identity no-op
does not create an audit record under D-013.14. A durable private `prepared`
intent exists before manifest cutover and is finalized or reconciled afterward,
so a successful manifest advance cannot silently lose its audit evidence.

#### D-013.18 — Publication result and candidate cleanup

- Status: **Confirmed**
- Selected: **Refresh and clean up on success; preserve state on failure**
- Confirmed: 2026-07-11

Decision: successful manifest cutover refreshes the current-publication panel
and normally removes the now-redundant private candidate. It also initializes
the source-equivalence checkpoint for the committed manifest hash. Any failure
before manifest cutover leaves the public manifest unchanged and retains the
candidate. A failure finalizing audit, checkpoint, or cleanup after cutover is a
recoverable post-commit warning, not a rollback of the successful public
publication.

Confirmed implication: the conditional manifest write is the sole public commit
point. Pre-commit failures are safe to retry with the still-unexpired candidate.
Post-commit recovery reconciles the prepared audit intent, source-equivalence
checkpoint, and candidate cleanup against the authoritative manifest; messages
expose no secrets or unsafe source values.

#### D-013.19 — Publication audit retention and reconciliation

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: retain a successful audit record with curator identity
for at least two years and for as long as its snapshot is referenced by any
retained current or frozen manifest, whichever is longer. Once both conditions
end, remove curator identity and candidate ID while retaining the non-personal
technical record indefinitely for provenance and snapshot-retention decisions.

An unresolved `acquired` or `prepared` control-slot intent blocks another
publication until D-016.3 reconciliation safely resolves it. Alert Admin when
an intent is still unresolved after 15 minutes. Failed or no-op intent history
may be deleted 30 days after final resolution; a committed intent becomes the
successful audit record and follows the longer retention rule above. The fixed
per-major control slot and current source-equivalence checkpoint are operational
control state, not audit history, and remain outside candidate lifecycle rules.

### D-014 — Output formatting and filename

- Status: **Confirmed**
- Confirmed: 2026-07-11
- Blocking: No

Confirmed immutable public object key:

```text
vod/v1/snapshots/{sha256}.json
```

Confirmed manifest shape, shown expanded here for readability although its
published bytes are compact:

```json
{
  "schemaVersion": "1.0.0",
  "snapshotUrl": "https://data.oshi.tw/vod/v1/snapshots/{sha256}.json",
  "sha256": "{64-lowercase-hex}",
  "publishedAt": "2026-07-10T12:35:10.123Z",
  "uncompressedBytes": 1630280,
  "counts": {
    "streamers": 36,
    "vods": 554,
    "performances": 8534
  }
}
```

Confirmed hash rule: calculate SHA-256 over the deterministic, compact,
uncompressed UTF-8 JSON bytes. HTTP compression is transport-only and does not
change snapshot identity.

Formatting and artifact identity decisions are recorded below.

#### D-014.1 — Snapshot whitespace format

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: snapshot bytes use compact JSON with no indentation or unnecessary
whitespace outside JSON string values.

#### D-014.2 — Snapshot trailing newline

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: the final closing brace is the last byte, with no trailing newline or
other whitespace.

#### D-014.3 — Snapshot property order

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: every object type in this initial v1.0.0 contract uses the following
fixed explicit property order;
the exporter must not rely on database-column order, map iteration, or generic
serializer order:

- snapshot: `schemaVersion`, `streamers`;
- streamer: `slug`, `displayName`, `youtubeChannelId`, `avatarUrl`, `group`,
  `socialLinks`, `vods`;
- `socialLinks`: `youtube`, `twitter`, `facebook`, `instagram`, `twitch`, with
  absent providers omitted while preserving the relative order of emitted keys;
- VOD: `title`, `date`, `videoId`, `performances`;
- performance: `performanceId`, `songId`, `title`, `originalArtist`,
  `startSeconds`, `endSeconds`.

#### D-014.4 — Non-ASCII JSON characters

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: normalized Chinese, Japanese, and other non-ASCII characters are
emitted directly as UTF-8 rather than escaped as `\uXXXX`. JSON-required string
escaping and control-character escaping remain mandatory.

Canonical string escaping is exact: escape quotation mark and reverse solidus
as `\"` and `\\`; use the short escapes `\b`, `\t`, `\n`, `\f`, and `\r` for
those five control characters; encode every other U+0000–U+001F code point as
`\u00xx` with lowercase hexadecimal; and never escape `/`, `<`, `>`, `&`,
U+2028, or U+2029. Emit every other valid Unicode scalar value directly after
NFC normalization. Reject an unpaired UTF-16 surrogate as invalid source text
rather than replacing it or allowing serializer-dependent output.

Canonical JSON integers use ordinary base-10 digits with no leading plus sign,
leading zero, fractional part, exponent, or negative zero. All public numeric
values must first pass their non-negative JavaScript-safe-integer checks. The
implementation uses one tested canonical serializer for both hashing and
storage; generic HTML-safe or locale-sensitive serializers are forbidden.

#### D-014.5 — Snapshot hash, path, and download filename

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: calculate SHA-256 over the exact uncompressed snapshot bytes and
encode it as exactly 64 lowercase hexadecimal characters. Use that value in the
public path `/vod/v1/snapshots/{sha256}.json` and in the curator download
filename `vod-export-v1-{sha256}.json`.

Confirmed implication: semantically identical source data produces identical
snapshot bytes, hash, public path, and download filename. Any byte-level change,
including property ordering or escaping, produces a different snapshot identity.

#### D-014.6 — JSON response metadata

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: store both snapshot and manifest objects with
`Content-Type: application/json; charset=utf-8`. Do not set public-object
`Content-Disposition`, so the public URLs remain ordinary machine-readable
resources. The authenticated Admin download response separately sets
`Content-Disposition: attachment; filename="vod-export-v1-{sha256}.json"`.

The public consumer guide uses
`Content-Type: text/markdown; charset=utf-8`. Versioned public JSON Schemas use
`Content-Type: application/schema+json; charset=utf-8`. Neither documentation
artifact type has stored `Content-Encoding` or `Content-Disposition` metadata.

R2/Cloudflare may emit an HTTP `ETag` for cache validation, but that value is
transport metadata only. Consumers must not assume it equals the manifest's
canonical SHA-256.

#### D-014.7 — Stored bytes and transport compression

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: store the exact uncompressed JSON bytes in R2 and omit
R2 `Content-Encoding` metadata. Do not use `Cache-Control: no-transform`;
Cloudflare may select Brotli, gzip, Zstandard, or no transfer compression from
the client's `Accept-Encoding` support and the active zone configuration.

`sha256` and `uncompressedBytes` always describe the decoded, uncompressed
canonical JSON. A consumer verifies the hash after HTTP content decoding and
must not compare `Content-Length`, which can describe compressed bytes or be
absent, with `uncompressedBytes`.

#### D-014.8 — Cache policy and cache key

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: configure the R2 Custom Domain so only public `GET` and
`HEAD` requests under `/vod/` are cache eligible, including `.json` objects,
and exclude the query string from this prefix's cache key. Query parameters are
not a supported version or freshness mechanism.

Set the following object response metadata:

- immutable snapshot: `Cache-Control: public, max-age=31536000, immutable`;
- mutable manifest: `Cache-Control: public, max-age=60, stale-if-error=86400`;
- mutable consumer guide:
  `Cache-Control: public, max-age=3600, stale-if-error=86400`;
- versioned v1 baseline JSON Schemas:
  `Cache-Control: public, max-age=31536000, immutable`.

Enable Smart Tiered Cache for the R2 custom domain. A successful manifest
replacement can therefore become publicly visible up to 60 seconds after
publication under normal conditions. If R2 temporarily returns a qualifying
server error, Cloudflare may serve the last cached valid manifest for at most
one day; this can only reference an already-published immutable snapshot.

The Cache Rule controls only eligibility, allowed methods, and the query-free
cache key. Do not configure an Edge Cache TTL override for these paths; the
object `Cache-Control` metadata above remains authoritative so the manifest's
short TTL and `stale-if-error` behavior are preserved. Disable Cloudflare
Always Online for this data host/zone, and do not add `s-maxage`,
`must-revalidate`, or `proxy-revalidate` directives that would override or
forbid the confirmed stale-serving window.

#### D-014.9 — Manifest path and byte format

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: publish the mutable manifest at
`/vod/v1/manifest.json`. Serialize it with the same compact deterministic UTF-8
rules as the snapshot: no BOM, indentation, unnecessary whitespace, or trailing
newline. Publication writes the immutable snapshot first and replaces the
manifest only after every snapshot write and publication precondition succeeds.

#### D-014.10 — Manifest schema

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: use this exact initial v1.0.0 shape and property order:

```json
{"schemaVersion":"1.0.0","snapshotUrl":"https://data.oshi.tw/vod/v1/snapshots/{sha256}.json","sha256":"{64-lowercase-hex}","publishedAt":"2026-07-11T12:35:10.123Z","uncompressedBytes":1630280,"counts":{"streamers":36,"vods":554,"performances":8534}}
```

Rules:

- `snapshotUrl` is an absolute HTTPS URL on the configured R2 Custom Domain and
  its path must contain the exact adjacent `sha256` value;
- the manifest `schemaVersion` must exactly match the referenced snapshot's
  `schemaVersion`;
- `publishedAt` is the logical publication time defined by D-014.11, formatted
  in UTC as `YYYY-MM-DDTHH:mm:ss.SSSZ` with exactly three fractional digits;
- `uncompressedBytes` is the positive integer length of the canonical snapshot;
- every `counts` value is a non-negative integer calculated from that snapshot;
- omit candidate `generatedAt`; it is private Admin lifecycle metadata and is
  not part of the public artifact contract.

A future compatible v1 minor-version specification may add safely ignorable
properties only by defining their exact canonical order and advancing
`schemaVersion` under D-012.3.

#### D-014.11 — Exact `publishedAt` semantics

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: create `publishedAt` once, immediately before serializing
the manifest for its first conditional-write attempt, and persist that exact
manifest body and timestamp in the prepared publication intent. Every retry of
the same publication uses the identical manifest bytes.

The value becomes authoritative only if that conditional write is determined to
have committed. It is the logical publication timestamp just before cutover,
not an unknowable post-response completion time. The successful audit record
uses the same value. A stable-identity no-op never changes `publishedAt`.

### D-015 — Full snapshot versus incremental changes

- Status: **Confirmed**
- Selected: **C. Authoritative full snapshot in v1; optional versioned delta
  feed may be added later**
- Confirmed: 2026-07-10
- Blocking: No

#### What a complete snapshot means

Every published snapshot contains the entire D-004 scope at one logical point
in time: all included streamers, all included VODs, and every included song
occurrence. The new website treats a successfully validated snapshot as the
complete desired state and atomically replaces the previous version.

Example:

```text
Snapshot S1: VOD-A, VOD-B

Admin changes:
  - edit the title of VOD-A
  - unapprove VOD-B
  - approve VOD-C

Snapshot S2: VOD-A (new title), VOD-C
```

After importing S2, the new website removes VOD-B because its absence is
authoritative. It does not append S2 to S1.

The consumer must download and validate S2 completely before switching from
S1. A malformed or incomplete S2 leaves S1 active. On the publication side,
the immutable snapshot must be written successfully before the manifest is
updated, so a failed pre-commit publish cannot replace the last known-good feed.

#### What a complete snapshot does not mean

- It is generated once per publication, not once per visitor.
- It does not require a consumer to redownload unchanged bytes. The consumer can
  check a small manifest or use `ETag`/hash comparison first.
- It does not prevent long-lived CDN and consumer caching. A content-addressed
  snapshot URL is immutable and can be cached aggressively.
- It does not require retaining every historical snapshot forever. D-017.2
  defines retention separately from import semantics.
- It does not make publication automatic; D-019 requires explicit curator
  publication.

#### How an incremental feed differs

An incremental feed sends only changes after an ordered cursor. A future,
separately versioned delta contract would need to define unambiguous identities
for both upserts and removals; v1 intentionally does not invent those
identities.

This requires more than filtering on `updated_at`. It needs:

- a monotonic change cursor and total event ordering;
- deletion and unapproval tombstones;
- retention rules for events and recovery when a consumer falls behind;
- idempotent replay and retry behavior;
- rules for schema changes and out-of-order delivery;
- a periodic full snapshot for bootstrap and disaster recovery anyway.

The current admin database has no change log or tombstones. A deleted or
unapproved record simply disappears from an approved-row query. Therefore a
`since={timestamp}` implementation could tell the consumer about additions and
edits but could silently fail to tell it what to remove.

#### Options reviewed

- **A. Complete replacement snapshot for v1** — recommended. The manifest/hash
  prevents unnecessary downloads, and the current compact payload is only
  about 1.56 MiB before transport compression in the current prototype.
- **B. Build a safe incremental protocol now** — requires new persistent change
  tracking, tombstones, cursor semantics, recovery rules, and substantially
  more implementation and operations work.
- **C. Full snapshot is authoritative in v1; a separately versioned optional
  delta feed may be added later** — operationally the same v1 decision as A,
  but records the likely future direction.

Confirmed implication: every v1 publication is a complete replacement for the
entire D-004 scope. The consumer validates the candidate completely and then
switches atomically; absence means removal. No `since`, cursor, event, patch,
or tombstone API is part of v1.

### D-016 — Cross-table snapshot consistency

- Status: **Confirmed**
- Confirmed: 2026-07-11
- Blocking: No

The current legacy exporter runs separate queries for songs, performances, and
VODs. A curator action between those queries can create a mixed-time result.
The confirmed exporter instead requires a consistent read or a bounded retry
when cross-table state changes; it must never present a mixed result as strongly
consistent.

Streamer profiles come from `NOVA_DB`, while VOD/song data comes from `DB`.
There is no cross-D1 atomic transaction. The confirmed design maintains a
source revision in each database, reads each database transactionally, and
rechecks both revisions after serialization and before publication. Any change
observed by the applicable ordered fence invalidates that attempt or candidate
rather than allowing a mixed result.

#### D-016.1 — Export-source revisions

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: add one singleton `vod_export_state` row to each of `DB`
and `NOVA_DB`, containing a signed 64-bit monotonic `revision` plus an integer
`trigger_schema_version`. Return revisions to TypeScript as decimal strings
rather than JavaScript numbers.

Database triggers increment the revision in the same transaction as every
insert, delete, or update that can affect export eligibility, validation, public
bytes, or public identity:

- `DB.streams`: `id`, `streamer_id`, `title`, `date`, `video_id`, `status`;
- `DB.songs`: `id`, `streamer_id`, `title`, `original_artist`, `status`;
- `DB.performances`: `id`, `streamer_id`, `song_id`, `stream_id`, `timestamp`,
  `end_timestamp`, `status`;
- `NOVA_DB.submissions`: `id`, `slug`, `display_name`, `youtube_channel_id`,
  `avatar_url`, `link_youtube`, `link_twitter`, `link_facebook`,
  `link_instagram`, `link_twitch`, `group`, `enabled`, and `status`;
- every field in the persisted YouTube-channel verification state introduced by
  D-010.23.

The lists above are the exact initial v1 allowlist. In particular,
`performances.date`, `stream_title`, and `video_id`; `songs.tags`;
`streams.youtube_url` and `credit`; and NOVA subscriber count, description,
theme, reviewer notes, and display order do not invalidate a candidate. Schema
migrations must update the trigger definitions and increment
`trigger_schema_version` whenever an export-relevant source changes.
Generation and publication startup require both state rows, the exact expected
schema version, and all required triggers; a missing or mismatched guard is an
operation-level configuration failure, never a best-effort export.

Do not derive the revision from `updated_at`, row counts, or maximum timestamps:
those approaches can miss deletes, same-second edits, and change-then-revert
sequences.

#### D-016.2 — Consistent generation and bounded retry

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: one generation attempt performs these steps:

1. Open a `first-primary` D1 session for each database.
2. In one read-only transactional `batch()` per database, read its starting
   export revision and every source row needed from that database. The two
   database batches may run in parallel.
3. Assemble, validate, normalize, order, serialize, and hash the complete
   candidate.
4. Through fresh `first-primary` sessions, read both revisions again.
5. Store a candidate only if both ending revisions equal their starting values.

The private candidate fingerprint contains both D1 database IDs, both decimal
revision strings, `schemaVersion`, and the deployment ID from a required
Workers Version Metadata binding as its exporter build ID. A deployment that
changes export or validation logic therefore makes an older candidate stale;
tests and local development use an explicit deterministic test build ID rather
than omitting the field.

On a revision mismatch, discard all bytes and findings from that attempt and
rerun the complete process. Allow three total attempts, waiting approximately
100 ms and 300 ms plus 0–100 ms random jitter before attempts two and three.
After the third conflict, create no candidate and return the operation-level
`SOURCE_CHANGED_DURING_GENERATION` response with HTTP 409. This is not a D-010
data-validation finding.

#### D-016.3 — Publication cutover, conditional writes, and recovery

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: on entry to publication, repeat the candidate expiry, exporter-build,
and both revision checks against fresh primary reads. After manifest inspection
and any required snapshot preparation, repeat them through an ordered final
fence: first read `DB`, then read `NOVA_DB`, each through a fresh `first-primary`
session, and require both to equal the candidate fingerprint.

Because the databases cannot share a transaction, this is a two-component
revision-vector fence, not a simultaneous cross-D1 transaction. The successful
`DB` read is the logical cutover point. The later matching `NOVA_DB` read proves
that NOVA's candidate state remained unchanged across that point. A `DB`
transaction committed after the first read belongs to the next publication. A
`NOVA_DB` change after that point but before its final read is conservatively
detected and rejects this publication; a NOVA change after its final read
belongs to the next publication. v1 never blocks ordinary curator writes with a
distributed cross-database mutex.

Single-writer acquisition uses the fixed private-R2 control key
`publication-control/v1.json`, which is excluded from candidate lifecycle
rules. The slot is always `idle`, `acquired`, or `prepared`. Transition a
missing slot to `acquired` with `If-None-Match: *`, or an `idle` slot to
`acquired` conditionally against its current R2 ETag. Every transition carries
an opaque `intentId`, uses the immediately prior ETag, and preserves the prior
source-equivalence checkpoint until replacement is authorized. Never
unconditionally overwrite or delete this key.

A failed slot precondition starts no publication: reread and reconcile, or
return operation-level `PUBLICATION_IN_PROGRESS`. An unresolved `acquired` or
`prepared` owner blocks another publisher. Before the public manifest write,
the owner must conditionally transition its own `acquired` state to `prepared`
and persist the exact manifest bytes and recovery fields. After the successful
audit record and source-equivalence checkpoint are durable, conditionally
transition that same intent to an identity-free `idle` state. Ambiguous slot
writes are resolved by rereading state and matching `intentId`; an old owner can
never overwrite a newer ETag.

Publication then follows this order:

1. Repeat the entry checks, acquire or reconcile the control slot, then read the
   current manifest through the direct R2 binding. Never read control state
   through CDN. If a manifest exists, validate its required and forbidden
   D-014.6–D-014.8 R2 HTTP metadata, complete D-014.10 schema, URL/hash
   agreement, counts, byte length, and referenced snapshot object's exact
   SHA-256 and required/forbidden HTTP metadata before treating it as
   authoritative. Retain its exact bytes, hash, and ETag as the expected prior
   state.
2. If the current manifest hash differs from the candidate hash, create the
   immutable snapshot with `If-None-Match: *` and an R2 SHA-256 checksum. If the
   key exists, verify its exact byte length, SHA-256, and required/forbidden
   D-014.6–D-014.8 HTTP metadata before reuse; never overwrite it. A mismatch is
   an operation-level public-artifact state failure and the object must not be
   referenced. If the hashes match, do not create or rewrite an object yet.
3. Repeat expiry and exporter-build checks, then execute the ordered `DB` →
   `NOVA_DB` final revision fence above. Any mismatch restores or reconciles the
   slot without changing public state and returns the stale-candidate result.
4. If the fully validated current manifest already has the complete desired
   stable identity from D-013.14—including the configured `snapshotUrl`—update
   the private source-equivalence checkpoint, conditionally return the slot to
   `idle`, and return the no-op. This path occurs only after the final fence and
   never changes public bytes or successful-publication audit history. A hash
   match with a different desired URL continues to step 5 as a manifest-only
   advance after D-017.3's hostname checks pass.
5. Otherwise generate the one D-014.11 `publishedAt`, serialize the exact
   manifest bytes, and conditionally transition the slot from `acquired` to
   `prepared`. The prepared state contains the D-013.17 audit fields, source
   fingerprint, candidate ID and hash, expected previous manifest hash/ETag,
   curator identity, and those exact bytes.
6. Immediately replace the manifest conditionally against the retained prior
   ETag; first publication uses `If-None-Match: *`. Treat the successful
   conditional write as the sole public commit point.
7. Finalize the successful audit record and source-equivalence checkpoint,
   delete the private candidate, then conditionally return the same control-slot
   intent to `idle` without curator identity.

If a manifest conditional write loses a race, reread the manifest. Exact
byte-for-byte equality with the prepared manifest proves this intent committed
and requires successful post-commit finalization. The same desired stable
identity with only a different `publishedAt` means another intent completed the
equivalent advance; it is not proof that this intent succeeded, so reconcile
this intent as a no-op. A matching hash with a different stable identity, or a
different hash, returns `PUBLICATION_CONFLICT` and retains the candidate.

After an ambiguous timeout, 429, or 5xx, reread before retrying. Retry only when
the manifest still has the exact expected prior ETag and the slot still has the
same `prepared` intent; perform at most three manifest attempts at least one
second apart and reuse identical bytes. Never blindly overwrite a newer ETag or
clear an unresolved owner merely because time elapsed. Alert after 15 minutes
under D-013.19, and keep publication blocked until direct-state reconciliation
can classify the exact prepared bytes as committed, not committed, or still
ambiguous.

This explicitly narrows D-013.18: every failure **before** the manifest commit
leaves the public manifest unchanged. Failure to finalize audit, checkpoint, or
candidate cleanup **after** a successful conditional write does not roll back
public success; Admin reports a cleanup warning and reconciliation completes it
later.

### D-017 — Public artifact hosting and CDN path

- Status: **Confirmed**
- Selected: **A. R2 Custom Domain + Cache Rules**
- Confirmed: 2026-07-10
- Blocking: No

Options:

- **A. R2 Custom Domain + Cache Rules** — recommended. Admin writes the object;
  public reads go through CDN without invoking a dynamic Worker.
- **B. Workers static assets** — public asset requests are currently free and
  unlimited, but updating the feed normally requires building and deploying a
  new asset version rather than publishing directly from Admin.
- **C. Dynamic Worker endpoint + cache** — simplest routing integration, but
  Worker cache hits still count as Worker requests and a cache miss may execute
  export logic unless the result is separately persisted.

JSON is not cached by Cloudflare CDN by default. Any R2 Custom Domain design
must include an explicit cache-eligibility rule for the feed paths.

Confirmed implication: publication writes immutable snapshot objects and a
small mutable manifest to R2; anonymous reads use the R2 Custom Domain and CDN,
not a dynamic Worker endpoint. D-014 defines cache and query handling, D-016.3
defines concurrent publication safeguards, and D-017.1 through D-017.2 define
bucket isolation and retention.

#### Non-normative cost estimate — 2026-07-11

This estimate is planning information rather than a stable export-contract
requirement. It assumes R2 Standard storage, the current approximately
1,630,280-byte snapshot, and Cloudflare's published monthly free allowance of
10 GB-month, one million Class A operations, ten million Class B operations,
and free R2 Internet egress. Current paid rates after the allowance are
US$0.015/GB-month, US$4.50/million Class A operations, and
US$0.36/million Class B operations. See the
[authoritative R2 pricing page](https://developers.cloudflare.com/r2/pricing/)
before implementation or budgeting.

At one changed-content publication per day, retaining every snapshot adds
approximately 0.595 GB per year. Candidate creation, control-slot acquisition,
snapshot creation, prepared-state persistence, manifest replacement, and the
return to idle produce approximately 180 baseline R2 object writes per month;
recovery and previews that are not published add a small variable amount. Both
storage and writes remain within the current free allowance. A continuously
requested manifest with a 60-second TTL produces a baseline of approximately
43,200 monthly upper-tier revalidations before cache eviction and exceptional
refills, also far below the Class B allowance.

Cloudflare cache hits do not read R2, Smart Tiered Cache reduces origin fills,
and public reads do not invoke a Worker under D-017. Consequently the expected
incremental **R2 usage** charge at the present scale is US$0/month. D-020.1
separately requires Workers Paid: it adds the current US$5 account minimum only
if that plan is not already active. Estimates exclude an existing paid
Cloudflare zone plan, domain registration, taxes, optional products such as
Cache Reserve or Argo, and unrelated application usage.

#### D-017.1 — Bucket and hostname isolation

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: use `https://data.oshi.tw` as the production R2 Custom
Domain and two separate R2 Standard buckets:

- physical bucket `prism-vod-export-public`, bound to the Admin Worker as
  `VOD_EXPORT_PUBLIC`, contains `vod/v*/manifest.json`, sanitized immutable
  `vod/v*/snapshots/*` objects, public `vod/v*/guide.md` documents, and
  versioned major-compatible baseline `vod/v*/schemas/*` JSON Schemas, and is
  the only bucket attached to the hostname;
- physical bucket `prism-vod-export-private`, bound as `VOD_EXPORT_PRIVATE`,
  contains unpublished candidate bytes and publication recovery/control records
  and is reachable only through the authenticated Admin Worker binding.

The uppercase identifiers are Worker binding names, not physical R2 bucket
names. Environment suffixes, when needed, must preserve R2's lowercase-letter,
digit, and hyphen naming rule.

A fully validated sanitized snapshot may be created in the public bucket
immediately before manifest cutover so the manifest can never reference a
missing object. It is unreferenced, and therefore not the current publication,
until the manifest commit succeeds. Unvalidated bytes, private candidates,
findings, audit identities, and recovery state never enter the public bucket.

Disable `r2.dev` for both buckets. Configure no public CORS policy because D-018
selects server/build consumption. Only the Admin Worker binding writes data
publication paths (`vod/v*/manifest.json` and `vod/v*/snapshots/*`). The
reviewed source-controlled documentation release tool confirmed in D-017.4 is
operationally constrained to its fixed `vod/v*/guide.md` and
`vod/v*/schemas/*` allowlist, but its R2 credential is bucket-scoped because R2
does not provide key-scoped write credentials. It must never write a manifest
or snapshot. Private candidates, findings, audit identities, recovery state,
and other private data must never be placed under the public custom domain.

#### D-017.2 — Snapshot and candidate retention

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: retain every snapshot referenced by any current or frozen
major-version manifest until that major is explicitly retired. After a snapshot
is no longer referenced by any retained manifest, keep it for at least 400
additional days before it becomes eligible for deletion. This exceeds the
one-year immutable client-cache lifetime with operational margin.

Apply a 400-day R2 bucket lock to each public snapshot prefix as protection
against early overwrite or deletion. That lock is measured from object upload
and is only a minimum guard; it does not implement the separate 400-day window
after a snapshot becomes unreferenced. Do not apply a simple age-only deletion
lifecycle because it could delete an old snapshot that is still current.

Only a retained current or frozen manifest pins a snapshot. Private audit
history does not itself constitute a reference; it records the latest
`unreferencedAt` used by the maintenance policy. Clear `unreferencedAt` whenever
a manifest references the snapshot again, and start a new 400-day interval if
it later becomes unreferenced again. A maintenance job may delete only after no
retained manifest references the object, the recorded interval has elapsed,
and the bucket lock permits deletion. Alert for policy review at 8 GB of public
snapshot storage.

For a sanitized snapshot created before the final fence or manifest CAS but
never referenced by any manifest, initialize `unreferencedAt` from its R2 upload
time. It therefore enters the same 400-day maintenance window even though no
successful publication audit exists.

Private candidates remain logically unusable after the confirmed 24 hours.
Successful publication deletes them immediately; a two-day lifecycle scoped
only to the private candidate-object prefix is a physical cleanup backstop.
Prepared recovery records and committed audit history follow the Admin
audit-retention policy rather than the candidate lifecycle.

#### D-017.3 — Public-hostname migration

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: because manifests contain absolute `snapshotUrl` values,
any successor to `data.oshi.tw` must be fully serving and cache-tested before a
manifest begins referencing it. Keep each previous hostname serving the exact
same immutable paths until every retained manifest that names it has been
retired, then for the additional 400-day unreferenced-snapshot window.

During that period, attach the previous hostname to the same public objects or
provide an equivalent path-preserving origin. A redirect alone is not the
availability guarantee because a non-browser consumer may not follow it. Never
reuse a retired export hostname for incompatible content.

#### D-017.4 — Public consumer guide and schemas

- Status: **Confirmed**
- Selected: **Source-controlled Markdown guide and v1-compatible Draft 2020-12
  JSON Schemas under `/vod/v1/`, released independently from VOD data**
- Confirmed: 2026-07-12

Decision: publish these three consumer artifacts without adding `llms.txt` in
this release:

```text
/vod/v1/guide.md
/vod/v1/schemas/1.0.0/manifest.schema.json
/vod/v1/schemas/1.0.0/snapshot.schema.json
```

The repository's `docs/vod-export-consumer-guide.md` is the single source for
the public guide. The two schemas use JSON Schema Draft 2020-12, identify their
public URLs with `$id`, require every current v1 field, and deliberately allow
unknown properties so a consumer following D-012.3 does not reject a safely
additive v1 minor version. They are versioned v1-compatible baseline schemas,
not validators restricted to the literal `1.0.0` value in their URL. Their
versioned object keys are create-only: an indefinite R2 bucket lock on
`vod/v1/schemas/` prevents deleting or overwriting existing objects, including
under concurrent release attempts. If published bytes differ, release a new
schema path rather than removing the lock or overwriting an immutable object.

JSON Schema covers structure, required properties, primitive constraints,
nullability, manifest URL and date/time formats, HTTPS prefixes for snapshot
profile URLs, and local collection limits. It does not replace the guide or
this normative specification. Consumers still perform complete WHATWG URL
parsing and enforce trusted-origin and provider-host allowlists, adjacent
URL/hash agreement, decoded byte length and SHA-256, manifest/snapshot version
and count agreement, aggregate limits, identity uniqueness, deterministic
ordering, valid Unicode/NFC, canonical bytes, and `endSeconds > startSeconds`.

Documentation release is an explicit maintainer operation using the fixed
source/key/content-type/cache-control allowlist in the repository. It validates
locally, publishes immutable schemas first and the mutable guide last, reads
the exact R2 bytes back, and verifies all three public URLs plus the current
manifest/snapshot. It is not part of candidate generation or manifest CAS,
does not create publication audit state, and cannot make Admin edits public.
Ordinary CI validates these sources but holds no production R2 credential;
publication remains a manual reviewed command.

### D-018 — New-website consumption mode

- Status: **Confirmed**
- Selected: **A. Build/server-side fetch**
- Confirmed: 2026-07-10
- Blocking: No

Options:

- **A. Build/server-side fetch** — the new site fetches the public snapshot
  during build or server refresh; browsers do not request it directly.
- **B. Browser fetch** — each browser checks the manifest and may download the
  snapshot; requires an explicit public CORS policy.
- **C. Support both** — requires the browser-facing requirements of B.

This choice affects CORS, browser cache headers, payload-loading UX, and the
number of edge requests, but not the normalized data contract itself.

Confirmed implication: v1 does not require browser CORS support or direct
browser consumption. The new website's build/server process checks the public
manifest and downloads a snapshot only when the hash changes; site visitors do
not fetch the complete export feed themselves.

### D-019 — Publication trigger

- Status: **Confirmed**
- Selected: **A. Explicit curator Preview + Publish action in Admin**
- Confirmed: 2026-07-11
- Blocking: No

Options:

- **A. Explicit curator Preview + Publish action in Admin** — recommended for
  controlled releases and actionable validation errors.
- **B. Automatically publish after every approval/edit affecting approved
  data** — freshest, but creates more versions and couples every mutation to
  export availability.
- **C. Scheduled publication** — predictable cadence, but approved Admin data
  can remain unpublished until the next run.
- **D. Manual publication plus a scheduled safety publication**.

Decision: select **A**. Only a curator's explicit `Generate preview`
followed by confirmation and `Publish` can advance the public manifest. Edits,
approvals, deployments, cron triggers, and candidate generation never publish
automatically.

Admin compares the latest complete source fingerprint with the private
source-equivalence checkpoint for the current manifest hash. A successful
manifest advance initializes that checkpoint; a fully revalidated
stable-identity no-op advances it without changing public state or publication
audit history.
A missing or mismatched checkpoint shows `Changes not published`. The page does
not claim which records changed until a new preview validates them. v1 adds no
scheduled safety publish or email/webhook reminder.

Publishing or updating D-017.4 consumer documentation is not a VOD data
publication. It never advances the manifest, changes `publishedAt`, satisfies a
source-equivalence checkpoint, or changes the Admin page's publication status.

### D-020 — Worker execution and export resource bounds

- Status: **Confirmed**
- Confirmed: 2026-07-11
- Blocking: No

#### D-020.1 — Admin Worker execution plan

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: run candidate generation and publication on the Workers
Paid Standard plan and explicitly set the Admin Worker's per-invocation CPU
limit to 30,000 ms. Public snapshot and manifest reads continue to bypass the
Worker under D-017 and therefore do not consume Worker requests.

The current Workers Free limit is 10 ms CPU per invocation and cannot be treated
as a reliable budget for complete validation, sorting, canonical serialization,
and SHA-256 over the current dataset. If the account is not already on Workers
Paid, this requirement currently adds the platform's US$5 minimum monthly
charge; actual curator-only usage is expected to remain inside its included
request and CPU allowance.

#### D-020.2 — Candidate count and byte limits

- Status: **Confirmed**
- Confirmed: 2026-07-11

Decision: apply all of these hard v1 limits:

- at most 150,000 content rows loaded across `streams`, `songs`, and
  `performances`, including approved rows plus referenced parent rows needed to
  distinguish a missing relationship from an existing ineligible parent,
  before loading their complete contents;
- at most 500 emitted streamers;
- at most 10,000 emitted VODs;
- at most 50,000 emitted performances;
- at most 10,485,760 exact uncompressed canonical snapshot bytes (10 MiB).

At 80% of any limit, show a private operation-level Admin capacity indicator
derived only from safe numeric actual/limit values. It is not a D-010 finding,
does not enter `findings`, and does not affect `canPublish`. Exceeding any limit
returns operation-level `EXPORT_LIMIT_EXCEEDED` with HTTP 422 and the same safe
numeric diagnostics, stores no candidate, and leaves publication unchanged.
Never truncate, sample, or silently split the feed. Raising a limit requires
memory/CPU testing; changing from one file requires revisiting D-004 and the
consumer contract.

#### D-020.3 — Worker memory guard for source data and findings

- Status: **Confirmed**
- Selected: **A. Bounded synchronous v1**
- Confirmed: 2026-07-11
- Blocking: No

Decision: D-020.2's row and output-byte limits do not by themselves bound
Worker memory. A D1 row can contain large text, JavaScript objects add overhead,
and a severely invalid source can create many private findings before any
10 MiB public snapshot exists. Select one explicit v1 execution model.

- **A. Bounded synchronous v1 — selected.** Keep the confirmed one-request
  preview flow and add all of these limits: at most 16,777,216 aggregate UTF-8
  bytes (16 MiB) across export-relevant source text selected by D-016.1; at most
  5,000 D-010 findings; and at most 4,194,304 compact UTF-8 bytes (4 MiB) for the
  complete private findings response. Preflight the source-byte total before
  loading complete rows and stop finding accumulation as soon as either finding
  limit would be crossed. Because Cloudflare's 128 MB limit is per isolate and
  one isolate may serve concurrent requests, protect the heavy source-loading
  section with the fixed private-R2 key `generation-control/v1.json`. Acquire a
  missing key with `If-None-Match: *` or transition its identity-free `idle`
  state to `acquired` with an ETag CAS and opaque `generationId`. Only the owner
  may load source rows; another preview returns operation-level
  `EXPORT_GENERATION_IN_PROGRESS` with HTTP 409. Release back to `idle` with a
  final ETag CAS on every completed success/failure path, resolve ambiguous
  writes by rereading `generationId`, and never keep request-scoped state in a
  module variable. An unresolved owner blocks another heavy generation and
  alerts after 15 minutes; it is not stolen merely because time elapsed. This
  control key is excluded from candidate lifecycle rules. Crossing any capacity
  limit returns operation-level
  `EXPORT_LIMIT_EXCEEDED` with HTTP 422 and safe numeric actual/limit values,
  creates no candidate, returns no misleading partial `findings` array, and
  leaves publication unchanged. Show the D-020.2 capacity indicator at 80%.
  Before launch, a simultaneous-limit stress test must remain at or below
  96 MiB peak isolate memory and 30 seconds CPU; failure returns this decision
  for review rather than silently lowering a confirmed limit. This option does
  not change the expected monthly platform cost.
- **B. Persistent asynchronous validation job.** Replace one-request preview
  generation with paged source reads, durable intermediate state, and paginated
  complete findings. This can support a much larger invalid dataset but adds a
  job state machine, cancellation, progress, retry, expiry, and cleanup rules,
  plus additional storage/operation usage. Exact job semantics and limits would
  require a new design round before v1 implementation.

Confirmed implication: the selected Option A preserves the 10 MiB public
snapshot ceiling and never publishes partial data. “Complete findings” is
conditional on the explicit private diagnostic capacity limits; exceeding one
returns only the operation-level capacity failure defined above.

## 6. Compatibility requirements

The implementation must:

1. leave `/api/export/songs` and `/api/export/streams` backward compatible;
2. never export submitter/reviewer email addresses or review notes in v1;
3. never use title plus artist or an ID prefix as a uniqueness rule; enforce
   the identities and scopes defined by D-007 and D-010;
4. treat all IDs as opaque strings and enforce their documented global or
   streamer-scoped identity;
5. get VOD title, date, and video ID from the canonical VOD row and derive any
   consumer watch URL from that video ID rather than exporting a duplicate URL;
6. enforce the deterministic ordering and tie-breakers in D-011;
7. exclude `tags` and `credit` completely without parsing or exposing them;
8. enforce every D-020 source-count, source-byte, output-count, findings, and
   canonical-byte limit;
9. never treat a YouTube video ID as a globally unique VOD key across
   streamers;
10. enforce the D-016 transactional-read, revision, retry, and publication
    cutover rules.

## 7. Required verification

Implementation must include tests for at least:

- exact snapshot and manifest schemas, property order, version, encoding,
  compact bytes, absence of a trailing newline, byte count, and SHA-256;
- deterministic streamer, VOD, performance, and finding ordering;
- approved/pending/rejected combinations across all three content tables, plus
  the approved-and-enabled streamer gate;
- zero-song VOD omission and retention of an approved, enabled streamer with
  `vods: []`;
- missing relationships, streamer mismatches, duplicate streamer slugs,
  duplicate verified channel bindings, duplicate streamer-scoped VOD video
  IDs, and the complete D-010 finding-code catalog and precedence;
- legal duplicate streamer display names and repeated performances of the same
  song in one VOD;
- missing required end time and invalid timestamp ranges;
- canonical VOD fields winning over repeated performance fields;
- Unicode and URL normalization rules;
- null and omission rules for every optional field;
- source revision triggers, transactional reads, three-attempt generation,
  candidate staleness, and exporter-build invalidation;
- create-only snapshot writes, existing-object checksum verification, manifest
  ETag races, ambiguous-write recovery, prepared-intent reconciliation, and
  the pre-commit/post-commit boundary;
- curator/contributor authorization and manual-only publication behavior;
- legacy endpoint regression coverage;
- excluded fields—including tags, credit, notes, description, subscriber count,
  theme, and display order—are neither parsed nor exported and do not advance
  an export-source revision;
- filename, MIME type, cache metadata, compressed-transfer hash verification,
  and exact downloaded bytes;
- 80% capacity indicators and every D-020 hard limit without truncation or
  partial publication, including the 16 MiB source, 5,000-finding, and 4 MiB
  private-response guards plus the 96 MiB peak-memory stress gate;
- concurrent preview requests across isolates permit only the private-R2 CAS
  owner to enter heavy generation; every completed path conditionally returns
  the generation control slot to `idle` without global request state.

## 8. Confirmation history

- 2026-07-11 — The product owner granted final approval to the complete
  reconciled v1 specification after all 149 atomic decisions were confirmed.
- 2026-07-10 — D-001 selected C: public sanitized artifact/feed.
- 2026-07-10 — D-002 selected A: current approved Admin `DB` and `NOVA_DB`
  state.
- 2026-07-10 — D-003 selected A: VOD-oriented nesting.
- 2026-07-10 — D-004 selected A: one JSON data file containing every approved,
  enabled streamer.
- 2026-07-10 — D-015 selected C: authoritative full replacement snapshot in
  v1; optional separately versioned delta feed may be added later.
- 2026-07-10 — D-017 selected A: R2 Custom Domain + Cache Rules.
- 2026-07-10 — D-018 selected A: build/server-side consumption.
- 2026-07-10 — D-005.1 selected A: export a song occurrence only when its VOD,
  performance, and song are all approved and belong to the same streamer.
- 2026-07-10 — D-005.2 selected B: omit a VOD unless it contains at least one
  song occurrence eligible under D-005.1; never emit an empty `performances`
  array.
- 2026-07-10 — D-005.3 selected A: broken approved relationships block the
  complete publication and leave the last valid public snapshot active.
- 2026-07-10 — D-005.4 selected A: retain every approved, enabled streamer and use
  `vods: []` when it has no eligible VODs.
- 2026-07-10 — D-006.1 selected B: include `slug`, `displayName`, and
  `youtubeChannelId`; keep internal NOVA submission IDs private.
- 2026-07-10 — D-006.2a confirmed: include the approved `avatarUrl` string;
  image bytes are not part of the snapshot.
- 2026-07-10 — D-006.2b confirmed: exclude `description` from the v1 schema to
  avoid churn from frequently edited profile prose.
- 2026-07-10 — D-006.2c confirmed: exclude `brandName`; use `slug` for identity
  and `displayName` for presentation.
- 2026-07-10 — D-006.2d confirmed: include `group` as non-normalized display
  metadata, not as a stable affiliation identity.
- 2026-07-10 — D-006.3a confirmed: include sanitized `socialLinks` restricted
  to the fixed supported provider keys.
- 2026-07-10 — D-006.3b confirmed: exclude the current-site navigation
  override `externalUrl`.
- 2026-07-10 — D-006.4a confirmed: exclude the formatted, volatile
  `subscriberCount` from the VOD snapshot.
- 2026-07-10 — D-006.4b confirmed: exclude current-site `theme` tokens from
  the content feed.
- 2026-07-10 — D-006.4c confirmed: exclude redundant `enabled`; snapshot
  membership itself represents the enabled state.
- 2026-07-10 — D-007.1 confirmed: exclude the Admin VOD `id`; use `videoId` for
  the YouTube resource and `(streamer.slug, videoId)` for scoped VOD identity.
- 2026-07-10 — D-007.2 confirmed: include the curator-approved VOD `title` from
  the canonical Admin stream row.
- 2026-07-10 — D-007.3 confirmed: include the canonical VOD `date` as a
  date-only `YYYY-MM-DD` value.
- 2026-07-10 — D-007.5 confirmed: exclude redundant `youtubeUrl`; consumers
  derive the canonical watch URL from `videoId`.
- 2026-07-10 — D-007.6 confirmed: exclude the complete song-list `credit`
  object and all of its members.
- 2026-07-10 — D-007.7 confirmed: include opaque `performanceId` as the stable
  identity of each individual song occurrence.
- 2026-07-10 — D-007.8 confirmed: include opaque `songId` to relate
  occurrences attached to the same current curated Admin song row.
- 2026-07-10 — D-007.9 confirmed: include the canonical curator-approved song
  `title` on every occurrence.
- 2026-07-10 — D-007.10 confirmed: include the canonical curator-approved
  nullable `originalArtist` display value on every occurrence.
- 2026-07-10 — D-007.11 confirmed: exclude unpopulated, free-form `tags` from
  v1; any normalized tag vocabulary requires a separate future contract.
- 2026-07-10 — D-007.12 confirmed: include required integer `startSeconds`
  measured from the beginning of the YouTube video.
- 2026-07-10 — D-007.13 confirmed: include `endSeconds`; do not infer or
  silently correct invalid ranges.
- 2026-07-10 — D-007.14 confirmed: exclude unpopulated free-text `note` from
  v1; any public annotation requires a separate future contract.
- 2026-07-10 — D-007.15 confirmed: exclude `thumbnailUrl`; consumers derive or
  fetch thumbnails from `videoId` during their own build.
- 2026-07-10 — D-007.16 confirmed: exclude timestamped watch URLs; consumers
  derive them from `videoId` and `startSeconds`.
- 2026-07-10 — D-007.17 confirmed: exclude derived `durationSeconds`;
  consumers calculate it from valid start/end offsets.
- 2026-07-10 — D-007.18 confirmed: exclude redundant `position`; deterministic
  array order represents display order.
- 2026-07-10 — D-007.19 confirmed: exclude album-art metadata from the core VOD
  snapshot.
- 2026-07-10 — D-007.20 confirmed: exclude all iTunes identifiers from the core
  VOD snapshot.
- 2026-07-10 — D-007.21 confirmed: exclude redundant Admin workflow status;
  membership itself represents public eligibility.
- 2026-07-10 — D-007.22 confirmed: exclude private Admin `submittedBy`
  identities and emails.
- 2026-07-10 — D-007.23 confirmed: exclude private Admin `reviewedBy`
  identities and emails.
- 2026-07-10 — D-007.24 confirmed: exclude all Admin/NOVA reviewer notes and
  internal processing commentary.
- 2026-07-11 — D-007.25 confirmed: exclude Admin row `createdAt`; use explicit
  content dates and snapshot-level generation/publication times instead.
- 2026-07-11 — D-007.26 confirmed: exclude Admin row `updatedAt`; consumers
  detect change using the snapshot hash.
- 2026-07-11 — D-007.27 confirmed: name the nested song-occurrence array
  `performances`; it is not a deduplicated song catalog.
- 2026-07-11 — D-008.1 was initially confirmed as nullable, then revised:
  `endSeconds` is required, JSON `null` is invalid, and known gaps must be
  repaired after specification approval.
- 2026-07-11 — D-008.2 confirmed: every streamer is strongly bound to a
  required `youtubeChannelId`; missing or invalid values block publication.
- 2026-07-11 — D-008.3 confirmed: always emit `avatarUrl`; use JSON `null`
  when no safe HTTPS avatar URL is available without blocking publication.
- 2026-07-11 — D-008.4 confirmed: always emit `group`; use JSON `null` for an
  unknown label and never infer an affiliation.
- 2026-07-11 — D-008.5 confirmed: always emit `socialLinks` as an object; use
  an empty object when no safe supported link is available.
- 2026-07-11 — D-008.6 confirmed: omit unavailable provider keys from
  `socialLinks`; every emitted value must be a safe HTTPS URL.
- 2026-07-11 — D-008.7 confirmed: always emit `originalArtist`; use JSON
  `null` when the approved song row has no known artist display string.
- 2026-07-11 — D-009.1 confirmed: use case-sensitive `camelCase` names for
  every public JSON property and map internal database columns explicitly.
- 2026-07-11 — D-009.2 confirmed: encode the JSON artifact as UTF-8 without a
  BOM and hash the final UTF-8 bytes.
- 2026-07-11 — D-009.3 confirmed: normalize human-readable display text to
  Unicode NFC while leaving opaque IDs and URLs untouched.
- 2026-07-11 — D-009.4 confirmed: trim only surrounding Unicode whitespace
  from display text and preserve meaningful internal whitespace.
- 2026-07-11 — D-009.5 confirmed: trim and validate source URLs without
  provider-specific rewriting, redirect resolution, or network lookup.
- 2026-07-11 — D-009.6 confirmed: require each VOD date to be an exact valid
  `YYYY-MM-DD` date-only value without inference or timezone conversion.
- 2026-07-11 — D-009.7 confirmed: require strict integer second offsets and
  never coerce, round, truncate, clamp, swap, or infer them.
- 2026-07-11 — D-009.8 confirmed: keep export strictly read-only and apply
  only the explicitly confirmed transformations to in-memory output.
- 2026-07-11 — D-010.1 confirmed: any invalid required field or range blocks
  the complete atomic publication and leaves the previous snapshot active.
- 2026-07-11 — D-010.2 confirmed: validate the full candidate dataset and
  return all discovered errors together instead of stopping at the first.
- 2026-07-11 — D-010.3 confirmed: replace unsafe optional URLs with their safe
  fallback, report a non-blocking warning, and permit publication.
- 2026-07-11 — D-010.4 confirmed: a missing `originalArtist` emits JSON `null`
  plus a non-blocking Admin data-quality warning.
- 2026-07-11 — D-010.5 confirmed: keep all validation findings private to
  authenticated Admin and exclude them from the public snapshot and manifest.
- 2026-07-11 — D-010.6 confirmed: return structured Admin findings with stable
  `code`, `severity`, and human-readable `message` fields.
- 2026-07-11 — D-010.7 confirmed: include the public `streamerSlug` on every
  finding attributable to streamer data.
- 2026-07-11 — D-010.8 confirmed: identify each streamer-data finding with one
  fixed `entityType`: `streamer`, `vod`, `song`, or `performance`.
- 2026-07-11 — D-010.9 confirmed: include `entityId` using the existing public
  slug, `videoId`, `songId`, or `performanceId` for the selected entity type.
- 2026-07-11 — D-010.10 confirmed: use the public camelCase property name in
  `field` for field-specific findings and omit it for entity-wide findings.
- 2026-07-11 — D-010.11 confirmed: exclude generic raw values and source-row
  dumps from findings and never interpolate untrusted content into messages.
- 2026-07-11 — D-010.12 confirmed: permit only finding-code-specific,
  whitelisted primitive diagnostics inside an optional `details` object.
- 2026-07-11 — D-010.13 confirmed: return one `findings` array and classify
  each entry solely through its required `severity`.
- 2026-07-11 — D-010.14 confirmed: include a server-derived `canPublish`
  boolean that is false exactly when at least one error finding exists.
- 2026-07-11 — D-010.15 confirmed: deterministically sort findings by severity,
  scope, streamer, entity, field, and code; use a private locator only as the
  final tie-breaker when public identity is unavailable.
- 2026-07-11 — D-010.16 confirmed: assign each validation rule a specific,
  stable, case-sensitive `SCREAMING_SNAKE_CASE` finding code.
- 2026-07-11 — D-010.17 confirmed: use blocking `MISSING_VOD_RELATION` on an
  approved performance whose referenced VOD row is absent.
- 2026-07-11 — D-010.18 confirmed: use blocking `MISSING_SONG_RELATION` on an
  approved performance whose referenced song row is absent.
- 2026-07-11 — D-010.19 confirmed: use blocking `VOD_STREAMER_MISMATCH` when
  an approved performance and its referenced VOD have different streamers.
- 2026-07-11 — D-010.20 confirmed: use blocking `SONG_STREAMER_MISMATCH` when
  an approved performance and its referenced song have different streamers.
- 2026-07-11 — D-010.21 confirmed: use blocking `MISSING_STREAMER_SLUG` and a
  private `details.submissionId` when public streamer identity is unavailable.
- 2026-07-11 — D-010.22 confirmed: use blocking
  `MISSING_YOUTUBE_CHANNEL_ID` when an approved, enabled streamer lacks its
  required strong-bound YouTube channel ID.
- 2026-07-11 — D-010.23 confirmed: verify a changed YouTube channel ID through
  `channels.list`, persist the exact verified ID and time, and never recheck it
  over the network during export.
- 2026-07-11 — D-010.24 confirmed: use blocking
  `UNVERIFIED_YOUTUBE_CHANNEL_ID` for a non-empty current ID without matching
  persisted successful verification.
- 2026-07-11 — D-010.25 confirmed: use blocking `MISSING_DISPLAY_NAME` when an
  approved, enabled streamer's trimmed display name is empty.
- 2026-07-11 — D-010.26 confirmed: apply the existing slug allowlist and use
  blocking `INVALID_STREAMER_SLUG` with only a private Admin locator.
- 2026-07-11 — D-010.27 confirmed: emit one blocking
  `DUPLICATE_STREAMER_SLUG` per shared valid slug with its duplicate count.
- 2026-07-11 — D-010.28 confirmed: require verified YouTube channel IDs to be
  unique among approved, enabled streamers and block every conflicting row.
- 2026-07-11 — D-010.29 confirmed: use blocking `MISSING_VIDEO_ID` and private
  `details.streamId` when a VOD cannot provide its public identity.
- 2026-07-11 — D-010.30 confirmed: require the existing 11-character safe
  video-ID format and use blocking `INVALID_VIDEO_ID` without auto-correction.
- 2026-07-11 — D-010.31 confirmed: emit one blocking
  `DUPLICATE_VOD_VIDEO_ID` per duplicate `(streamerSlug, videoId)` while
  allowing cross-streamer reuse.
- 2026-07-11 — D-010.32 confirmed: use blocking `MISSING_VOD_TITLE` when the
  canonical approved VOD title is empty, with no fallback lookup.
- 2026-07-11 — D-010.33 confirmed: use blocking `MISSING_VOD_DATE` when the
  canonical approved VOD date is absent, with no fallback inference.
- 2026-07-11 — D-010.34 completed under delegated authority: define the
  remaining blocking/warning code catalog, private identity fallbacks,
  precedence, aggregation, and response shape.
- 2026-07-11 — D-010 received final product-owner review and was approved as a
  complete error-handling contract.
- 2026-07-11 — D-011.1 confirmed: sort streamers by stable public slug
  ascending and ignore private NOVA display order.
- 2026-07-11 — D-011.2 confirmed: sort each streamer's VODs by date descending
  and then public video ID ascending.
- 2026-07-11 — D-011.3 confirmed: sort performances chronologically by start
  seconds and then public performance ID ascending.
- 2026-07-11 — D-011.4 confirmed: exclude volatile timestamps from snapshot
  bytes so identical content can retain identical hash identity.
- 2026-07-11 — D-012.1 confirmed: require the self-describing top-level string
  `schemaVersion: "1.0.0"` in every snapshot under the initial v1.0.0 contract.
- 2026-07-11 — D-012.2 confirmed: increment the major version for every
  backward-incompatible structure, type, identity, ordering, or meaning change.
- 2026-07-11 — D-012.3 confirmed: increment the minor version only for
  additive public properties that existing same-major consumers may ignore.
- 2026-07-11 — D-012.4 confirmed: reserve patch increments for compatible
  contract corrections; data and conformance-only fixes keep the schema version.
- 2026-07-11 — D-012.5 confirmed: isolate every major version in its own
  immutable snapshot prefix and mutable manifest namespace.
- 2026-07-11 — D-012.6 confirmed: keep the immediately previous major
  synchronized for at least 90 calendar days after its successor is recommended.
- 2026-07-11 — D-012.7 confirmed: freeze the previous major on its last valid
  snapshot after the update window and retain it until explicit retirement.
- 2026-07-11 — D-012.8 confirmed: add the new snapshot workflow without any
  change to existing curator-only song and stream export endpoints.
- 2026-07-11 — D-013.1 confirmed: add a dedicated Admin `VOD Export` page and
  leave existing content-management pages unchanged.
- 2026-07-11 — D-013.2 confirmed: restrict the page and every validation,
  preview, download, and publication endpoint to curators.
- 2026-07-11 — D-013.3 confirmed: initial page load is lightweight and a full
  candidate is generated only after an explicit curator preview action.
- 2026-07-11 — D-013.4 confirmed: store exact validation-passing candidate
  bytes privately and reuse them unchanged for download and publication.
- 2026-07-11 — D-013.5 confirmed: expire unpublished candidates after 24 hours
  and require a fresh preview before publication.
- 2026-07-11 — D-013.6 confirmed: any approved-source fingerprint change makes
  an otherwise unexpired candidate stale and unpublishable.
- 2026-07-11 — D-013.7 confirmed: show exact post-filter streamer, VOD, and
  performance occurrence counts for the candidate.
- 2026-07-11 — D-013.8 confirmed: show and allow copying the full candidate
  SHA-256 plus its exact uncompressed UTF-8 byte length.
- 2026-07-11 — D-013.9 confirmed: show authoritative UTC generation and expiry
  timestamps for private candidates without adding them to snapshot bytes.
- 2026-07-11 — D-013.10 confirmed: provide server-resolved direct repair
  navigation for actionable findings and filtered lists for aggregate conflicts.
- 2026-07-11 — D-013.11 confirmed: show derived finding counts and preserve
  deterministic order while filtering by severity or streamer.
- 2026-07-11 — D-013.12 confirmed: enable publication only for a valid,
  unexpired, non-stale candidate and recheck every condition server-side.
- 2026-07-11 — D-013.13 confirmed: require a second confirmation action showing
  schema version, full hash, counts, warnings, and manifest impact.
- 2026-07-11 — D-013.14 confirmed: treat a candidate with the same complete
  stable manifest identity as a no-op with no timestamp or audit churn.
- 2026-07-11 — D-013.15 through D-013.18 confirmed: show authoritative current
  publication state, allow exact candidate downloads, append private successful
  publication audits, and distinguish safe pre-commit failure from recoverable
  post-commit cleanup.
- 2026-07-11 — D-014.1 through D-014.5 confirmed: emit compact deterministic
  UTF-8 JSON without a trailing newline, use fixed property order and direct
  non-ASCII characters, and identify exact uncompressed bytes with lowercase
  SHA-256 in both the immutable path and curator download filename.
- 2026-07-11 — D-014.6 through D-014.10 confirmed: define JSON response
  metadata, CDN-negotiated transport compression, immutable and mutable cache
  policies, the fixed manifest path, and its exact public schema.
- 2026-07-11 — D-016.1 through D-016.3 confirmed: use database-triggered source
  revisions, transactional reads with bounded retry, an ordered revision-vector
  fence, R2 conditional writes, and a recoverable single-writer control slot.
- 2026-07-11 — D-017.1 through D-017.2 confirmed: isolate public and private R2
  Standard buckets at `data.oshi.tw`, disable `r2.dev` and CORS, and retain
  referenced snapshots plus a 400-day unreferenced safety window.
- 2026-07-11 — D-012.9 confirmed: defer multi-major atomic cutover mechanics to
  the required v2 publication design rather than inventing an unsafe v1 sequence.
- 2026-07-11 — D-013.19 confirmed: retain attributable successful audits for
  two years or the referenced-snapshot lifetime, reconcile acquired/prepared
  control state, and preserve anonymized technical provenance afterward.
- 2026-07-11 — D-014.11 confirmed: fix one logical `publishedAt` before the
  first conditional manifest attempt and reuse identical bytes for every retry.
- 2026-07-11 — D-017.3 confirmed: preserve an old public hostname through all
  referencing manifests and the following 400-day snapshot-retention window.
- 2026-07-11 — D-019 selected A: only an explicit curator preview, confirmation,
  and publish action can advance the public manifest.
- 2026-07-11 — D-020.1 through D-020.2 confirmed: require Workers Paid with a
  30-second Admin CPU limit and enforce explicit source-count, output-count,
  and 10 MiB canonical-byte bounds.
- 2026-07-11 — D-020.3 selected A: keep synchronous preview generation with a
  16 MiB source-text guard, 5,000-finding and 4 MiB private-response limits, and
  a 96 MiB pre-launch peak-memory stress gate plus private-R2 CAS single-flight
  generation across isolates.

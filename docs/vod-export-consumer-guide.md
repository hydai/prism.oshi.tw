# VOD Export Consumer Guide

- Status: production handoff for schema major version 1
- Current schema version: `1.0.0`
- Last reviewed: 2026-07-12

The live production manifest and snapshot passed byte-length, SHA-256, counts,
shape, ordering, identity, range, and Unicode checks on the review date. Their
current hash and counts are intentionally not pinned here; the manifest is the
authoritative current value.

This document is the implementation handoff for a website that consumes and
renders the public VOD export, including `vods.oshi.tw`.

The normative source of truth remains
[`vod-export-spec.md`](../vod-export-spec.md). If this guide and the normative
specification ever disagree, follow the specification and correct this guide.
The Admin/R2 deployment procedure in
[`vod-export-rollout.md`](vod-export-rollout.md) is an operator runbook, not a
consumer API contract.

Terminology in this guide:

- **must**, **required**, and **reject** describe export-contract requirements
  or checks needed before a candidate can be treated as conforming;
- **recommended** describes an operational or UX policy for `vods.oshi.tw` and
  may be changed without revising the export schema.

## 1. Quick handoff

The stable production entry point is:

```text
https://data.oshi.tw/vod/v1/manifest.json
```

The website must:

1. fetch the manifest during a build or server-side refresh;
2. validate the manifest and support its schema major version;
3. skip the download when the manifest `sha256` is already active;
4. otherwise fetch the manifest's `snapshotUrl`;
5. validate the exact decoded byte length and SHA-256 before parsing;
6. validate the complete snapshot and its counts;
7. atomically replace the previous dataset only after every check succeeds;
8. keep the last known-good dataset if any fetch or validation step fails.

Do not hard-code the currently published snapshot URL. Snapshot URLs are
content-addressed and change whenever public data changes.

## 2. Consumption model

```text
Admin Preview + Publish
        |
        v
mutable manifest.json
        |
        | snapshotUrl + sha256
        v
immutable snapshot JSON
        |
        v
vods.oshi.tw build/server refresh
        |
        v
validated atomic replacement
        |
        v
rendered pages
```

Version 1 is an authoritative **complete snapshot**, not an event stream or an
incremental update:

- every snapshot contains all currently exported streamers, VODs, and song
  performances;
- absence from a newly validated snapshot means removal;
- do not merge a new snapshot into old data;
- do not retain an old record merely because its ID is absent from the new
  snapshot;
- do not activate a partially downloaded, partially parsed, or partially
  validated snapshot.

Publication is a manual curator action. An Admin edit or approval does not
become public until a curator successfully generates, reviews, and publishes a
new candidate.

A performance is eligible only when its VOD, performance row, and song row are
all approved and all belong to the same streamer. An incomplete approval chain
causes that occurrence to be absent; it is not a partial-publication error.
Because a VOD is omitted until it has at least one eligible performance, this
feed is the authoritative list of exported **song VODs with song information**,
not a list of every approved VOD in Admin.

Broken approved relationships or invalid required values block producer
publication instead of creating a partial public snapshot. In that case the
manifest continues to reference the previous valid snapshot.

## 3. Public resources and caching

| Resource | URL | Mutability | Cache policy |
| --- | --- | --- | --- |
| Manifest | `https://data.oshi.tw/vod/v1/manifest.json` | Mutable pointer to the current snapshot | `public, max-age=60, stale-if-error=86400` |
| Snapshot | Manifest `snapshotUrl` | Immutable, addressed by SHA-256 | `public, max-age=31536000, immutable` |

Important behavior:

- A successful publication may take up to 60 seconds to appear through the
  CDN under normal conditions.
- During a qualifying origin error, the CDN may serve the last valid cached
  manifest for up to one day.
- Query strings are excluded from the `/vod/` cache key. Adding a timestamp or
  random query parameter is not a supported cache-busting mechanism.
- `ETag` is transport metadata. It is not the canonical snapshot SHA-256 and
  must not be used as one.
- `Content-Length` may describe compressed transfer bytes or may be absent.
  Compare the decoded response bytes with manifest `uncompressedBytes`
  instead.
- Version 1 is designed for build/server-side consumption and has no required
  browser CORS policy. Site visitors must not download the complete feed
  directly from client-side JavaScript.
- The currently trusted artifact origin is `https://data.oshi.tw`. Keep trusted
  origins as an explicit consumer allowlist. If a documented hostname
  migration is announced, deploy the new origin to that allowlist before the
  manifest cutover; never accept an arbitrary hostname from the manifest.

### 3.1 Canonical bytes guaranteed by the producer

Manifest and snapshot objects are compact JSON encoded as UTF-8 without a BOM,
indentation, unnecessary whitespace, or a trailing newline. Object properties
have a fixed canonical order, and normalized non-ASCII text is emitted directly
as UTF-8 rather than rewritten as `\uXXXX` escapes.

Canonical property order is:

- snapshot: `schemaVersion`, `streamers`;
- streamer: `slug`, `displayName`, `youtubeChannelId`, `avatarUrl`, `group`,
  `socialLinks`, `vods`;
- social links: `youtube`, `twitter`, `facebook`, `instagram`, `twitch`, with
  unavailable keys omitted;
- VOD: `title`, `date`, `videoId`, `performances`;
- performance: `performanceId`, `songId`, `title`, `originalArtist`,
  `startSeconds`, `endSeconds`;
- manifest: `schemaVersion`, `snapshotUrl`, `sha256`, `publishedAt`,
  `uncompressedBytes`, `counts`.

These rules make identical public data produce identical bytes and hashes. A
consumer must hash the downloaded, HTTP-decoded bytes directly. Do not
`JSON.parse()` and then `JSON.stringify()` in an attempt to reconstruct the
canonical bytes: serializer property order, escaping, and Unicode behavior can
change the result.

## 4. TypeScript data contract

These types describe the current v1.0.0 fields. They do not replace runtime
validation. Consumers supporting schema major version 1 must ignore unknown
properties added by a future compatible minor version.

```ts
export type VodExportSchemaVersion = `${number}.${number}.${number}`;

export interface VodExportCounts {
  streamers: number;
  vods: number;
  performances: number;
}

export interface VodExportManifest {
  schemaVersion: VodExportSchemaVersion;
  snapshotUrl: string;
  sha256: string;
  publishedAt: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
}

export interface VodExportSocialLinks {
  youtube?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  twitch?: string;
}

export interface VodExportPerformance {
  performanceId: string;
  songId: string;
  title: string;
  originalArtist: string | null;
  startSeconds: number;
  endSeconds: number;
}

export interface VodExportVod {
  title: string;
  /** Exact date-only YYYY-MM-DD value; it is not a timestamp. */
  date: string;
  videoId: string;
  performances: VodExportPerformance[];
}

export interface VodExportStreamer {
  slug: string;
  displayName: string;
  youtubeChannelId: string;
  avatarUrl: string | null;
  group: string | null;
  socialLinks: VodExportSocialLinks;
  vods: VodExportVod[];
}

export interface VodExportSnapshot {
  schemaVersion: VodExportSchemaVersion;
  streamers: VodExportStreamer[];
}
```

The current value of both `manifest.schemaVersion` and
`snapshot.schemaVersion` is exactly `"1.0.0"`. The broader string type above is
intentional so a consumer can perform a runtime major-version check instead of
silently treating a future version as v1.0.0.

## 5. Manifest contract

Current compact shape, shown with placeholders:

```json
{
  "schemaVersion": "1.0.0",
  "snapshotUrl": "https://data.oshi.tw/vod/v1/snapshots/{sha256}.json",
  "sha256": "{64-lowercase-hex}",
  "publishedAt": "2026-07-11T12:35:10.123Z",
  "uncompressedBytes": 1630280,
  "counts": {
    "streamers": 36,
    "vods": 554,
    "performances": 8534
  }
}
```

The example values are illustrative, not fixed production values.

| Field | Required validation and meaning |
| --- | --- |
| `schemaVersion` | Semantic version string. Reject unsupported major versions. It must exactly equal the snapshot version. |
| `snapshotUrl` | Absolute HTTPS URL on a configured trusted artifact origin, with the exact path `/vod/v1/snapshots/{sha256}.json`. The current allowed origin is `https://data.oshi.tw`; do not accept an arbitrary origin. |
| `sha256` | Exactly 64 lowercase hexadecimal characters. Hash of the exact decoded, uncompressed snapshot bytes. |
| `publishedAt` | UTC timestamp formatted as `YYYY-MM-DDTHH:mm:ss.SSSZ`. It is the logical publication time, not a VOD timestamp. |
| `uncompressedBytes` | Positive safe integer equal to the decoded snapshot byte length. Maximum v1 snapshot size is 10,485,760 bytes. |
| `counts.streamers` | Non-negative safe integer equal to `snapshot.streamers.length`. |
| `counts.vods` | Non-negative safe integer equal to the sum of every streamer’s `vods.length`. |
| `counts.performances` | Non-negative safe integer equal to the sum of every VOD’s `performances.length`. |

The producer's v1 upper bounds are 500 streamers, 10,000 VODs, 50,000
performances, and 10 MiB of decoded canonical snapshot bytes. A consumer should
enforce these as defensive limits before activation.

## 6. Snapshot field semantics

### 6.1 Streamer

| Field | Type | Semantics |
| --- | --- | --- |
| `slug` | canonical slug string | Case-sensitive Prism primary identity in this snapshot and recommended route/key value. It is 1–50 characters and matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`. |
| `displayName` | non-empty string | Mutable presentation text; never use as identity. |
| `youtubeChannelId` | non-empty string | Required, verified external YouTube channel identity. It does not replace `slug`; do not invent an additional `UC`-prefix or fixed-length rule outside this contract. |
| `avatarUrl` | HTTPS string or `null` | Sanitized remote image URL. It is always present. A consumer may proxy/fetch it during build. |
| `group` | string or `null` | Presentation label only. It is not a stable ID or controlled vocabulary. |
| `socialLinks` | object | Always present. Contains only available supported provider links; it may be `{}`. |
| `vods` | array | Always present. It may be `[]` for an approved, enabled streamer with no eligible VODs. |

Every approved and enabled streamer appears exactly once. The feed omits the
private Admin/NOVA submission ID, description, brand name, subscriber count,
theme, enabled flag, display order, and workflow fields.

The producer validates every emitted URL as HTTPS with no credentials or
explicit port. Its current host allowlist is:

| Field/provider | Allowed hosts after ASCII-lowercasing and removing one leading `www.` for comparison |
| --- | --- |
| `avatarUrl` | `yt3.ggpht.com`, `yt4.ggpht.com`, `yt3.googleusercontent.com`, `lh3.googleusercontent.com` |
| YouTube | `youtube.com`, `m.youtube.com`, `youtu.be` |
| Twitter/X | `twitter.com`, `mobile.twitter.com`, `x.com` |
| Facebook | `facebook.com`, `m.facebook.com`, `fb.com` |
| Instagram | `instagram.com` |
| Twitch | `twitch.tv` |

YouTube `/redirect` URLs are not allowed. Approved URL spelling, query
parameters, fragments, and trailing slashes are otherwise preserved instead
of provider-specific rewriting. Do not use these URLs as record identities.

### 6.2 VOD

| Field | Type | Semantics |
| --- | --- | --- |
| `title` | non-empty string | Curator-approved VOD title. |
| `date` | `YYYY-MM-DD` string | Valid calendar date with no time or timezone semantics. |
| `videoId` | 11-character string | Canonical YouTube video ID matching `^[A-Za-z0-9_-]{11}$`. VOD identity is scoped by streamer. |
| `performances` | non-empty array | Chronological song-performance occurrences. Every exported VOD has at least one. |

There is no public Admin VOD ID. The canonical VOD key is the composite
`(streamer.slug, videoId)`. A `videoId` may intentionally appear under multiple
streamers for a collaboration and is therefore not globally unique.

Do not parse a date-only `date` with APIs that turn it into a UTC instant and
then render it in a local timezone. Keep it as a date-only value, or use a
date-only type such as `Temporal.PlainDate` when available.

### 6.3 Performance

`performances` contains occurrences, not a deduplicated song catalog. The same
`songId` may legally appear more than once in one VOD.

| Field | Type | Semantics |
| --- | --- | --- |
| `performanceId` | non-empty string | Globally unique opaque occurrence identity. Do not parse its prefix. |
| `songId` | non-empty string | Opaque current curated song-row identity. It relates occurrences but is not a universal composition/work ID. |
| `title` | non-empty string | Current curator-approved song title. |
| `originalArtist` | non-empty string or `null` | Free-form display text. Do not split it into artist identities. |
| `startSeconds` | non-negative safe integer | Offset from the start of the YouTube video; zero is valid. |
| `endSeconds` | positive safe integer | Required and strictly greater than `startSeconds`. |

Timestamp corrections do not change `performanceId`. Deleting and recreating
an occurrence may create a new ID. A song merge may move occurrences to a
different surviving `songId` in a later snapshot.

## 7. Null, empty, and omission rules

| Situation | Public representation |
| --- | --- |
| Streamer has no safe avatar | `"avatarUrl": null` |
| Streamer has no group label | `"group": null` |
| Streamer has no supported social link | `"socialLinks": {}` |
| One social provider is unavailable | Omit that provider key; never emit it as `null` |
| Song artist is unknown | `"originalArtist": null` |
| Streamer has no eligible VOD | `"vods": []` |
| Approved VOD has no eligible performance | Omit the VOD entirely |
| Performance has no valid end time | Invalid producer state; it cannot appear in a published snapshot |

All fields shown in the TypeScript interfaces are required except individual
provider keys within `socialLinks`. Do not reinterpret a missing required key,
an empty string, and JSON `null` as equivalent.

## 8. Identity, ordering, and derived values

### 8.1 Application identity keys

| UI/data entity | Key |
| --- | --- |
| Streamer | `streamer.slug` |
| VOD | `${streamer.slug}:${vod.videoId}` or an equivalent collision-safe composite representation |
| Performance occurrence | `performance.performanceId` |
| Current curated song grouping | `performance.songId` |

Never use a title, display name, artist name, array index, or full YouTube URL
as a persistent identity. Export identities are part of each complete
snapshot: if a curator changes a `slug` or `videoId`, the next snapshot behaves
as a removal plus an addition. Historical route redirects, if needed, are a
separate website-owned migration concern.

### 8.2 Guaranteed array order

1. `streamers`: `slug` ascending;
2. each `vods`: `date` descending, then `videoId` ascending;
3. each `performances`: `startSeconds` ascending, then `performanceId`
   ascending.

String tie-breakers are case-sensitive ordinal UTF-8 comparisons, not locale
sorting. A website may apply a separate presentation sort, but it must keep the
identity keys above.

### 8.3 Values the website derives

The feed intentionally does not duplicate derived fields:

```ts
const watchUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

const timestampedWatchUrl = (videoId: string, startSeconds: number) =>
  `${watchUrl(videoId)}&t=${startSeconds}s`;

const durationSeconds = (performance: VodExportPerformance) =>
  performance.endSeconds - performance.startSeconds;
```

The website may select or fetch a YouTube thumbnail using `videoId`, but no
thumbnail URL is part of the authoritative contract. Array order is the
display position; there is no separate `position` field.

## 9. Required fetch and validation sequence

Treat all HTTP data as `unknown` until runtime validation succeeds.

1. Fetch the stable manifest URL from a trusted server/build environment.
2. Require HTTP 200 and a JSON content type.
3. Parse JSON and validate the manifest fields and limits in section 5.
4. Parse `schemaVersion` as semantic versioning. Continue only when major
   version 1 is supported.
5. Require `snapshotUrl` to use HTTPS, a configured trusted artifact origin
   (currently exactly `data.oshi.tw`), no credentials or explicit port, and the exact
   `/vod/v1/snapshots/{sha256}.json` path. Reject redirects to another origin.
6. If this exact `sha256` is already the active, previously validated dataset,
   stop; there is no data change.
7. Fetch `snapshotUrl` and require HTTP 200 and a JSON content type.
8. Read the HTTP-decoded response bytes. Abort if they exceed 10,485,760 bytes.
9. Require `bytes.byteLength === manifest.uncompressedBytes`.
10. Calculate SHA-256 over those exact bytes and require equality with
    `manifest.sha256`.
11. Decode strict UTF-8 without replacement characters, parse JSON, and
    validate every required field, nullability rule, integer/range invariant,
    identity uniqueness rule, deterministic array order, collection shape,
    and producer bound.
12. Require `snapshot.schemaVersion === manifest.schemaVersion`.
13. Recalculate the three counts from the snapshot and require exact equality
    with `manifest.counts`.
14. Only now persist and atomically activate the candidate dataset.

Hash verification happens after HTTP content decoding. The standard Fetch API
normally exposes decoded bytes through the response body stream and
`arrayBuffer()`.

### 9.1 Minimum runtime snapshot invariants

In addition to validating the field types in section 4, the runtime schema or
post-schema checks must require all of the following:

- streamer slugs are canonical and unique;
- non-empty `youtubeChannelId` values are unique across streamers;
- the top-level `streamers` array is ordered by slug ascending;
- every streamer's `videoId` values are unique within that streamer, while the
  same `videoId` remains legal under a different streamer;
- `performanceId` values are globally unique opaque strings;
- each `vods` array follows the specified date/video ordering;
- every VOD has at least one performance;
- each `performances` array follows the specified timestamp/ID ordering;
- every `startSeconds` and `endSeconds` is a JavaScript safe integer with
  `startSeconds >= 0` and `endSeconds > startSeconds`;
- every VOD date is both exact `YYYY-MM-DD` syntax and a real calendar date;
- every decoded JSON string contains only valid Unicode scalar values, with no
  unpaired UTF-16 surrogate left by a JSON escape;
- `displayName`, `group`, VOD/song `title`, and `originalArtist` are already
  Unicode NFC and contain no contract-defined leading or trailing whitespace;
  required display text is non-empty, while a missing nullable display value
  is `null` rather than blank text;
- `avatarUrl`, social URLs, and their null/omission behavior match sections 6
  and 7;
- all manifest counts and v1 producer limits match the validated document.

Do not configure the runtime schema to reject all unknown object properties.
Compatible v1 minor versions may add safely ignorable fields, and a major-v1
consumer is required to ignore them. Continue to require every currently
documented field and invariant.

The pinned surrounding-whitespace set is U+0009–U+000D, U+0020, U+00A0,
U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF.
Runtime validation should reject a nonconforming snapshot rather than silently
normalizing it. Do not apply NFC or whitespace rewriting to opaque IDs or URLs.
Ordering comparisons use ordinal UTF-8 bytes; do not use `localeCompare()`.

## 10. Framework-neutral TypeScript reference flow

The following code shows the integration boundary. `parseManifest` and
`parseSnapshot` must be backed by runtime schemas in the new website (for
example Zod, Valibot, ArkType, or JSON Schema); TypeScript casts alone are not
validation.

```ts
const MANIFEST_URL = "https://data.oshi.tw/vod/v1/manifest.json";
// Add a successor only through a reviewed hostname-migration deployment.
const TRUSTED_SNAPSHOT_ORIGINS = ["https://data.oshi.tw"] as const;
const MAX_MANIFEST_BYTES = 65_536; // Consumer-side defensive limit, not a v1 field.
const MAX_SNAPSHOT_BYTES = 10_485_760;

declare function parseManifest(value: unknown): VodExportManifest;
declare function parseSnapshot(value: unknown): VodExportSnapshot;

function assertSupportedVersion(version: string): void {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || Number(match[1]) !== 1) {
    throw new Error(`Unsupported VOD schema version: ${version}`);
  }
}

function assertTrustedSnapshotUrl(manifest: VodExportManifest): void {
  const expectedPath = `/vod/v1/snapshots/${manifest.sha256}.json`;
  const matches = TRUSTED_SNAPSHOT_ORIGINS.some(
    (origin) => manifest.snapshotUrl === `${origin}${expectedPath}`,
  );
  if (!matches) {
    throw new Error("Manifest contains an unexpected snapshot URL");
  }
}

function assertJsonResponse(response: Response, label: string): void {
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") throw new Error(`${label} is not JSON`);
}

async function readBytesWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("Response body is missing");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`Response exceeds ${limit} decoded bytes`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeUtf8WithoutBom(bytes: Uint8Array, label: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${label} contains a forbidden UTF-8 BOM`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function snapshotCounts(snapshot: VodExportSnapshot): VodExportCounts {
  let vods = 0;
  let performances = 0;

  for (const streamer of snapshot.streamers) {
    vods += streamer.vods.length;
    for (const vod of streamer.vods) performances += vod.performances.length;
  }

  return { streamers: snapshot.streamers.length, vods, performances };
}

function assertCounts(actual: VodExportCounts, expected: VodExportCounts): void {
  if (
    actual.streamers !== expected.streamers ||
    actual.vods !== expected.vods ||
    actual.performances !== expected.performances
  ) {
    throw new Error("Snapshot counts do not match the manifest");
  }
}

export async function fetchVodCandidate(
  activeSha256?: string,
): Promise<null | { manifest: VodExportManifest; snapshot: VodExportSnapshot }> {
  const manifestResponse = await fetch(MANIFEST_URL, { redirect: "error" });
  assertJsonResponse(manifestResponse, "Manifest");

  const manifestBytes = await readBytesWithLimit(manifestResponse, MAX_MANIFEST_BYTES);
  const manifestText = decodeUtf8WithoutBom(manifestBytes, "Manifest");
  const manifest = parseManifest(JSON.parse(manifestText));
  assertSupportedVersion(manifest.schemaVersion);
  assertTrustedSnapshotUrl(manifest);

  if (manifest.sha256 === activeSha256) return null;

  const snapshotResponse = await fetch(manifest.snapshotUrl, { redirect: "error" });
  assertJsonResponse(snapshotResponse, "Snapshot");

  const bytes = await readBytesWithLimit(snapshotResponse, MAX_SNAPSHOT_BYTES);
  if (bytes.byteLength !== manifest.uncompressedBytes) throw new Error("Snapshot byte mismatch");
  if ((await sha256Hex(bytes)) !== manifest.sha256) throw new Error("Snapshot hash mismatch");

  const text = decodeUtf8WithoutBom(bytes, "Snapshot");
  const snapshot = parseSnapshot(JSON.parse(text));

  if (snapshot.schemaVersion !== manifest.schemaVersion) {
    throw new Error("Manifest and snapshot versions differ");
  }

  assertCounts(snapshotCounts(snapshot), manifest.counts);
  return { manifest, snapshot };
}
```

The application-specific caller must store the returned manifest and snapshot
together and switch its active reference atomically. A static build should fail
without deploying a partial build. A long-running server should retain its
previous active dataset until the new pair is durably stored and ready.

## 11. Rendering guidance

- Render `displayName`, VOD/song `title`, `group`, and `originalArtist` as plain
  text. Never inject them as HTML.
- Use `slug`, the scoped VOD composite key, and `performanceId` for framework
  list keys and persistent routes.
- Show an intentional empty state when `streamer.vods` is empty.
- Choose a presentation fallback for `avatarUrl`, `group`, and
  `originalArtist` when they are `null`; do not persist the fallback back into
  exported data.
- Treat `originalArtist` and `group` as free-form labels, not faceted IDs.
- Construct YouTube links from `videoId`; do not look for a `youtubeUrl` or
  timestamped URL field.
- Use `startSeconds` to seek playback and `endSeconds` to calculate/display the
  segment duration. Whether playback automatically stops at `endSeconds` is a
  website UX decision.
- The producer normalizes display text to Unicode NFC and trims surrounding
  whitespace. Do not apply additional compatibility folding or silently
  rewrite names.
- Social and avatar URLs are sanitized HTTPS values, but normal outbound-link
  and image-proxy security policies should still apply.

## 12. Refresh and failure behavior

| Condition | Safe consumer behavior |
| --- | --- |
| Manifest unavailable, malformed, or invalid | Keep the last known-good dataset. Retrying with backoff and reporting/alerting are recommended operational policies. |
| Manifest hash equals the active validated hash | No-op; do not redownload the snapshot. |
| Snapshot unavailable or redirect rejected | Keep the last known-good dataset. |
| Byte length or SHA-256 mismatch | Reject the candidate and keep the last known-good dataset. |
| Snapshot schema or counts invalid | Reject the candidate and keep the last known-good dataset. |
| Unsupported schema major version | Keep the last known-good supported dataset and require a consumer upgrade. |
| No previous dataset exists and bootstrap fails | Fail the build/startup or show an explicit unavailable state; never publish partial data. |

Do not clear working site data before the replacement has passed validation.
Do not retry by adding query parameters because the CDN intentionally ignores
them for the cache key.

## 13. Versioning rules

- `schemaVersion` uses semantic versioning and must be checked from the
  document, not inferred only from the URL.
- A major version changes for incompatible field, type, nullability, identity,
  nesting, ordering, or meaning changes.
- A compatible, safely ignorable field addition increments the minor version.
  A major-v1 consumer must ignore unknown properties.
- A patch increment is reserved for compatible specification corrections; data
  publications normally keep the same schema version.
- Every major has a separate path and manifest, such as `/vod/v1/` and
  `/vod/v2/`. A consumer opts into a new major by changing the manifest it
  follows after implementing that contract.
- When a future major becomes recommended, the immediately previous major is
  guaranteed synchronized updates for at least 90 calendar days, then may be
  frozen until separately retired.

## 14. Fields intentionally not provided

The website must not expect these values in v1:

- VOD Admin ID, full YouTube URL, thumbnail URL, or explicit position;
- timestamped watch URL or `durationSeconds`;
- tags, credit/provenance, performance notes, or album artwork;
- iTunes/music-service IDs;
- public approval/status fields;
- submitter/reviewer identities, email addresses, notes, or audit timestamps;
- streamer description, brand name, subscriber count, theme, enabled flag, or
  private display order;
- export/generation timestamp inside the snapshot.

Producer validation errors, warnings, repair notes, and unsafe source values
are also never public fields. A safe `null` or omitted social-provider key does
not reveal whether the source value was missing or rejected during producer
sanitization.

If the website needs new authoritative data, add it through a reviewed and
versioned export-contract change instead of scraping it from the existing site
or inferring it from unrelated fields.

## 15. Consumer acceptance checklist

- [ ] The stable manifest URL is configuration, and no snapshot URL is
      hard-coded.
- [ ] All fetching happens during build or on the server, not in visitors'
      browsers.
- [ ] Manifest and snapshot are runtime-validated from `unknown`.
- [ ] Unsupported major versions are rejected while unknown compatible fields
      are ignored.
- [ ] Snapshot URL origin/path, decoded bytes, SHA-256, schema version, limits,
      and counts are verified before activation.
- [ ] The active dataset is replaced atomically; absence in a new snapshot
      removes old records.
- [ ] The last known-good dataset survives refresh failures.
- [ ] Streamer, VOD, and performance keys follow section 8.1.
- [ ] Date-only VOD dates are not converted into timezone-dependent instants.
- [ ] Empty `vods`, nullable fields, and sparse social links render correctly.
- [ ] Exported display text is rendered as text rather than trusted HTML.
- [ ] Recommended: monitoring records the active `sha256`, `schemaVersion`,
      `publishedAt`, refresh success/failure, and the last successful refresh
      time.

## 16. References

- Normative contract: [`vod-export-spec.md`](../vod-export-spec.md)
- Producer rollout and operations:
  [`docs/vod-export-rollout.md`](vod-export-rollout.md)
- Stable production manifest:
  <https://data.oshi.tw/vod/v1/manifest.json>

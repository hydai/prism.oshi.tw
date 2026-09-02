import {
  SOCIAL_PROVIDERS,
  VOD_EXPORT_MAJOR,
  VOD_EXPORT_PUBLIC_ORIGIN,
  VOD_EXPORT_SCHEMA_VERSION,
  VOD_EXPORT_SNAPSHOT_PREFIX,
} from './constants';
import { isCanonicalTimestamp, SHA256_PATTERN } from './guards';
import { assertWithinCapacity, measureEmittedCapacity } from './limits';
import { hasValidUnicodeScalars, utf8ByteLength } from './normalization';
import { orderSnapshot } from './ordering';
import type {
  VodExportCounts,
  VodExportManifest,
  VodExportPerformance,
  VodExportSnapshot,
  VodExportSnapshotArtifact,
  VodExportSocialLinks,
  VodExportStreamer,
  VodExportVod,
} from './types';

/**
 * Canonical D-014 bytes are produced by `JSON.stringify` over explicitly
 * re-keyed plain objects, encoded with `TextEncoder`.
 *
 * `JSON.stringify` already implements every *byte-production* rule the D-014.4
 * contract requires: the short escapes, lowercase `\u00xx` for the remaining
 * C0 controls, raw `/`, `<`, `>`, `&`, U+2028, U+2029 and DEL, direct non-ASCII,
 * and plain base-10 integer spelling. What it does not implement are the
 * *input-validation* rules and the fixed property order, so those live here:
 * the `ordered*Object()` builders below assign properties in D-014.3 emission
 * order and reject anything the contract forbids (wrong types, unpaired
 * surrogates, unknown properties, `-0`, non-safe integers) rather than letting
 * a generic serializer silently publish different bytes.
 *
 * The manifest is small enough to stringify whole. The snapshot is stringified
 * one streamer at a time so a 10 MiB artifact never needs a 10 MiB intermediate
 * string; see `encodeCanonicalSnapshot()`.
 *
 * `admin/src/vod-export/canonical-differential.test.ts` pins the resulting
 * bytes against SHA-256 goldens recorded from the previous hand-rolled writer,
 * so this file may never change the published artifact identity.
 */

const textEncoder = new TextEncoder();
const MANIFEST_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'snapshotUrl',
  'sha256',
  'publishedAt',
  'uncompressedBytes',
  'counts',
]);
const COUNTS_KEYS: ReadonlySet<string> = new Set(['streamers', 'vods', 'performances']);
const SNAPSHOT_KEYS: ReadonlySet<string> = new Set(['schemaVersion', 'streamers']);
const STREAMER_KEYS: ReadonlySet<string> = new Set([
  'slug',
  'displayName',
  'youtubeChannelId',
  'avatarUrl',
  'group',
  'socialLinks',
  'vods',
]);
const SOCIAL_PROVIDER_KEYS: ReadonlySet<string> = new Set(SOCIAL_PROVIDERS);
const VOD_KEYS: ReadonlySet<string> = new Set(['title', 'date', 'videoId', 'performances']);
const PERFORMANCE_KEYS: ReadonlySet<string> = new Set([
  'performanceId',
  'songId',
  'title',
  'originalArtist',
  'startSeconds',
  'endSeconds',
]);

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function serializeCanonicalSnapshot(snapshot: VodExportSnapshot): Uint8Array {
  assertCanonicalSnapshotShape(snapshot);
  return encodeCanonicalSnapshot(snapshot);
}

export function canonicalSnapshotByteLength(snapshot: VodExportSnapshot): number {
  let byteLength = 0;
  forEachCanonicalSnapshotChunk(snapshot, (chunk) => {
    byteLength += utf8ByteLength(chunk);
  });
  return byteLength;
}

export function serializeCanonicalManifest(
  manifest: VodExportManifest,
  publicOrigin: string = VOD_EXPORT_PUBLIC_ORIGIN,
): Uint8Array {
  assertExactKeys(
    manifest,
    MANIFEST_KEYS,
    'manifest',
  );
  assertExactKeys(manifest.counts, COUNTS_KEYS, 'manifest.counts');
  if (manifest.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION) {
    throw new CanonicalJsonError(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }
  assertSha256(manifest.sha256);
  const expectedSnapshotUrl = snapshotUrlForHash(manifest.sha256, publicOrigin);
  if (manifest.snapshotUrl !== expectedSnapshotUrl) {
    throw new CanonicalJsonError('manifest.snapshotUrl does not match its sha256 and configured public origin');
  }
  if (!isCanonicalTimestamp(manifest.publishedAt)) {
    throw new CanonicalJsonError('manifest.publishedAt must be an exact UTC timestamp with three fractional digits');
  }
  assertCanonicalInteger(manifest.uncompressedBytes, 'manifest.uncompressedBytes', false);
  assertCounts(manifest.counts);

  return textEncoder.encode(JSON.stringify(orderedManifestObject(manifest)));
}

export async function createSnapshotArtifact(
  snapshot: VodExportSnapshot,
  publicOrigin: string = VOD_EXPORT_PUBLIC_ORIGIN,
): Promise<VodExportSnapshotArtifact> {
  const orderedSnapshot = orderSnapshot(snapshot);
  return createArtifactFromBytes(
    orderedSnapshot,
    serializeCanonicalSnapshot(orderedSnapshot),
    publicOrigin,
  );
}

/**
 * Serializes a snapshot that has already been ordered by the validation
 * pipeline. Keeping this separate from the general helper avoids a second
 * full snapshot clone at the peak of candidate generation.
 */
export async function createOrderedSnapshotArtifact(
  orderedSnapshot: VodExportSnapshot,
  publicOrigin: string = VOD_EXPORT_PUBLIC_ORIGIN,
): Promise<VodExportSnapshotArtifact> {
  return createArtifactFromBytes(
    orderedSnapshot,
    serializeOwnedCanonicalSnapshot(orderedSnapshot),
    publicOrigin,
  );
}

/**
 * Trusted fast path for the freshly validated, exclusively owned snapshot: it
 * keeps every value-level guard (types, unpaired surrogates, canonical
 * integers, provider allowlist) but skips the exact-key and relational shape
 * pass that only untrusted, parsed snapshots need.
 */
function serializeOwnedCanonicalSnapshot(snapshot: VodExportSnapshot): Uint8Array {
  return encodeCanonicalSnapshot(snapshot);
}

/**
 * Encodes the snapshot one streamer at a time.
 *
 * A single `JSON.stringify` over the whole graph is the same bytes, but it
 * holds the complete re-keyed object graph and a complete ~10 MiB intermediate
 * string alongside the output buffer, which costs ~15 MiB over the Worker
 * isolate budget that `stress.test.ts` gates. Chunking keeps `JSON.stringify`
 * as the only producer of bytes — an object's serialization is exactly its
 * properties' serializations joined by `,` inside braces, so the concatenated
 * chunks are byte-identical to stringifying the whole snapshot — while only one
 * streamer's re-keyed subgraph and text are live at a time. It also keeps the
 * capacity limit a pre-allocation check.
 */
function encodeCanonicalSnapshot(snapshot: VodExportSnapshot): Uint8Array {
  const byteLength = canonicalSnapshotByteLength(snapshot);
  assertWithinCapacity('snapshotBytes', byteLength);

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  forEachCanonicalSnapshotChunk(snapshot, (chunk) => {
    const written = textEncoder.encodeInto(chunk, bytes.subarray(offset));
    if (written.read !== chunk.length) throw new CanonicalJsonError('Canonical UTF-8 buffer was undersized');
    offset += written.written;
  });
  if (offset !== byteLength) {
    throw new CanonicalJsonError('Canonical UTF-8 byte count did not match serialization');
  }
  return bytes;
}

/** Feeds the canonical snapshot text to `emit`, one streamer-sized chunk at a time. */
function forEachCanonicalSnapshotChunk(
  snapshot: VodExportSnapshot,
  emit: (chunk: string) => void,
): void {
  assertObject(snapshot, 'snapshot');
  if (snapshot.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION) {
    throw new CanonicalJsonError(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!Array.isArray(snapshot.streamers)) throw new CanonicalJsonError('snapshot.streamers must be an array');

  emit(`{"schemaVersion":${JSON.stringify(snapshot.schemaVersion)},"streamers":[`);
  for (let index = 0; index < snapshot.streamers.length; index += 1) {
    if (index > 0) emit(',');
    const streamer = snapshot.streamers[index];
    if (streamer === undefined) throw new CanonicalJsonError('snapshot.streamers contains a missing item');
    emit(JSON.stringify(orderedStreamerObject(streamer)));
  }
  emit(']}');
}

async function createArtifactFromBytes(
  orderedSnapshot: VodExportSnapshot,
  bytes: Uint8Array,
  publicOrigin: string,
): Promise<VodExportSnapshotArtifact> {
  const counts = countSnapshot(orderedSnapshot);
  const capacity = measureEmittedCapacity(counts);
  capacity.push(assertWithinCapacity('snapshotBytes', bytes.byteLength));
  const sha256 = await sha256Hex(bytes);

  return {
    bytes,
    sha256,
    uncompressedBytes: bytes.byteLength,
    counts,
    objectKey: snapshotObjectKey(sha256),
    snapshotUrl: snapshotUrlForHash(sha256, publicOrigin),
    downloadFilename: `vod-export-v${VOD_EXPORT_MAJOR}-${sha256}.json`,
    capacity,
  };
}

export function countSnapshot(snapshot: VodExportSnapshot): VodExportCounts {
  let vods = 0;
  let performances = 0;
  for (const streamer of snapshot.streamers) {
    vods += streamer.vods.length;
    for (const vod of streamer.vods) performances += vod.performances.length;
  }
  const counts = { streamers: snapshot.streamers.length, vods, performances };
  assertCounts(counts);
  return counts;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hexadecimal = '';
  for (const byte of new Uint8Array(digest)) hexadecimal += byte.toString(16).padStart(2, '0');
  return hexadecimal;
}

export function snapshotObjectKey(sha256: string): string {
  assertSha256(sha256);
  return `${VOD_EXPORT_SNAPSHOT_PREFIX}${sha256}.json`;
}

export function snapshotUrlForHash(sha256: string, publicOrigin: string = VOD_EXPORT_PUBLIC_ORIGIN): string {
  const normalizedOrigin = normalizePublicOrigin(publicOrigin);
  return `${normalizedOrigin}/${snapshotObjectKey(sha256)}`;
}

/** The canonical spelling of one JSON string value, quotation marks included. */
export function serializeCanonicalString(value: string): string {
  return JSON.stringify(canonicalString(value, 'Canonical JSON string value'));
}

/** The canonical spelling of one JSON integer value. */
export function serializeCanonicalInteger(value: number): string {
  return String(canonicalInteger(value, 'JSON integer'));
}

// ---------------------------------------------------------------------------
// Ordered plain objects: property assignment order IS the D-014.3 emission
// order, so `JSON.stringify` cannot depend on how the input was assembled.
// ---------------------------------------------------------------------------

interface OrderedStreamer {
  slug: string;
  displayName: string;
  youtubeChannelId: string;
  avatarUrl: string | null;
  group: string | null;
  socialLinks: Record<string, string>;
  vods: OrderedVod[];
}

interface OrderedVod {
  title: string;
  date: string;
  videoId: string;
  performances: OrderedPerformance[];
}

interface OrderedPerformance {
  performanceId: string;
  songId: string;
  title: string;
  originalArtist: string | null;
  startSeconds: number;
  endSeconds: number;
}

interface OrderedManifest {
  schemaVersion: string;
  snapshotUrl: string;
  sha256: string;
  publishedAt: string;
  uncompressedBytes: number;
  counts: { streamers: number; vods: number; performances: number };
}

function orderedStreamerObject(streamer: VodExportStreamer): OrderedStreamer {
  assertObject(streamer, 'streamer');
  if (!Array.isArray(streamer.vods)) throw new CanonicalJsonError('streamer.vods must be an array');

  return {
    slug: canonicalString(streamer.slug, 'streamer.slug'),
    displayName: canonicalString(streamer.displayName, 'streamer.displayName'),
    youtubeChannelId: canonicalString(streamer.youtubeChannelId, 'streamer.youtubeChannelId'),
    avatarUrl: canonicalNullableString(streamer.avatarUrl, 'streamer.avatarUrl'),
    group: canonicalNullableString(streamer.group, 'streamer.group'),
    socialLinks: orderedSocialLinksObject(streamer.socialLinks),
    vods: orderedItems(streamer.vods, 'streamer.vods', orderedVodObject),
  };
}

function orderedSocialLinksObject(socialLinks: VodExportSocialLinks): Record<string, string> {
  assertObject(socialLinks, 'streamer.socialLinks');
  if (Object.keys(socialLinks).some((key) => !SOCIAL_PROVIDER_KEYS.has(key))) {
    throw new CanonicalJsonError('streamer.socialLinks contains an unknown provider');
  }

  const ordered: Record<string, string> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const value = socialLinks[provider];
    if (value === undefined) continue;
    ordered[provider] = canonicalString(value, `streamer.socialLinks.${provider}`);
  }
  return ordered;
}

function orderedVodObject(vod: VodExportVod): OrderedVod {
  assertObject(vod, 'vod');
  if (!Array.isArray(vod.performances)) throw new CanonicalJsonError('vod.performances must be an array');

  return {
    title: canonicalString(vod.title, 'vod.title'),
    date: canonicalString(vod.date, 'vod.date'),
    videoId: canonicalString(vod.videoId, 'vod.videoId'),
    performances: orderedItems(vod.performances, 'vod.performances', orderedPerformanceObject),
  };
}

function orderedPerformanceObject(performance: VodExportPerformance): OrderedPerformance {
  assertObject(performance, 'performance');

  return {
    performanceId: canonicalString(performance.performanceId, 'performance.performanceId'),
    songId: canonicalString(performance.songId, 'performance.songId'),
    title: canonicalString(performance.title, 'performance.title'),
    originalArtist: canonicalNullableString(performance.originalArtist, 'performance.originalArtist'),
    startSeconds: canonicalInteger(performance.startSeconds, 'performance.startSeconds'),
    endSeconds: canonicalInteger(performance.endSeconds, 'performance.endSeconds'),
  };
}

function orderedManifestObject(manifest: VodExportManifest): OrderedManifest {
  return {
    schemaVersion: manifest.schemaVersion,
    snapshotUrl: manifest.snapshotUrl,
    sha256: manifest.sha256,
    publishedAt: manifest.publishedAt,
    uncompressedBytes: manifest.uncompressedBytes,
    counts: {
      streamers: manifest.counts.streamers,
      vods: manifest.counts.vods,
      performances: manifest.counts.performances,
    },
  };
}

/**
 * `Array.prototype.map` silently preserves array holes, which `JSON.stringify`
 * would then publish as `null`, so every collection is walked by index.
 */
function orderedItems<Source, Ordered>(
  items: readonly Source[],
  label: string,
  order: (item: Source) => Ordered,
): Ordered[] {
  const ordered: Ordered[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) throw new CanonicalJsonError(`${label} contains a missing item`);
    ordered.push(order(item));
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Validation. Nothing below produces bytes; it decides whether bytes may exist.
// ---------------------------------------------------------------------------

/**
 * Structural rules that only untrusted, parsed snapshots can violate. The
 * exact-key checks allocate an array per object, so the owned generation path
 * deliberately skips this pass over its own freshly built graph.
 */
function assertCanonicalSnapshotShape(snapshot: VodExportSnapshot): void {
  assertExactKeys(snapshot, SNAPSHOT_KEYS, 'snapshot');
  if (!Array.isArray(snapshot.streamers)) throw new CanonicalJsonError('snapshot.streamers must be an array');

  for (const streamer of snapshot.streamers) {
    assertExactKeys(streamer, STREAMER_KEYS, 'streamer');
    if (!Array.isArray(streamer.vods)) throw new CanonicalJsonError('streamer.vods must be an array');

    for (const vod of streamer.vods) {
      assertExactKeys(vod, VOD_KEYS, 'vod');
      if (!Array.isArray(vod.performances)) throw new CanonicalJsonError('vod.performances must be an array');
      if (vod.performances.length === 0) {
        throw new CanonicalJsonError('Exported VODs must have at least one performance');
      }

      for (const performance of vod.performances) {
        assertExactKeys(performance, PERFORMANCE_KEYS, 'performance');
        assertCanonicalInteger(performance.startSeconds, 'performance.startSeconds', true);
        assertCanonicalInteger(performance.endSeconds, 'performance.endSeconds', true);
        if (performance.endSeconds <= performance.startSeconds) {
          throw new CanonicalJsonError('performance.endSeconds must be greater than startSeconds');
        }
      }
    }
  }
}

/**
 * Every canonical string slot is type-checked explicitly: `JSON.stringify`
 * would happily publish `42` for a numeric title, omit an `undefined` slot
 * entirely, and emit `\ud800` for a lone surrogate.
 */
function canonicalString(value: string, label: string): string {
  if (typeof value !== 'string') throw new CanonicalJsonError(`${label} must be a string`);
  if (!hasValidUnicodeScalars(value)) {
    throw new CanonicalJsonError(`${label} cannot contain unpaired surrogates`);
  }
  return value;
}

/** Nullable slots publish an explicit `null`; `undefined` is never a value. */
function canonicalNullableString(value: string | null, label: string): string | null {
  if (value === null) return null;
  return canonicalString(value, label);
}

function canonicalInteger(value: number, label: string): number {
  assertCanonicalInteger(value, label, true);
  return value;
}

function assertCanonicalInteger(value: number, label: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0) || (!allowZero && value === 0)) {
    throw new CanonicalJsonError(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`);
  }
}

function assertCounts(counts: VodExportCounts): void {
  assertCanonicalInteger(counts.streamers, 'counts.streamers', true);
  assertCanonicalInteger(counts.vods, 'counts.vods', true);
  assertCanonicalInteger(counts.performances, 'counts.performances', true);
}

function assertSha256(value: string): void {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new CanonicalJsonError('sha256 must be exactly 64 lowercase hexadecimal characters');
  }
}

function normalizePublicOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CanonicalJsonError('Public origin must be a valid absolute URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    throw new CanonicalJsonError('Public origin must be an HTTPS origin without credentials, port, path, query, or fragment');
  }
  return parsed.origin;
}

function assertObject(value: unknown, label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalJsonError(`${label} must be an object`);
  }
}

function assertExactKeys(value: object, expected: ReadonlySet<string>, label: string): void {
  assertObject(value, label);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new CanonicalJsonError(`${label} must contain exactly the v1 contract properties`);
  }
}

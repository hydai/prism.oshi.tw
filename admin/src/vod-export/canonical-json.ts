import {
  SOCIAL_PROVIDERS,
  VOD_EXPORT_MAJOR,
  VOD_EXPORT_PUBLIC_ORIGIN,
  VOD_EXPORT_SCHEMA_VERSION,
  VOD_EXPORT_SNAPSHOT_PREFIX,
} from './constants';
import { assertWithinCapacity, measureEmittedCapacity } from './limits';
import { hasValidUnicodeScalars, jsonStringByteLength, utf8ByteLength } from './normalization';
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

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const textEncoder = new TextEncoder();

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function serializeCanonicalSnapshot(snapshot: VodExportSnapshot): Uint8Array {
  const byteLength = canonicalSnapshotByteLength(snapshot);
  assertWithinCapacity('snapshotBytes', byteLength);
  const writer = new CanonicalByteWriter(byteLength);
  countSnapshotTokens(snapshot, writer);
  return writer.finish();
}

export function canonicalSnapshotByteLength(snapshot: VodExportSnapshot): number {
  const counter = new CanonicalByteCounter();
  countSnapshotTokens(snapshot, counter);
  return counter.byteLength;
}

export function serializeCanonicalManifest(
  manifest: VodExportManifest,
  publicOrigin: string = VOD_EXPORT_PUBLIC_ORIGIN,
): Uint8Array {
  assertExactKeys(
    manifest,
    ['schemaVersion', 'snapshotUrl', 'sha256', 'publishedAt', 'uncompressedBytes', 'counts'],
    'manifest',
  );
  assertExactKeys(manifest.counts, ['streamers', 'vods', 'performances'], 'manifest.counts');
  if (manifest.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION) {
    throw new CanonicalJsonError(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }
  assertSha256(manifest.sha256);
  const expectedSnapshotUrl = snapshotUrlForHash(manifest.sha256, publicOrigin);
  if (manifest.snapshotUrl !== expectedSnapshotUrl) {
    throw new CanonicalJsonError('manifest.snapshotUrl does not match its sha256 and configured public origin');
  }
  if (!isExactPublishedAt(manifest.publishedAt)) {
    throw new CanonicalJsonError('manifest.publishedAt must be an exact UTC timestamp with three fractional digits');
  }
  assertCanonicalInteger(manifest.uncompressedBytes, 'manifest.uncompressedBytes', false);
  assertCounts(manifest.counts);

  return encodeCanonicalTokens(() => manifestTokens(manifest));
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

function serializeOwnedCanonicalSnapshot(snapshot: VodExportSnapshot): Uint8Array {
  if (snapshot.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION) {
    throw new CanonicalJsonError(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  const counter = new CanonicalByteCounter();
  writeOwnedSnapshotTokens(snapshot, counter);
  assertWithinCapacity('snapshotBytes', counter.byteLength);
  const writer = new CanonicalByteWriter(counter.byteLength);
  writeOwnedSnapshotTokens(snapshot, writer);
  return writer.finish();
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

export function serializeCanonicalString(value: string): string {
  if (typeof value !== 'string') throw new CanonicalJsonError('Canonical JSON string value must be a string');
  if (!hasValidUnicodeScalars(value)) throw new CanonicalJsonError('Canonical JSON strings cannot contain unpaired surrogates');

  let serialized = '"';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    switch (codeUnit) {
      case 0x08:
        serialized += '\\b';
        break;
      case 0x09:
        serialized += '\\t';
        break;
      case 0x0a:
        serialized += '\\n';
        break;
      case 0x0c:
        serialized += '\\f';
        break;
      case 0x0d:
        serialized += '\\r';
        break;
      case 0x22:
        serialized += '\\"';
        break;
      case 0x5c:
        serialized += '\\\\';
        break;
      default:
        if (codeUnit <= 0x1f) {
          serialized += `\\u00${codeUnit.toString(16).padStart(2, '0')}`;
        } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
          serialized += value[index] ?? '';
          index += 1;
          serialized += value[index] ?? '';
        } else {
          serialized += value[index] ?? '';
        }
    }
  }
  return `${serialized}"`;
}

export function serializeCanonicalInteger(value: number): string {
  assertCanonicalInteger(value, 'JSON integer', true);
  return String(value);
}

class CanonicalByteCounter {
  byteLength = 0;

  ascii(value: string): void {
    this.add(value.length);
  }

  string(value: string): void {
    if (!hasValidUnicodeScalars(value)) {
      throw new CanonicalJsonError('Canonical JSON strings cannot contain unpaired surrogates');
    }
    this.add(jsonStringByteLength(value));
  }

  nullableString(value: string | null): void {
    if (value === null) this.ascii('null');
    else this.string(value);
  }

  integer(value: number): void {
    assertCanonicalInteger(value, 'JSON integer', true);
    this.add(canonicalIntegerDigitLength(value));
  }

  private add(bytes: number): void {
    this.byteLength += bytes;
    if (!Number.isSafeInteger(this.byteLength)) {
      throw new CanonicalJsonError('Canonical JSON byte length is unsafe');
    }
  }
}

interface CanonicalTokenSink {
  ascii(value: string): void;
  string(value: string): void;
  nullableString(value: string | null): void;
  integer(value: number): void;
}

class CanonicalByteWriter implements CanonicalTokenSink {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(byteLength: number) {
    this.bytes = new Uint8Array(byteLength);
  }

  ascii(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit > 0x7f) throw new CanonicalJsonError('Canonical ASCII token contains a non-ASCII value');
      this.writeByte(codeUnit);
    }
  }

  string(value: string): void {
    if (!hasValidUnicodeScalars(value)) {
      throw new CanonicalJsonError('Canonical JSON strings cannot contain unpaired surrogates');
    }
    this.writeByte(0x22);
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      switch (codeUnit) {
        case 0x08:
          this.writeEscape(0x62);
          break;
        case 0x09:
          this.writeEscape(0x74);
          break;
        case 0x0a:
          this.writeEscape(0x6e);
          break;
        case 0x0c:
          this.writeEscape(0x66);
          break;
        case 0x0d:
          this.writeEscape(0x72);
          break;
        case 0x22:
        case 0x5c:
          this.writeEscape(codeUnit);
          break;
        default:
          if (codeUnit <= 0x1f) {
            this.writeByte(0x5c);
            this.writeByte(0x75);
            this.writeByte(0x30);
            this.writeByte(0x30);
            this.writeByte(hexDigit(codeUnit >>> 4));
            this.writeByte(hexDigit(codeUnit & 0x0f));
          } else if (codeUnit <= 0x7f) {
            this.writeByte(codeUnit);
          } else if (codeUnit <= 0x7ff) {
            this.writeByte(0xc0 | (codeUnit >>> 6));
            this.writeByte(0x80 | (codeUnit & 0x3f));
          } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const second = value.charCodeAt(index + 1);
            const scalar = 0x10000 + ((codeUnit - 0xd800) << 10) + (second - 0xdc00);
            this.writeByte(0xf0 | (scalar >>> 18));
            this.writeByte(0x80 | ((scalar >>> 12) & 0x3f));
            this.writeByte(0x80 | ((scalar >>> 6) & 0x3f));
            this.writeByte(0x80 | (scalar & 0x3f));
            index += 1;
          } else {
            this.writeByte(0xe0 | (codeUnit >>> 12));
            this.writeByte(0x80 | ((codeUnit >>> 6) & 0x3f));
            this.writeByte(0x80 | (codeUnit & 0x3f));
          }
      }
    }
    this.writeByte(0x22);
  }

  nullableString(value: string | null): void {
    if (value === null) this.ascii('null');
    else this.string(value);
  }

  integer(value: number): void {
    assertCanonicalInteger(value, 'JSON integer', true);
    if (value === 0) {
      this.writeByte(0x30);
      return;
    }
    let divisor = 1;
    while (Math.floor(value / divisor) >= 10) divisor *= 10;
    while (divisor >= 1) {
      this.writeByte(0x30 + Math.floor(value / divisor) % 10);
      divisor /= 10;
    }
  }

  finish(): Uint8Array {
    if (this.offset !== this.bytes.byteLength) {
      throw new CanonicalJsonError('Canonical UTF-8 byte count did not match serialization');
    }
    return this.bytes;
  }

  private writeEscape(codeUnit: number): void {
    this.writeByte(0x5c);
    this.writeByte(codeUnit);
  }

  private writeByte(value: number): void {
    if (this.offset >= this.bytes.byteLength) {
      throw new CanonicalJsonError('Canonical UTF-8 buffer was undersized');
    }
    this.bytes[this.offset] = value;
    this.offset += 1;
  }
}

function hexDigit(value: number): number {
  return value < 10 ? 0x30 + value : 0x61 + value - 10;
}

function canonicalIntegerDigitLength(value: number): number {
  let digits = 1;
  let remaining = value;
  while (remaining >= 10) {
    remaining = Math.floor(remaining / 10);
    digits += 1;
  }
  return digits;
}

function countSnapshotTokens(snapshot: VodExportSnapshot, counter: CanonicalTokenSink): void {
  assertExactKeys(snapshot, ['schemaVersion', 'streamers'], 'snapshot');
  if (snapshot.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION) {
    throw new CanonicalJsonError(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!Array.isArray(snapshot.streamers)) throw new CanonicalJsonError('snapshot.streamers must be an array');

  counter.ascii('{"schemaVersion":');
  counter.string(snapshot.schemaVersion);
  counter.ascii(',"streamers":[');
  for (let index = 0; index < snapshot.streamers.length; index += 1) {
    if (index > 0) counter.ascii(',');
    const streamer = snapshot.streamers[index];
    if (streamer === undefined) throw new CanonicalJsonError('snapshot.streamers contains a missing item');
    countStreamerTokens(streamer, counter);
  }
  counter.ascii(']}');
}

function countStreamerTokens(streamer: VodExportStreamer, counter: CanonicalTokenSink): void {
  assertExactKeys(
    streamer,
    ['slug', 'displayName', 'youtubeChannelId', 'avatarUrl', 'group', 'socialLinks', 'vods'],
    'streamer',
  );
  if (!Array.isArray(streamer.vods)) throw new CanonicalJsonError('streamer.vods must be an array');

  counter.ascii('{"slug":');
  counter.string(streamer.slug);
  counter.ascii(',"displayName":');
  counter.string(streamer.displayName);
  counter.ascii(',"youtubeChannelId":');
  counter.string(streamer.youtubeChannelId);
  counter.ascii(',"avatarUrl":');
  counter.nullableString(streamer.avatarUrl);
  counter.ascii(',"group":');
  counter.nullableString(streamer.group);
  counter.ascii(',"socialLinks":');
  countSocialLinksTokens(streamer.socialLinks, counter);
  counter.ascii(',"vods":[');
  for (let index = 0; index < streamer.vods.length; index += 1) {
    if (index > 0) counter.ascii(',');
    const vod = streamer.vods[index];
    if (vod === undefined) throw new CanonicalJsonError('streamer.vods contains a missing item');
    countVodTokens(vod, counter);
  }
  counter.ascii(']}');
}

function countSocialLinksTokens(socialLinks: VodExportSocialLinks, counter: CanonicalTokenSink): void {
  assertSocialLinksObject(socialLinks);
  counter.ascii('{');
  let emitted = 0;
  for (const provider of SOCIAL_PROVIDERS) {
    const value = socialLinks[provider];
    if (value === undefined) continue;
    if (emitted > 0) counter.ascii(',');
    counter.string(provider);
    counter.ascii(':');
    counter.string(value);
    emitted += 1;
  }
  counter.ascii('}');
}

function countVodTokens(vod: VodExportVod, counter: CanonicalTokenSink): void {
  assertVodObject(vod);
  counter.ascii('{"title":');
  counter.string(vod.title);
  counter.ascii(',"date":');
  counter.string(vod.date);
  counter.ascii(',"videoId":');
  counter.string(vod.videoId);
  counter.ascii(',"performances":[');
  for (let index = 0; index < vod.performances.length; index += 1) {
    if (index > 0) counter.ascii(',');
    const performance = vod.performances[index];
    if (performance === undefined) throw new CanonicalJsonError('vod.performances contains a missing item');
    countPerformanceTokens(performance, counter);
  }
  counter.ascii(']}');
}

function countPerformanceTokens(performance: VodExportPerformance, counter: CanonicalTokenSink): void {
  assertPerformanceObject(performance);
  counter.ascii('{"performanceId":');
  counter.string(performance.performanceId);
  counter.ascii(',"songId":');
  counter.string(performance.songId);
  counter.ascii(',"title":');
  counter.string(performance.title);
  counter.ascii(',"originalArtist":');
  counter.nullableString(performance.originalArtist);
  counter.ascii(',"startSeconds":');
  counter.integer(performance.startSeconds);
  counter.ascii(',"endSeconds":');
  counter.integer(performance.endSeconds);
  counter.ascii('}');
}

/** Trusted fast path for the freshly validated, exclusively owned snapshot. */
function writeOwnedSnapshotTokens(snapshot: VodExportSnapshot, sink: CanonicalTokenSink): void {
  sink.ascii('{"schemaVersion":');
  sink.string(snapshot.schemaVersion);
  sink.ascii(',"streamers":[');
  for (let streamerIndex = 0; streamerIndex < snapshot.streamers.length; streamerIndex += 1) {
    if (streamerIndex > 0) sink.ascii(',');
    const streamer = snapshot.streamers[streamerIndex];
    if (streamer === undefined) throw new CanonicalJsonError('Owned snapshot contains a missing streamer');
    sink.ascii('{"slug":');
    sink.string(streamer.slug);
    sink.ascii(',"displayName":');
    sink.string(streamer.displayName);
    sink.ascii(',"youtubeChannelId":');
    sink.string(streamer.youtubeChannelId);
    sink.ascii(',"avatarUrl":');
    sink.nullableString(streamer.avatarUrl);
    sink.ascii(',"group":');
    sink.nullableString(streamer.group);
    sink.ascii(',"socialLinks":{');
    let emittedSocialLinks = 0;
    for (const provider of SOCIAL_PROVIDERS) {
      const value = streamer.socialLinks[provider];
      if (value === undefined) continue;
      if (emittedSocialLinks > 0) sink.ascii(',');
      sink.string(provider);
      sink.ascii(':');
      sink.string(value);
      emittedSocialLinks += 1;
    }
    sink.ascii('},"vods":[');
    for (let vodIndex = 0; vodIndex < streamer.vods.length; vodIndex += 1) {
      if (vodIndex > 0) sink.ascii(',');
      const vod = streamer.vods[vodIndex];
      if (vod === undefined) throw new CanonicalJsonError('Owned snapshot contains a missing VOD');
      sink.ascii('{"title":');
      sink.string(vod.title);
      sink.ascii(',"date":');
      sink.string(vod.date);
      sink.ascii(',"videoId":');
      sink.string(vod.videoId);
      sink.ascii(',"performances":[');
      for (let performanceIndex = 0; performanceIndex < vod.performances.length; performanceIndex += 1) {
        if (performanceIndex > 0) sink.ascii(',');
        const performance = vod.performances[performanceIndex];
        if (performance === undefined) {
          throw new CanonicalJsonError('Owned snapshot contains a missing performance');
        }
        sink.ascii('{"performanceId":');
        sink.string(performance.performanceId);
        sink.ascii(',"songId":');
        sink.string(performance.songId);
        sink.ascii(',"title":');
        sink.string(performance.title);
        sink.ascii(',"originalArtist":');
        sink.nullableString(performance.originalArtist);
        sink.ascii(',"startSeconds":');
        sink.integer(performance.startSeconds);
        sink.ascii(',"endSeconds":');
        sink.integer(performance.endSeconds);
        sink.ascii('}');
      }
      sink.ascii(']}');
    }
    sink.ascii(']}');
  }
  sink.ascii(']}');
}

function* snapshotTokens(snapshot: VodExportSnapshot): Generator<string> {
  assertExactKeys(snapshot, ['schemaVersion', 'streamers'], 'snapshot');
  if (snapshot.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION) {
    throw new CanonicalJsonError(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!Array.isArray(snapshot.streamers)) throw new CanonicalJsonError('snapshot.streamers must be an array');

  yield '{"schemaVersion":';
  yield serializeCanonicalString(snapshot.schemaVersion);
  yield ',"streamers":[';
  for (let index = 0; index < snapshot.streamers.length; index += 1) {
    if (index > 0) yield ',';
    const streamer = snapshot.streamers[index];
    if (streamer === undefined) throw new CanonicalJsonError('snapshot.streamers contains a missing item');
    yield* streamerTokens(streamer);
  }
  yield ']}';
}

function* manifestTokens(manifest: VodExportManifest): Generator<string> {
  yield '{"schemaVersion":';
  yield serializeCanonicalString(manifest.schemaVersion);
  yield ',"snapshotUrl":';
  yield serializeCanonicalString(manifest.snapshotUrl);
  yield ',"sha256":';
  yield serializeCanonicalString(manifest.sha256);
  yield ',"publishedAt":';
  yield serializeCanonicalString(manifest.publishedAt);
  yield ',"uncompressedBytes":';
  yield serializeCanonicalInteger(manifest.uncompressedBytes);
  yield ',"counts":{"streamers":';
  yield serializeCanonicalInteger(manifest.counts.streamers);
  yield ',"vods":';
  yield serializeCanonicalInteger(manifest.counts.vods);
  yield ',"performances":';
  yield serializeCanonicalInteger(manifest.counts.performances);
  yield '}}';
}

function* streamerTokens(streamer: VodExportStreamer): Generator<string> {
  assertExactKeys(
    streamer,
    ['slug', 'displayName', 'youtubeChannelId', 'avatarUrl', 'group', 'socialLinks', 'vods'],
    'streamer',
  );
  if (!Array.isArray(streamer.vods)) throw new CanonicalJsonError('streamer.vods must be an array');

  yield '{"slug":';
  yield serializeCanonicalString(streamer.slug);
  yield ',"displayName":';
  yield serializeCanonicalString(streamer.displayName);
  yield ',"youtubeChannelId":';
  yield serializeCanonicalString(streamer.youtubeChannelId);
  yield ',"avatarUrl":';
  yield serializeNullableString(streamer.avatarUrl);
  yield ',"group":';
  yield serializeNullableString(streamer.group);
  yield ',"socialLinks":';
  yield* socialLinksTokens(streamer.socialLinks);
  yield ',"vods":[';
  for (let index = 0; index < streamer.vods.length; index += 1) {
    if (index > 0) yield ',';
    const vod = streamer.vods[index];
    if (vod === undefined) throw new CanonicalJsonError('streamer.vods contains a missing item');
    yield* vodTokens(vod);
  }
  yield ']}';
}

function* socialLinksTokens(socialLinks: VodExportSocialLinks): Generator<string> {
  assertSocialLinksObject(socialLinks);

  yield '{';
  let emitted = 0;
  for (const provider of SOCIAL_PROVIDERS) {
    const value = socialLinks[provider];
    if (value === undefined) continue;
    if (emitted > 0) yield ',';
    yield serializeCanonicalString(provider);
    yield ':';
    yield serializeCanonicalString(value);
    emitted += 1;
  }
  yield '}';
}

function* vodTokens(vod: VodExportVod): Generator<string> {
  assertVodObject(vod);

  yield '{"title":';
  yield serializeCanonicalString(vod.title);
  yield ',"date":';
  yield serializeCanonicalString(vod.date);
  yield ',"videoId":';
  yield serializeCanonicalString(vod.videoId);
  yield ',"performances":[';
  for (let index = 0; index < vod.performances.length; index += 1) {
    if (index > 0) yield ',';
    const performance = vod.performances[index];
    if (performance === undefined) throw new CanonicalJsonError('vod.performances contains a missing item');
    yield* performanceTokens(performance);
  }
  yield ']}';
}

function* performanceTokens(performance: VodExportPerformance): Generator<string> {
  assertPerformanceObject(performance);

  yield '{"performanceId":';
  yield serializeCanonicalString(performance.performanceId);
  yield ',"songId":';
  yield serializeCanonicalString(performance.songId);
  yield ',"title":';
  yield serializeCanonicalString(performance.title);
  yield ',"originalArtist":';
  yield serializeNullableString(performance.originalArtist);
  yield ',"startSeconds":';
  yield serializeCanonicalInteger(performance.startSeconds);
  yield ',"endSeconds":';
  yield serializeCanonicalInteger(performance.endSeconds);
  yield '}';
}

function assertSocialLinksObject(socialLinks: VodExportSocialLinks): void {
  if (socialLinks === null || typeof socialLinks !== 'object' || Array.isArray(socialLinks)) {
    throw new CanonicalJsonError('streamer.socialLinks must be an object');
  }
  const unknownKeys = Object.keys(socialLinks).filter(
    (key) => !(SOCIAL_PROVIDERS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) throw new CanonicalJsonError('streamer.socialLinks contains an unknown provider');
}

function assertVodObject(vod: VodExportVod): void {
  assertExactKeys(vod, ['title', 'date', 'videoId', 'performances'], 'vod');
  if (!Array.isArray(vod.performances)) throw new CanonicalJsonError('vod.performances must be an array');
  if (vod.performances.length === 0) throw new CanonicalJsonError('Exported VODs must have at least one performance');
}

function assertPerformanceObject(performance: VodExportPerformance): void {
  assertExactKeys(
    performance,
    ['performanceId', 'songId', 'title', 'originalArtist', 'startSeconds', 'endSeconds'],
    'performance',
  );
  assertCanonicalInteger(performance.startSeconds, 'performance.startSeconds', true);
  assertCanonicalInteger(performance.endSeconds, 'performance.endSeconds', true);
  if (performance.endSeconds <= performance.startSeconds) {
    throw new CanonicalJsonError('performance.endSeconds must be greater than startSeconds');
  }
}

function encodeCanonicalTokens(
  factory: () => Iterable<string>,
  expectedByteLength?: number,
): Uint8Array {
  let byteLength = expectedByteLength;
  if (byteLength === undefined) {
    byteLength = 0;
    for (const token of factory()) {
      byteLength += utf8ByteLength(token);
      if (!Number.isSafeInteger(byteLength)) throw new CanonicalJsonError('Canonical JSON byte length is unsafe');
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const token of factory()) {
    const result = textEncoder.encodeInto(token, bytes.subarray(offset));
    if (result.read !== token.length) throw new CanonicalJsonError('Canonical UTF-8 buffer was undersized');
    offset += result.written;
  }
  if (offset !== byteLength) throw new CanonicalJsonError('Canonical UTF-8 byte count did not match serialization');
  return bytes;
}

function serializeNullableString(value: string | null): string {
  return value === null ? 'null' : serializeCanonicalString(value);
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
  if (!SHA256_PATTERN.test(value)) throw new CanonicalJsonError('sha256 must be exactly 64 lowercase hexadecimal characters');
}

function isExactPublishedAt(value: string): boolean {
  if (!PUBLISHED_AT_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
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

function assertExactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    throw new CanonicalJsonError(`${label} must contain exactly the v1 contract properties`);
  }
}

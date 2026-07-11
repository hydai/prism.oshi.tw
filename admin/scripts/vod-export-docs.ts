import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  INVALID_NORMALIZED_DISPLAY_TEXT,
  compareUtf8Ordinal,
  hasValidUnicodeScalars,
  isBlankText,
  normalizeDisplayTextValue,
  validateOptionalSafeUrl,
  type UrlProvider,
} from '../src/vod-export/normalization';
import type {
  VodExportCounts,
  VodExportManifest,
  VodExportSnapshot,
} from '../src/vod-export/types';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = resolve(SCRIPT_DIR, '..');
const REPOSITORY_ROOT = resolve(ADMIN_DIR, '..');
const WRANGLER_BIN = resolve(ADMIN_DIR, 'node_modules', '.bin', 'wrangler');

export const VOD_EXPORT_PUBLIC_ORIGIN = 'https://data.oshi.tw';
export const VOD_EXPORT_PUBLIC_BUCKET = 'prism-vod-export-public';
export const VOD_EXPORT_MANIFEST_URL = `${VOD_EXPORT_PUBLIC_ORIGIN}/vod/v1/manifest.json`;
export const VOD_EXPORT_GUIDE_URL = `${VOD_EXPORT_PUBLIC_ORIGIN}/vod/v1/guide.md`;
export const VOD_EXPORT_MANIFEST_SCHEMA_URL =
  `${VOD_EXPORT_PUBLIC_ORIGIN}/vod/v1/schemas/1.0.0/manifest.schema.json`;
export const VOD_EXPORT_SNAPSHOT_SCHEMA_URL =
  `${VOD_EXPORT_PUBLIC_ORIGIN}/vod/v1/schemas/1.0.0/snapshot.schema.json`;

const MAX_MANIFEST_BYTES = 65_536;
const MAX_SNAPSHOT_BYTES = 10_485_760;
const MAX_PUBLIC_DOC_BYTES = 1_048_576;

export interface PublicDocumentationArtifact {
  readonly key: string;
  readonly sourcePath: string;
  readonly publicUrl: string;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly immutable: boolean;
}

export const PUBLIC_DOCUMENTATION_ARTIFACTS: readonly PublicDocumentationArtifact[] = [
  {
    key: 'vod/v1/schemas/1.0.0/manifest.schema.json',
    sourcePath: resolve(
      REPOSITORY_ROOT,
      'docs/vod-export-schemas/1.0.0/manifest.schema.json',
    ),
    publicUrl: VOD_EXPORT_MANIFEST_SCHEMA_URL,
    contentType: 'application/schema+json; charset=utf-8',
    cacheControl: 'public, max-age=31536000, immutable',
    immutable: true,
  },
  {
    key: 'vod/v1/schemas/1.0.0/snapshot.schema.json',
    sourcePath: resolve(
      REPOSITORY_ROOT,
      'docs/vod-export-schemas/1.0.0/snapshot.schema.json',
    ),
    publicUrl: VOD_EXPORT_SNAPSHOT_SCHEMA_URL,
    contentType: 'application/schema+json; charset=utf-8',
    cacheControl: 'public, max-age=31536000, immutable',
    immutable: true,
  },
  {
    key: 'vod/v1/guide.md',
    sourcePath: resolve(REPOSITORY_ROOT, 'docs/vod-export-consumer-guide.md'),
    publicUrl: VOD_EXPORT_GUIDE_URL,
    contentType: 'text/markdown; charset=utf-8',
    cacheControl: 'public, max-age=3600, stale-if-error=86400',
    immutable: false,
  },
] as const;

type PublicManifest = Omit<VodExportManifest, 'schemaVersion'> & { schemaVersion: string };
type PublicSnapshot = Omit<VodExportSnapshot, 'schemaVersion'> & { schemaVersion: string };

export interface PublicSchemaValidators {
  manifest: ValidateFunction<PublicManifest>;
  snapshot: ValidateFunction<PublicSnapshot>;
}

export interface LiveVerificationSummary {
  schemaVersion: string;
  sha256: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
}

export async function loadPublicSchemaValidators(): Promise<PublicSchemaValidators> {
  const [manifestSchema, snapshotSchema] = await Promise.all([
    readJsonFile(PUBLIC_DOCUMENTATION_ARTIFACTS[0].sourcePath),
    readJsonFile(PUBLIC_DOCUMENTATION_ARTIFACTS[1].sourcePath),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv);
  return {
    manifest: ajv.compile<PublicManifest>(manifestSchema),
    snapshot: ajv.compile<PublicSnapshot>(snapshotSchema),
  };
}

export async function verifyLocalDocumentationArtifacts(): Promise<PublicSchemaValidators> {
  const validators = await loadPublicSchemaValidators();
  const guide = await readFile(
    PUBLIC_DOCUMENTATION_ARTIFACTS[2].sourcePath,
    'utf8',
  );
  for (const requiredUrl of [
    VOD_EXPORT_MANIFEST_URL,
    VOD_EXPORT_MANIFEST_SCHEMA_URL,
    VOD_EXPORT_SNAPSHOT_SCHEMA_URL,
  ]) {
    if (!guide.includes(requiredUrl)) {
      throw new Error(`Public consumer guide does not link ${requiredUrl}`);
    }
  }
  if (guide.includes('](../') || guide.includes('](vod-export-rollout.md)')) {
    throw new Error('Public consumer guide contains a repository-relative Markdown link');
  }
  return validators;
}

export function assertPublicDocumentPair(
  validators: PublicSchemaValidators,
  manifestValue: unknown,
  snapshotValue: unknown,
  snapshotBytes?: Uint8Array,
): asserts manifestValue is PublicManifest {
  assertSchema(validators.manifest, manifestValue, 'manifest');
  assertSchema(validators.snapshot, snapshotValue, 'snapshot');

  const manifest = manifestValue;
  const snapshot = snapshotValue;
  if (manifest.schemaVersion !== snapshot.schemaVersion) {
    throw new Error('Manifest and snapshot schemaVersion values differ');
  }
  assertTrustedSnapshotUrl(manifest);

  if (snapshotBytes !== undefined) {
    if (snapshotBytes.byteLength !== manifest.uncompressedBytes) {
      throw new Error('Snapshot decoded byte length does not match the manifest');
    }
    const digest = createHash('sha256').update(snapshotBytes).digest('hex');
    if (digest !== manifest.sha256) {
      throw new Error('Snapshot SHA-256 does not match the manifest');
    }
  }

  assertAllStringsWellFormed(snapshot, 'snapshot');
  assertSnapshotSemantics(snapshot, manifest.counts);
}

export async function verifyLiveVodExport(
  validators?: PublicSchemaValidators,
): Promise<LiveVerificationSummary> {
  const activeValidators = validators ?? await verifyLocalDocumentationArtifacts();
  const manifestResponse = await fetch(VOD_EXPORT_MANIFEST_URL, { redirect: 'error' });
  assertPublicResponse(manifestResponse, 'manifest', 'application/json');
  const manifestBytes = await readResponseBytes(
    manifestResponse,
    MAX_MANIFEST_BYTES,
    'manifest',
  );
  const manifest = parseCanonicalJson(manifestBytes, 'manifest');
  assertSchema(activeValidators.manifest, manifest, 'manifest');
  assertTrustedSnapshotUrl(manifest);

  const snapshotResponse = await fetch(manifest.snapshotUrl, { redirect: 'error' });
  assertPublicResponse(snapshotResponse, 'snapshot', 'application/json');
  const snapshotBytes = await readResponseBytes(
    snapshotResponse,
    MAX_SNAPSHOT_BYTES,
    'snapshot',
  );
  const snapshot = parseCanonicalJson(snapshotBytes, 'snapshot');
  assertPublicDocumentPair(activeValidators, manifest, snapshot, snapshotBytes);

  return {
    schemaVersion: manifest.schemaVersion,
    sha256: manifest.sha256,
    uncompressedBytes: manifest.uncompressedBytes,
    counts: manifest.counts,
  };
}

function assertTrustedSnapshotUrl(manifest: PublicManifest): void {
  const expectedSnapshotUrl =
    `${VOD_EXPORT_PUBLIC_ORIGIN}/vod/v1/snapshots/${manifest.sha256}.json`;
  if (manifest.snapshotUrl !== expectedSnapshotUrl) {
    throw new Error(
      'Manifest snapshotUrl must use the trusted origin and adjacent sha256 path',
    );
  }
}

export async function verifyPublishedDocumentationArtifacts(): Promise<LiveVerificationSummary> {
  const validators = await verifyLocalDocumentationArtifacts();
  for (const artifact of PUBLIC_DOCUMENTATION_ARTIFACTS) {
    const expectedBytes = new Uint8Array(await readFile(artifact.sourcePath));
    const response = await fetch(artifact.publicUrl, { redirect: 'error' });
    assertPublicDocumentationResponseMetadata(response, artifact);
    if (response.headers.get('cache-control') !== artifact.cacheControl) {
      throw new Error(
        `${artifact.publicUrl} has unexpected Cache-Control: `
        + `${response.headers.get('cache-control') ?? '<missing>'}`,
      );
    }
    const actualBytes = await readResponseBytes(
      response,
      MAX_PUBLIC_DOC_BYTES,
      artifact.key,
    );
    if (!bytesEqual(actualBytes, expectedBytes)) {
      throw new Error(
        `${artifact.publicUrl} does not match the source-controlled artifact; `
        + 'purge that exact URL if Cloudflare is serving a prior cached version',
      );
    }
  }
  return verifyLiveVodExport(validators);
}

export async function publishDocumentationArtifacts(): Promise<LiveVerificationSummary> {
  await verifyLocalDocumentationArtifacts();

  for (const artifact of PUBLIC_DOCUMENTATION_ARTIFACTS) {
    const localBytes = new Uint8Array(await readFile(artifact.sourcePath));
    const remoteBytes = readRemoteR2Object(artifact.key);
    if (remoteBytes !== null && bytesEqual(remoteBytes, localBytes)) {
      if (artifact.immutable) {
        console.log(`unchanged ${artifact.key}`);
        continue;
      }
      console.log(`refreshing mutable metadata for ${artifact.key}`);
    }
    if (remoteBytes !== null && artifact.immutable) {
      throw new Error(`Refusing to overwrite immutable schema ${artifact.key}`);
    }

    runWrangler([
      'r2',
      'object',
      'put',
      `${VOD_EXPORT_PUBLIC_BUCKET}/${artifact.key}`,
      '--remote',
      '--file',
      artifact.sourcePath,
      '--content-type',
      artifact.contentType,
      '--cache-control',
      artifact.cacheControl,
      '--force',
    ]);
    console.log(`published ${artifact.key}`);

    const storedBytes = readRemoteR2Object(artifact.key);
    if (storedBytes === null || !bytesEqual(storedBytes, localBytes)) {
      throw new Error(`R2 read-back mismatch for ${artifact.key}`);
    }
  }

  return verifyPublishedDocumentationArtifacts();
}

export function assertPublicDocumentationResponseMetadata(
  response: Response,
  artifact: PublicDocumentationArtifact,
): void {
  assertPublicResponse(
    response,
    artifact.key,
    artifact.contentType.split(';', 1)[0] ?? artifact.contentType,
  );
  const actualContentType = response.headers.get('content-type');
  if (actualContentType !== artifact.contentType) {
    throw new Error(
      `${artifact.publicUrl} has unexpected Content-Type: ${actualContentType ?? '<missing>'}; `
      + `expected ${artifact.contentType}`,
    );
  }
  const contentDisposition = response.headers.get('content-disposition');
  if (contentDisposition !== null) {
    throw new Error(
      `${artifact.publicUrl} must not have Content-Disposition: ${contentDisposition}`,
    );
  }
}

function assertSnapshotSemantics(snapshot: PublicSnapshot, expectedCounts: VodExportCounts): void {
  const streamerSlugs = new Set<string>();
  const youtubeChannelIds = new Set<string>();
  const performanceIds = new Set<string>();
  let vodCount = 0;
  let performanceCount = 0;

  for (let streamerIndex = 0; streamerIndex < snapshot.streamers.length; streamerIndex += 1) {
    const streamer = snapshot.streamers[streamerIndex];
    if (streamerSlugs.has(streamer.slug)) throw new Error(`Duplicate streamer slug: ${streamer.slug}`);
    streamerSlugs.add(streamer.slug);
    if (youtubeChannelIds.has(streamer.youtubeChannelId)) {
      throw new Error(`Duplicate youtubeChannelId on streamer ${streamer.slug}`);
    }
    if (isBlankText(streamer.youtubeChannelId)) {
      throw new Error(`Blank youtubeChannelId on streamer ${streamer.slug}`);
    }
    youtubeChannelIds.add(streamer.youtubeChannelId);
    if (streamerIndex > 0 && compareUtf8Ordinal(
      snapshot.streamers[streamerIndex - 1].slug,
      streamer.slug,
    ) >= 0) {
      throw new Error('Streamers are not ordered by slug ascending');
    }

    assertDisplayText(streamer.displayName, false, `${streamer.slug}.displayName`);
    assertDisplayText(streamer.group, true, `${streamer.slug}.group`);
    if (streamer.avatarUrl !== null) {
      assertSafePublicUrl(streamer.avatarUrl, 'avatar', `${streamer.slug}.avatarUrl`);
    }
    for (const [provider, url] of Object.entries(streamer.socialLinks)) {
      if (isKnownProvider(provider)) {
        assertSafePublicUrl(url, provider, `${streamer.slug}.socialLinks.${provider}`);
      }
    }

    const videoIds = new Set<string>();
    for (let vodIndex = 0; vodIndex < streamer.vods.length; vodIndex += 1) {
      const vod = streamer.vods[vodIndex];
      vodCount += 1;
      if (videoIds.has(vod.videoId)) {
        throw new Error(`Duplicate scoped videoId ${streamer.slug}/${vod.videoId}`);
      }
      videoIds.add(vod.videoId);
      assertDisplayText(vod.title, false, `${streamer.slug}/${vod.videoId}.title`);
      if (vodIndex > 0 && compareVods(streamer.vods[vodIndex - 1], vod) >= 0) {
        throw new Error(`VODs are not ordered for streamer ${streamer.slug}`);
      }

      for (
        let performanceIndex = 0;
        performanceIndex < vod.performances.length;
        performanceIndex += 1
      ) {
        const performance = vod.performances[performanceIndex];
        performanceCount += 1;
        if (performanceIds.has(performance.performanceId)) {
          throw new Error(`Duplicate performanceId: ${performance.performanceId}`);
        }
        if (isBlankText(performance.performanceId) || isBlankText(performance.songId)) {
          throw new Error(`Blank opaque identity on ${performance.performanceId}`);
        }
        performanceIds.add(performance.performanceId);
        if (performance.endSeconds <= performance.startSeconds) {
          throw new Error(`Invalid timestamp range on ${performance.performanceId}`);
        }
        assertDisplayText(
          performance.title,
          false,
          `${performance.performanceId}.title`,
        );
        assertDisplayText(
          performance.originalArtist,
          true,
          `${performance.performanceId}.originalArtist`,
        );
        if (
          performanceIndex > 0
          && comparePerformances(vod.performances[performanceIndex - 1], performance) >= 0
        ) {
          throw new Error(`Performances are not ordered in ${streamer.slug}/${vod.videoId}`);
        }
      }
    }
  }

  if (vodCount > 10_000 || performanceCount > 50_000) {
    throw new Error('Snapshot exceeds global v1 collection limits');
  }
  const actualCounts: VodExportCounts = {
    streamers: snapshot.streamers.length,
    vods: vodCount,
    performances: performanceCount,
  };
  if (
    actualCounts.streamers !== expectedCounts.streamers
    || actualCounts.vods !== expectedCounts.vods
    || actualCounts.performances !== expectedCounts.performances
  ) {
    throw new Error('Snapshot counts do not match the manifest');
  }
}

function assertDisplayText(value: string | null, nullable: boolean, label: string): void {
  if (value === null) {
    if (!nullable) throw new Error(`${label} cannot be null`);
    return;
  }
  const normalized = normalizeDisplayTextValue(value);
  if (normalized === INVALID_NORMALIZED_DISPLAY_TEXT || normalized !== value) {
    throw new Error(`${label} is not normalized display text`);
  }
}

function assertSafePublicUrl(value: string, provider: UrlProvider, label: string): void {
  const result = validateOptionalSafeUrl(value, provider);
  if (result.kind !== 'safe' || result.url !== value) {
    throw new Error(`${label} is not an approved canonical public URL`);
  }
}

function assertAllStringsWellFormed(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (!hasValidUnicodeScalars(value)) throw new Error(`${path} contains invalid Unicode`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAllStringsWellFormed(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (!hasValidUnicodeScalars(key)) throw new Error(`${path} has an invalid Unicode key`);
      assertAllStringsWellFormed(entry, `${path}.${key}`);
    }
  }
}

function compareVods(
  left: PublicSnapshot['streamers'][number]['vods'][number],
  right: PublicSnapshot['streamers'][number]['vods'][number],
): number {
  if (left.date !== right.date) return left.date > right.date ? -1 : 1;
  return compareUtf8Ordinal(left.videoId, right.videoId);
}

function comparePerformances(
  left: PublicSnapshot['streamers'][number]['vods'][number]['performances'][number],
  right: PublicSnapshot['streamers'][number]['vods'][number]['performances'][number],
): number {
  if (left.startSeconds !== right.startSeconds) {
    return left.startSeconds - right.startSeconds;
  }
  return compareUtf8Ordinal(left.performanceId, right.performanceId);
}

function isKnownProvider(value: string): value is Exclude<UrlProvider, 'avatar'> {
  return value === 'youtube'
    || value === 'twitter'
    || value === 'facebook'
    || value === 'instagram'
    || value === 'twitch';
}

function assertSchema<T>(
  validator: ValidateFunction<T>,
  value: unknown,
  label: string,
): asserts value is T {
  if (!validator(value)) {
    throw new Error(`${label} schema validation failed: ${formatAjvErrors(validator.errors)}`);
  }
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? error.keyword}`)
    .join('; ');
}

async function readJsonFile(path: string): Promise<AnySchema> {
  return JSON.parse(await readFile(path, 'utf8')) as AnySchema;
}

function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${label} contains a forbidden UTF-8 BOM`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  if (JSON.stringify(parsed) !== text) {
    throw new Error(`${label} is not compact canonical JSON`);
  }
  return parsed;
}

function assertPublicResponse(response: Response, label: string, expectedMediaType: string): void {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== expectedMediaType) {
    throw new Error(`${label} returned unexpected Content-Type: ${mediaType ?? '<missing>'}`);
  }
}

async function readResponseBytes(
  response: Response,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  if (response.body === null) throw new Error(`${label} response has no body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error(`${label} exceeds ${limit} decoded bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readRemoteR2Object(key: string): Uint8Array | null {
  const result = spawnSync(
    WRANGLER_BIN,
    [
      'r2',
      'object',
      'get',
      `${VOD_EXPORT_PUBLIC_BUCKET}/${key}`,
      '--remote',
      '--pipe',
    ],
    { cwd: ADMIN_DIR, encoding: null, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status === 0) return new Uint8Array(result.stdout);
  const errorText = `${result.stdout.toString('utf8')}\n${result.stderr.toString('utf8')}`;
  if (errorText.includes('The specified key does not exist')) return null;
  throw new Error(`Unable to read R2 object ${key}: ${errorText.trim()}`);
}

function runWrangler(args: readonly string[]): void {
  const result = spawnSync(WRANGLER_BIN, args, {
    cwd: ADMIN_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Wrangler failed: ${result.stderr || result.stdout}`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'verify-local';
  if (command === 'verify-local') {
    await verifyLocalDocumentationArtifacts();
    console.log('VOD export documentation sources and schemas are valid.');
    return;
  }
  if (command === 'verify-public') {
    const summary = await verifyPublishedDocumentationArtifacts();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (command === 'publish') {
    const summary = await publishDocumentationArtifacts();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

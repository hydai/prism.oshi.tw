import {
  VodExportCandidateError,
  candidateMetadataKey,
  getCandidate,
  storeCandidate,
} from './candidate';
import { createSnapshotArtifact, serializeCanonicalManifest, snapshotUrlForHash } from './canonical-json';
import {
  GENERATION_CONTROL_KEY,
  PUBLICATION_CONTROL_KEY,
  acquireGenerationControl,
  acquirePublicationControl,
  preparePublicationControl,
  readPublicationControl,
  releaseGenerationControl,
  releasePublicationControl,
  type PreparedPublicationAudit,
} from './control';
import {
  VOD_EXPORT_MANIFEST_KEY,
  VOD_EXPORT_SCHEMA_VERSION,
} from './constants';
import {
  VOD_EXPORT_MANUAL_RECOVERY_CONFIRMATION,
  VodExportPublicationError,
  inspectVodExportControlRecoveryState,
  manuallyRecoverVodExportControl,
  readCurrentManifest,
  reconcileVodExportPublication,
} from './publication';
import { PUBLIC_MANIFEST_HTTP_METADATA } from './r2';
import type { VodExportSourceFingerprint } from './source';

declare const process: { exitCode?: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FIXED_NOW = new Date('2026-07-11T12:00:00.000Z');
const CANDIDATE_ID = '10000000-0000-4000-8000-000000000001';

interface FakePutOptions {
  onlyIf?: Headers | { etagMatches?: string };
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  sha256?: string | ArrayBuffer;
}

interface FakeStoredObject {
  key: string;
  bytes: Uint8Array;
  etag: string;
  uploaded: Date;
  httpMetadata: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

/**
 * A deliberately small R2 model for the invariants exercised here:
 * conditional puts return null on an explicit precondition failure, while an
 * injected ambiguous failure commits the bytes before throwing to the caller.
 */
class FakeR2Bucket {
  private readonly objects = new Map<string, FakeStoredObject>();
  private readonly throwAfterCommit = new Map<string, number>();
  private etagSequence = 0;

  asBucket(): R2Bucket {
    return this as unknown as R2Bucket;
  }

  injectCommitThenThrow(key: string, count = 1): void {
    this.throwAfterCommit.set(key, count);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.bodyView(stored);
  }

  async head(key: string): Promise<R2Object | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.objectView(stored);
  }

  async put(
    key: string,
    value: Uint8Array | ArrayBuffer | string,
    options: FakePutOptions = {},
  ): Promise<R2Object | null> {
    const current = this.objects.get(key);
    if (!conditionMatches(options.onlyIf, current)) return null;

    const stored: FakeStoredObject = {
      key,
      bytes: toBytes(value),
      etag: this.nextEtag(),
      uploaded: new Date(FIXED_NOW),
      httpMetadata: { ...(options.httpMetadata ?? {}) },
      ...(options.customMetadata === undefined
        ? {}
        : { customMetadata: { ...options.customMetadata } }),
    };
    this.objects.set(key, stored);

    const failuresLeft = this.throwAfterCommit.get(key) ?? 0;
    if (failuresLeft > 0) {
      if (failuresLeft === 1) this.throwAfterCommit.delete(key);
      else this.throwAfterCommit.set(key, failuresLeft - 1);
      throw new Error(`Injected commit-then-throw for ${key}`);
    }
    return this.objectView(stored);
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key);
  }

  /** Simulates an equivalent competing rewrite, making an owned ETag stale. */
  touch(key: string): void {
    const current = this.requireStored(key);
    this.objects.set(key, {
      ...current,
      bytes: current.bytes.slice(),
      etag: this.nextEtag(),
      uploaded: new Date(FIXED_NOW),
    });
  }

  mutateJson(key: string, mutate: (value: Record<string, unknown>) => Record<string, unknown>): void {
    const current = this.requireStored(key);
    const parsed = JSON.parse(decoder.decode(current.bytes)) as Record<string, unknown>;
    this.objects.set(key, {
      ...current,
      bytes: encoder.encode(JSON.stringify(mutate(parsed))),
      etag: this.nextEtag(),
      uploaded: new Date(FIXED_NOW),
    });
  }

  readJson(key: string): Record<string, unknown> {
    return JSON.parse(decoder.decode(this.requireStored(key).bytes)) as Record<string, unknown>;
  }

  private requireStored(key: string): FakeStoredObject {
    const stored = this.objects.get(key);
    if (stored === undefined) throw new Error(`Missing fake R2 object: ${key}`);
    return stored;
  }

  private nextEtag(): string {
    this.etagSequence += 1;
    return `fake-etag-${this.etagSequence}`;
  }

  private objectView(stored: FakeStoredObject): R2Object {
    return {
      key: stored.key,
      version: stored.etag,
      size: stored.bytes.byteLength,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      checksums: {},
      uploaded: new Date(stored.uploaded),
      httpMetadata: { ...stored.httpMetadata },
      ...(stored.customMetadata === undefined
        ? {}
        : { customMetadata: { ...stored.customMetadata } }),
      storageClass: 'Standard',
      writeHttpMetadata(headers: Headers): void {
        if (stored.httpMetadata.contentType !== undefined) {
          headers.set('Content-Type', stored.httpMetadata.contentType);
        }
        if (stored.httpMetadata.cacheControl !== undefined) {
          headers.set('Cache-Control', stored.httpMetadata.cacheControl);
        }
      },
    } as R2Object;
  }

  private bodyView(stored: FakeStoredObject): R2ObjectBody {
    const bytes = stored.bytes.slice();
    return {
      ...this.objectView(stored),
      body: undefined,
      bodyUsed: false,
      arrayBuffer: async (): Promise<ArrayBuffer> => bytes.slice().buffer,
      text: async (): Promise<string> => decoder.decode(bytes),
      json: async <T>(): Promise<T> => JSON.parse(decoder.decode(bytes)) as T,
      blob: async (): Promise<Blob> => new Blob([bytes]),
    } as unknown as R2ObjectBody;
  }
}

interface FakeResolutionRow {
  candidate_id: string;
  curator_identity: string;
  outcome: string;
  resolution_code: string;
  checkpoint_json: string | null;
  finalized_at: string | null;
  delete_after: string | null;
}

class FakeResolutionStatement {
  private values: unknown[] = [];

  constructor(private readonly database: FakeResolutionD1, private readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this as unknown as D1PreparedStatement;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('INSERT INTO vod_export_publication_resolutions')) {
      const [intentId, candidateId, curatorIdentity, outcome, code, checkpointJson] = this.values as string[];
      if (!this.database.rows.has(intentId)) {
        this.database.rows.set(intentId, {
          candidate_id: candidateId,
          curator_identity: curatorIdentity,
          outcome,
          resolution_code: code,
          checkpoint_json: checkpointJson ?? null,
          finalized_at: null,
          delete_after: null,
        });
      }
      return d1Result(1);
    }
    if (this.sql.includes('UPDATE vod_export_publication_resolutions')) {
      const [finalizedAt, deleteAfter, intentId] = this.values as string[];
      const row = this.database.rows.get(intentId);
      if (row !== undefined) {
        row.finalized_at ??= finalizedAt;
        row.delete_after ??= deleteAfter;
      }
      return d1Result(row === undefined ? 0 : 1);
    }
    throw new Error(`Unexpected fake resolution D1 write: ${this.sql}`);
  }

  async first<T>(): Promise<T | null> {
    const [intentId] = this.values as string[];
    const row = this.database.rows.get(intentId);
    return (row === undefined ? null : { ...row }) as T | null;
  }
}

class FakeResolutionD1 {
  readonly rows = new Map<string, FakeResolutionRow>();

  asDatabase(): D1Database {
    return this as unknown as D1Database;
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeResolutionStatement(this, sql) as unknown as D1PreparedStatement;
  }

  withSession(): D1DatabaseSession {
    return { prepare: (sql: string) => this.prepare(sql) } as unknown as D1DatabaseSession;
  }
}

function d1Result(changes: number): D1Result {
  return {
    results: [],
    success: true,
    meta: { changes },
  } as unknown as D1Result;
}

function conditionMatches(
  condition: FakePutOptions['onlyIf'],
  current: FakeStoredObject | undefined,
): boolean {
  if (condition === undefined) return true;
  if (condition instanceof Headers) {
    if (condition.get('If-None-Match') === '*') return current === undefined;
    const ifMatch = condition.get('If-Match');
    return ifMatch === null || current?.etag === unquoteEtag(ifMatch);
  }
  if (condition.etagMatches !== undefined) return current?.etag === condition.etagMatches;
  return true;
}

function unquoteEtag(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function toBytes(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value.slice();
  return new Uint8Array(value.slice(0));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectRejects(
  operation: () => Promise<unknown>,
  predicate: (error: unknown) => boolean,
  message: string,
): Promise<void> {
  let rejected: unknown;
  try {
    await operation();
  } catch (error) {
    rejected = error;
  }
  assert(predicate(rejected), message);
}

function sourceFingerprint(): VodExportSourceFingerprint {
  return {
    dbId: 'admin-db-id',
    dbRevision: '12',
    novaDbId: 'nova-db-id',
    novaRevision: '34',
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    exporterBuildId: 'worker-version-id',
  };
}

async function testWrongOriginManifestIsRejected(): Promise<void> {
  const fake = new FakeR2Bucket();
  const sha256 = 'a'.repeat(64);
  const bytes = encoder.encode(JSON.stringify({
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: `https://attacker.example/vod/v1/snapshots/${sha256}.json`,
    sha256,
    publishedAt: FIXED_NOW.toISOString(),
    uncompressedBytes: 42,
    counts: { streamers: 1, vods: 1, performances: 1 },
  }));
  await fake.put(VOD_EXPORT_MANIFEST_KEY, bytes, {
    httpMetadata: PUBLIC_MANIFEST_HTTP_METADATA,
  });

  await expectRejects(
    () => readCurrentManifest(fake.asBucket(), { verifySnapshot: false }),
    (error) => error instanceof VodExportPublicationError
      && error.code === 'PUBLIC_ARTIFACT_INVALID',
    'a canonical-looking manifest from the wrong public origin must be rejected',
  );
}

async function testCandidateDerivedMetadataCorruptionIsRejected(): Promise<void> {
  const fake = new FakeR2Bucket();
  const artifact = await createSnapshotArtifact({
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    streamers: [],
  });
  const candidate = await storeCandidate(
    fake.asBucket(),
    artifact,
    [],
    sourceFingerprint(),
    FIXED_NOW,
  );
  fake.mutateJson(candidateMetadataKey(candidate.candidateId), (metadata) => ({
    ...metadata,
    snapshotUrl: `https://attacker.example/vod/v1/snapshots/${candidate.sha256}.json`,
  }));

  await expectRejects(
    () => getCandidate(fake.asBucket(), candidate.candidateId, { now: FIXED_NOW }),
    (error) => error instanceof VodExportCandidateError
      && error.code === 'CANDIDATE_CORRUPT',
    'candidate snapshotUrl must remain derived from the hash and fixed public origin',
  );
}

async function testGenerationAcquireRecoversCommitThenThrow(): Promise<void> {
  const fake = new FakeR2Bucket();
  fake.injectCommitThenThrow(GENERATION_CONTROL_KEY);

  const owned = await acquireGenerationControl(fake.asBucket(), FIXED_NOW);
  const persisted = fake.readJson(GENERATION_CONTROL_KEY);
  equal(persisted.state, 'acquired', 'ambiguous generation acquire persisted acquired state');
  equal(
    persisted.generationId,
    owned.slot.generationId,
    'ambiguous generation acquire is recovered by the same generation ID',
  );
}

async function testPublicationAcquireRecoversCommitThenThrow(): Promise<void> {
  const fake = new FakeR2Bucket();
  fake.injectCommitThenThrow(PUBLICATION_CONTROL_KEY);

  const owned = await acquirePublicationControl(fake.asBucket(), CANDIDATE_ID, FIXED_NOW);
  const persisted = await readPublicationControl(fake.asBucket());
  assert(persisted?.slot.state === 'acquired', 'ambiguous publication acquire remains acquired');
  equal(
    persisted.slot.intentId,
    owned.slot.intentId,
    'ambiguous publication acquire is recovered by the same intent ID',
  );
}

async function testPrepareRecoversCommitThenThrow(): Promise<void> {
  const fake = new FakeR2Bucket();
  const owned = await acquirePublicationControl(fake.asBucket(), CANDIDATE_ID, FIXED_NOW);
  const sha256 = 'b'.repeat(64);
  const manifest = {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: snapshotUrlForHash(sha256),
    sha256,
    publishedAt: '2026-07-11T12:01:00.000Z',
    uncompressedBytes: 123,
    counts: { streamers: 1, vods: 1, performances: 1 },
  } as const;
  const audit: PreparedPublicationAudit = {
    curatorIdentity: 'curator@example.com',
    candidateId: CANDIDATE_ID,
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    candidateSha256: sha256,
    previousSha256: null,
    snapshotUrl: manifest.snapshotUrl,
    previousSnapshotUrl: null,
    streamerCount: 1,
    vodCount: 1,
    performanceCount: 1,
    warningCount: 0,
    sourceFingerprint: sourceFingerprint(),
    publishedAt: manifest.publishedAt,
  };
  fake.injectCommitThenThrow(PUBLICATION_CONTROL_KEY);

  const prepared = await preparePublicationControl(fake.asBucket(), owned, {
    preparedAt: '2026-07-11T12:00:30.000Z',
    expectedManifestEtag: null,
    expectedManifestBody: null,
    manifestBody: decoder.decode(serializeCanonicalManifest(manifest)),
    audit,
  });
  const persisted = await readPublicationControl(fake.asBucket());
  assert(persisted?.slot.state === 'prepared', 'ambiguous prepare remains prepared');
  equal(
    persisted.slot.intentId,
    prepared.slot.intentId,
    'ambiguous prepare is recovered only for the same intent ID',
  );
  equal(persisted.etag, prepared.etag, 'prepare recovery returns the committed object ETag');
}

async function testGenerationReleaseRecoversExplicitCasConflict(): Promise<void> {
  const fake = new FakeR2Bucket();
  const owned = await acquireGenerationControl(fake.asBucket(), FIXED_NOW);
  fake.touch(GENERATION_CONTROL_KEY);

  await releaseGenerationControl(fake.asBucket(), owned);
  equal(
    fake.readJson(GENERATION_CONTROL_KEY).state,
    'idle',
    'a null CAS result is retried to idle when generation ownership still matches',
  );
}

async function testPublicationReleaseRecoversExplicitCasConflict(): Promise<void> {
  const fake = new FakeR2Bucket();
  const owned = await acquirePublicationControl(fake.asBucket(), CANDIDATE_ID, FIXED_NOW);
  fake.touch(PUBLICATION_CONTROL_KEY);

  await releasePublicationControl(
    fake.asBucket(),
    owned.slot.intentId,
    owned.etag,
  );
  const persisted = await readPublicationControl(fake.asBucket());
  assert(persisted?.slot.state === 'idle', 'publication release should settle at idle after a null CAS result');
}

async function testPreparedReconciliationDoesNotNeedBrowserCandidateState(): Promise<void> {
  const privateBucket = new FakeR2Bucket();
  const publicBucket = new FakeR2Bucket();
  const database = new FakeResolutionD1();
  const owned = await acquirePublicationControl(privateBucket.asBucket(), CANDIDATE_ID, FIXED_NOW);
  const sha256 = 'c'.repeat(64);
  const manifest = {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: snapshotUrlForHash(sha256),
    sha256,
    publishedAt: '2026-07-11T12:05:00.000Z',
    uncompressedBytes: 123,
    counts: { streamers: 1, vods: 1, performances: 1 },
  } as const;
  const audit: PreparedPublicationAudit = {
    curatorIdentity: 'curator@example.com',
    candidateId: CANDIDATE_ID,
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    candidateSha256: sha256,
    previousSha256: null,
    snapshotUrl: manifest.snapshotUrl,
    previousSnapshotUrl: null,
    streamerCount: 1,
    vodCount: 1,
    performanceCount: 1,
    warningCount: 0,
    sourceFingerprint: sourceFingerprint(),
    publishedAt: manifest.publishedAt,
  };
  await preparePublicationControl(privateBucket.asBucket(), owned, {
    preparedAt: '2026-07-11T12:04:00.000Z',
    expectedManifestEtag: null,
    expectedManifestBody: null,
    manifestBody: decoder.decode(serializeCanonicalManifest(manifest)),
    audit,
    attemptsExhausted: true,
  });

  const result = await reconcileVodExportPublication({
    DB: database.asDatabase(),
    NOVA_DB: {} as D1Database,
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, FIXED_NOW);

  equal(result.outcome, 'released_not_committed', 'reconciliation classifies an uncommitted exhausted intent');
  const control = await readPublicationControl(privateBucket.asBucket());
  assert(control?.slot.state === 'idle', 'reconciliation releases the prepared slot without a browser candidate ID');
  const resolution = [...database.rows.values()][0];
  assert(resolution?.finalized_at !== null, 'failed prepared intent keeps finalized 30-day resolution history');
}

async function testManualGenerationRecoveryUsesInspectedOwnerAndEtag(): Promise<void> {
  const privateBucket = new FakeR2Bucket();
  await acquireGenerationControl(privateBucket.asBucket(), FIXED_NOW);
  const inspected = await inspectVodExportControlRecoveryState(privateBucket.asBucket());
  assert(inspected.generation !== null, 'manual recovery inspection exposes the acquired generation owner');

  const result = await manuallyRecoverVodExportControl({
    DB: {} as D1Database,
    NOVA_DB: {} as D1Database,
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
    VOD_EXPORT_PUBLIC: new FakeR2Bucket().asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, {
    control: 'generation',
    ownerId: inspected.generation.ownerId,
    etag: inspected.generation.etag,
    confirmation: VOD_EXPORT_MANUAL_RECOVERY_CONFIRMATION,
    reason: 'Confirmed the preview request invocation terminated from Worker logs.',
  }, 'curator@example.com', new Date(FIXED_NOW.getTime() + 16 * 60 * 1_000));

  equal(result.outcome, 'released', 'confirmed dead generation owner is released');
  const control = await inspectVodExportControlRecoveryState(privateBucket.asBucket());
  equal(control.generation, null, 'generation control returns to idle');
}

async function testManualPreparedRecoveryCanClassifyExactPriorState(): Promise<void> {
  const privateBucket = new FakeR2Bucket();
  const publicBucket = new FakeR2Bucket();
  const owned = await acquirePublicationControl(privateBucket.asBucket(), CANDIDATE_ID, FIXED_NOW);
  const database = new FakeResolutionD1();
  const sha256 = 'd'.repeat(64);
  const manifest = {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: snapshotUrlForHash(sha256),
    sha256,
    publishedAt: '2026-07-11T12:05:00.000Z',
    uncompressedBytes: 123,
    counts: { streamers: 1, vods: 1, performances: 1 },
  } as const;
  await preparePublicationControl(privateBucket.asBucket(), owned, {
    preparedAt: '2026-07-11T12:01:00.000Z',
    expectedManifestEtag: null,
    expectedManifestBody: null,
    manifestBody: decoder.decode(serializeCanonicalManifest(manifest)),
    audit: {
      curatorIdentity: 'curator@example.com',
      candidateId: CANDIDATE_ID,
      schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
      candidateSha256: sha256,
      previousSha256: null,
      snapshotUrl: manifest.snapshotUrl,
      previousSnapshotUrl: null,
      streamerCount: 1,
      vodCount: 1,
      performanceCount: 1,
      warningCount: 0,
      sourceFingerprint: sourceFingerprint(),
      publishedAt: manifest.publishedAt,
    },
  });
  const inspected = await inspectVodExportControlRecoveryState(privateBucket.asBucket());
  assert(inspected.publication !== null, 'manual recovery inspection exposes the prepared owner');

  const result = await manuallyRecoverVodExportControl({
    DB: database.asDatabase(),
    NOVA_DB: {} as D1Database,
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, {
    control: 'publication',
    ownerId: inspected.publication.ownerId,
    etag: inspected.publication.etag,
    confirmation: VOD_EXPORT_MANUAL_RECOVERY_CONFIRMATION,
    reason: 'Confirmed the publication request invocation terminated before cutover.',
  }, 'curator@example.com', new Date(FIXED_NOW.getTime() + 17 * 60 * 1_000));

  equal(result.outcome, 'released', 'exact unchanged prior manifest permits a confirmed manual release');
  const control = await inspectVodExportControlRecoveryState(privateBucket.asBucket());
  equal(control.publication, null, 'publication control returns to idle');
  const resolution = [...database.rows.values()][0];
  equal(resolution?.outcome, 'manual_release', 'manual release retains its private resolution outcome');
}

async function main(): Promise<void> {
  await testWrongOriginManifestIsRejected();
  await testCandidateDerivedMetadataCorruptionIsRejected();
  await testGenerationAcquireRecoversCommitThenThrow();
  await testPublicationAcquireRecoversCommitThenThrow();
  await testPrepareRecoversCommitThenThrow();
  await testGenerationReleaseRecoversExplicitCasConflict();
  await testPublicationReleaseRecoversExplicitCasConflict();
  await testPreparedReconciliationDoesNotNeedBrowserCandidateState();
  await testManualGenerationRecoveryUsesInspectedOwnerAndEtag();
  await testManualPreparedRecoveryCanClassifyExactPriorState();
  console.log('✓ VOD export publication and control recovery');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { snapshotUrlForHash } from './canonical-json';
import { PUBLICATION_CONTROL_KEY, readPublicationControl } from './control';
import { VOD_EXPORT_MANIFEST_KEY } from './constants';
import { runVodExportMaintenance } from './maintenance';

declare const process: { exitCode?: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NOW = new Date('2026-07-11T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

interface AuditRow {
  intent_id: string;
  snapshot_url: string;
  candidate_sha256: string;
  identity_retained_until: string;
  curator_identity: string | null;
  candidate_id: string | null;
  snapshot_unreferenced_at: string | null;
  identity_removed_at: string | null;
}

interface FakePutOptions {
  onlyIf?: Headers | { etagMatches?: string };
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

interface FakeStoredObject {
  key: string;
  bytes: Uint8Array;
  etag: string;
  uploaded: Date;
  httpMetadata: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

class FakeR2Bucket {
  private readonly objects = new Map<string, FakeStoredObject>();
  private etagSequence = 0;

  asBucket(): R2Bucket {
    return this as unknown as R2Bucket;
  }

  seedJson(
    key: string,
    value: unknown,
    options: { uploaded?: Date; customMetadata?: Record<string, string> } = {},
  ): void {
    this.seedBytes(key, encoder.encode(JSON.stringify(value)), options);
  }

  seedBytes(
    key: string,
    bytes: Uint8Array,
    options: { uploaded?: Date; customMetadata?: Record<string, string> } = {},
  ): void {
    this.objects.set(key, {
      key,
      bytes: bytes.slice(),
      etag: this.nextEtag(),
      uploaded: new Date(options.uploaded ?? NOW),
      httpMetadata: {},
      ...(options.customMetadata === undefined
        ? {}
        : { customMetadata: { ...options.customMetadata } }),
    });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  readJson(key: string): Record<string, unknown> {
    const stored = this.objects.get(key);
    if (stored === undefined) throw new Error(`Missing fake R2 object: ${key}`);
    return JSON.parse(decoder.decode(stored.bytes)) as Record<string, unknown>;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.bodyView(stored);
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
      uploaded: new Date(NOW),
      httpMetadata: { ...(options.httpMetadata ?? {}) },
      ...(options.customMetadata === undefined
        ? {}
        : { customMetadata: { ...options.customMetadata } }),
    };
    this.objects.set(key, stored);
    return this.objectView(stored);
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key);
  }

  async list(options: { prefix?: string }): Promise<R2Objects> {
    const prefix = options.prefix ?? '';
    const objects = [...this.objects.values()]
      .filter((object) => object.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((object) => this.objectView(object));
    return {
      objects,
      truncated: false,
      delimitedPrefixes: [],
    } as unknown as R2Objects;
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
      writeHttpMetadata(): void {},
    } as unknown as R2Object;
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

class FakeD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: FakeD1Database,
    private readonly sql: string,
  ) {}

  asStatement(): D1PreparedStatement {
    return this as unknown as D1PreparedStatement;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this.asStatement();
  }

  async all<T>(): Promise<D1Result<T>> {
    if (!this.sql.includes('FROM vod_export_publication_audits')) {
      throw new Error(`Unexpected fake D1 SELECT: ${this.sql}`);
    }
    return result(this.database.rows.map((row) => ({ ...row })) as T[]);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('UPDATE vod_export_publication_resolutions')) {
      const changes = this.database.pendingResolutions;
      this.database.pendingResolutions = 0;
      return result([], changes);
    }
    if (this.sql.includes('DELETE FROM vod_export_publication_resolutions')) {
      const changes = this.database.expiredResolutions;
      this.database.expiredResolutions = 0;
      return result([], changes);
    }
    return this.execute();
  }

  async execute(): Promise<D1Result> {
    if (this.sql.includes('SET snapshot_unreferenced_at = NULL')) {
      const [intentId] = this.values as [string];
      const row = this.database.requireRow(intentId);
      if (row.snapshot_unreferenced_at !== null) row.snapshot_unreferenced_at = null;
      return result([]);
    }
    if (this.sql.includes('SET snapshot_unreferenced_at = ?')) {
      const [timestamp, intentId] = this.values as [string, string];
      const row = this.database.requireRow(intentId);
      if (row.snapshot_unreferenced_at === null) row.snapshot_unreferenced_at = timestamp;
      return result([]);
    }
    if (this.sql.includes('SET curator_identity = NULL')) {
      const [removedAt, intentId, retainedUntil] = this.values as [string, string, string];
      const row = this.database.requireRow(intentId);
      if (
        row.identity_retained_until <= retainedUntil
        && (row.curator_identity !== null || row.candidate_id !== null)
      ) {
        row.curator_identity = null;
        row.candidate_id = null;
        row.identity_removed_at = removedAt;
      }
      return result([]);
    }
    throw new Error(`Unexpected fake D1 UPDATE: ${this.sql}`);
  }
}

class FakeD1Database {
  readonly rows: AuditRow[];
  pendingResolutions: number;
  expiredResolutions: number;

  constructor(rows: AuditRow[], resolutions: { pending?: number; expired?: number } = {}) {
    this.rows = rows.map((row) => ({ ...row }));
    this.pendingResolutions = resolutions.pending ?? 0;
    this.expiredResolutions = resolutions.expired ?? 0;
  }

  asDatabase(): D1Database {
    return this as unknown as D1Database;
  }

  withSession(): D1DatabaseSession {
    return {
      prepare: (sql: string): D1PreparedStatement => this.prepare(sql),
    } as unknown as D1DatabaseSession;
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeD1Statement(this, sql).asStatement();
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) {
      results.push(await (statement as unknown as FakeD1Statement).execute());
    }
    return results;
  }

  requireRow(intentId: string): AuditRow {
    const row = this.rows.find((candidate) => candidate.intent_id === intentId);
    if (row === undefined) throw new Error(`Missing fake audit row: ${intentId}`);
    return row;
  }
}

function result<T>(results: T[], changes = 0): D1Result<T> {
  return { results, success: true, meta: { changes } } as unknown as D1Result<T>;
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
  return condition.etagMatches === undefined || current?.etag === condition.etagMatches;
}

function unquoteEtag(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function toBytes(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value.slice();
  return new Uint8Array(value.slice(0));
}

function auditRow(
  suffix: string,
  hash: string,
  overrides: Partial<AuditRow> = {},
): AuditRow {
  return {
    intent_id: `intent-${suffix}`,
    snapshot_url: snapshotUrlForHash(hash),
    candidate_sha256: hash,
    identity_retained_until: '2028-07-11T12:00:00.000Z',
    curator_identity: `curator-${suffix}@example.com`,
    candidate_id: `candidate-${suffix}`,
    snapshot_unreferenced_at: null,
    identity_removed_at: null,
    ...overrides,
  };
}

function snapshotKey(hash: string): string {
  return `vod/v1/snapshots/${hash}.json`;
}

function seedManifest(publicBucket: FakeR2Bucket, hash: string): void {
  publicBucket.seedJson(VOD_EXPORT_MANIFEST_KEY, {
    snapshotUrl: snapshotUrlForHash(hash),
  });
}

async function assertControlIdle(privateBucket: FakeR2Bucket, context: string): Promise<void> {
  const control = await readPublicationControl(privateBucket.asBucket());
  assert(control !== null, `${context}: publication control should exist after maintenance`);
  equal(control.slot.state, 'idle', `${context}: publication control must be released to idle`);
  equal(
    privateBucket.readJson(PUBLICATION_CONTROL_KEY).state,
    'idle',
    `${context}: persisted publication control must be idle`,
  );
}

async function testReferencedV1SnapshotIsNeverAnonymizedOrDeleted(): Promise<void> {
  const hash = 'a'.repeat(64);
  const oldMarker = new Date(NOW.getTime() - 800 * DAY_MS).toISOString();
  const database = new FakeD1Database([
    auditRow('referenced', hash, {
      identity_retained_until: '2024-01-01T00:00:00.000Z',
      snapshot_unreferenced_at: oldMarker,
    }),
  ]);
  const publicBucket = new FakeR2Bucket();
  const privateBucket = new FakeR2Bucket();
  seedManifest(publicBucket, hash);
  publicBucket.seedBytes(snapshotKey(hash), encoder.encode('{}'), {
    uploaded: new Date(NOW.getTime() - 900 * DAY_MS),
    customMetadata: { unreferencedAt: oldMarker },
  });

  const maintenance = await runVodExportMaintenance({
    DB: database.asDatabase(),
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, NOW);

  const row = database.requireRow('intent-referenced');
  equal(maintenance.auditIdentitiesRemoved, 0, 'referenced identity removal count');
  equal(maintenance.snapshotsDeleted, 0, 'referenced snapshot deletion count');
  equal(row.curator_identity, 'curator-referenced@example.com', 'referenced curator identity');
  equal(row.candidate_id, 'candidate-referenced', 'referenced candidate identity');
  assert(publicBucket.has(snapshotKey(hash)), 'a v1-manifest-referenced snapshot must remain in R2');
  await assertControlIdle(privateBucket, 'referenced v1 snapshot');
}

async function testUnreferencedIdentityWaitsUntilTwoYearThreshold(): Promise<void> {
  const beforeHash = 'b'.repeat(64);
  const dueHash = 'c'.repeat(64);
  const database = new FakeD1Database([
    auditRow('before-two-years', beforeHash, {
      identity_retained_until: new Date(NOW.getTime() + 1).toISOString(),
    }),
    auditRow('at-two-years', dueHash, {
      identity_retained_until: NOW.toISOString(),
    }),
  ]);
  const publicBucket = new FakeR2Bucket();
  const privateBucket = new FakeR2Bucket();
  publicBucket.seedBytes(snapshotKey(beforeHash), encoder.encode('{}'));
  publicBucket.seedBytes(snapshotKey(dueHash), encoder.encode('{}'));

  const maintenance = await runVodExportMaintenance({
    DB: database.asDatabase(),
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, NOW);

  const before = database.requireRow('intent-before-two-years');
  const due = database.requireRow('intent-at-two-years');
  equal(maintenance.auditIdentitiesRemoved, 1, 'only due identity should be anonymized');
  equal(before.curator_identity, 'curator-before-two-years@example.com', 'pre-threshold curator identity');
  equal(before.candidate_id, 'candidate-before-two-years', 'pre-threshold candidate identity');
  equal(due.curator_identity, null, 'two-year curator identity');
  equal(due.candidate_id, null, 'two-year candidate identity');
  equal(due.identity_removed_at, NOW.toISOString(), 'two-year identity removal timestamp');
  await assertControlIdle(privateBucket, 'identity retention threshold');
}

async function testSnapshotIsNotDeletedBeforeFourHundredDayBoundary(): Promise<void> {
  const earlyHash = 'd'.repeat(64);
  const dueHash = 'e'.repeat(64);
  const earlyMarker = new Date(NOW.getTime() - 400 * DAY_MS + 1).toISOString();
  const dueMarker = new Date(NOW.getTime() - 400 * DAY_MS).toISOString();
  const database = new FakeD1Database([
    auditRow('before-400-days', earlyHash, {
      curator_identity: null,
      candidate_id: null,
      snapshot_unreferenced_at: earlyMarker,
    }),
    auditRow('at-400-days', dueHash, {
      curator_identity: null,
      candidate_id: null,
      snapshot_unreferenced_at: dueMarker,
    }),
  ]);
  const publicBucket = new FakeR2Bucket();
  const privateBucket = new FakeR2Bucket();
  publicBucket.seedBytes(snapshotKey(earlyHash), encoder.encode('{}'), {
    uploaded: new Date(NOW.getTime() - 500 * DAY_MS),
  });
  publicBucket.seedBytes(snapshotKey(dueHash), encoder.encode('{}'), {
    uploaded: new Date(NOW.getTime() - 500 * DAY_MS),
  });

  const maintenance = await runVodExportMaintenance({
    DB: database.asDatabase(),
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, NOW);

  equal(maintenance.snapshotsDeleted, 1, 'only the snapshot at the 400-day boundary should be deleted');
  assert(publicBucket.has(snapshotKey(earlyHash)), 'a snapshot one millisecond before 400 days must remain');
  assert(!publicBucket.has(snapshotKey(dueHash)), 'a snapshot at 400 days may be deleted');
  await assertControlIdle(privateBucket, 'snapshot retention boundary');
}

async function testRereferencedSnapshotClearsUnreferencedMarker(): Promise<void> {
  const hash = 'f'.repeat(64);
  const database = new FakeD1Database([
    auditRow('rereferenced', hash, {
      snapshot_unreferenced_at: '2025-01-01T00:00:00.000Z',
    }),
  ]);
  const publicBucket = new FakeR2Bucket();
  const privateBucket = new FakeR2Bucket();
  seedManifest(publicBucket, hash);
  publicBucket.seedBytes(snapshotKey(hash), encoder.encode('{}'));

  const maintenance = await runVodExportMaintenance({
    DB: database.asDatabase(),
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, NOW);

  equal(maintenance.referenceMarkersCleared, 1, 're-reference marker clear count');
  equal(database.requireRow('intent-rereferenced').snapshot_unreferenced_at, null, 're-reference marker');
  await assertControlIdle(privateBucket, 're-referenced snapshot');
}

async function testResolutionHistoryFinalizesAndExpiresOnlyUnderTheMutex(): Promise<void> {
  const database = new FakeD1Database([], { pending: 2, expired: 3 });
  const publicBucket = new FakeR2Bucket();
  const privateBucket = new FakeR2Bucket();

  const maintenance = await runVodExportMaintenance({
    DB: database.asDatabase(),
    VOD_EXPORT_PUBLIC: publicBucket.asBucket(),
    VOD_EXPORT_PRIVATE: privateBucket.asBucket(),
  }, NOW);

  equal(maintenance.publicationResolutionsFinalized, 2, 'pending cross-store resolutions are finalized');
  equal(maintenance.publicationResolutionsDeleted, 3, 'only already-expired resolution history is deleted');
  await assertControlIdle(privateBucket, 'publication resolution retention');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function main(): Promise<void> {
  await testReferencedV1SnapshotIsNeverAnonymizedOrDeleted();
  await testUnreferencedIdentityWaitsUntilTwoYearThreshold();
  await testSnapshotIsNotDeletedBeforeFourHundredDayBoundary();
  await testRereferencedSnapshotClearsUnreferencedMarker();
  await testResolutionHistoryFinalizesAndExpiresOnlyUnderTheMutex();
  console.log('✓ VOD export maintenance retention safety');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

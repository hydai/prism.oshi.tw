import { D1_JSON_BINDING_MAX_BYTES, VOD_EXPORT_LIMITS } from './constants';
import {
  assertApiFindingsCapacity,
  d1JsonLookupPlan,
  repairPathForFinding,
  type VodExportFindingApi,
} from './api';
import { ExportLimitExceededError } from './limits';
import { utf8ByteLength } from './normalization';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function testFindingsLookupBindsOneJsonArray(): Promise<void> {
  // The private repair-path lookup used a packed BLOB frame decoded by a
  // WITH RECURSIVE CTE from 6254dc4 ("perf(vod-export): bound synchronous preview
  // memory"); the 2026-08 anti-pattern audit collapsed it back onto json_each, the
  // same mechanism db.ts already uses. At most 5,000 finding-derived IDs reach this
  // lookup, so ordinary UUID identities serialize to a few hundred KB; an identity
  // set that would not fit one bound value is refused by D1_JSON_BINDING_MAX_BYTES
  // rather than split across frames (vod-export-spec.md D-016.2).
  const values = Array.from(
    { length: VOD_EXPORT_LIMITS.findings },
    (_, index) => `0f8b1c2d-4e5a-4b6c-8d9e-${String(index).padStart(12, '0')}`,
  );
  values[1] = '繁體中文😀-lookup';
  values[2] = 'quote"and\\backslash';
  const plan = d1JsonLookupPlan('songs', 'id', 'hex(id)', values);
  equal(
    plan.sql,
    'SELECT hex(id) FROM songs WHERE id IN (SELECT value FROM json_each(?))',
    'the lookup expands one bound JSON array',
  );
  equal(plan.sql.split('?').length - 1, 1, 'the lookup binds exactly one parameter');
  equal(JSON.stringify(JSON.parse(plan.binding)), JSON.stringify(values),
    'the JSON binding round-trips every lookup identity exactly');
  const bindingBytes = utf8ByteLength(plan.binding);
  assert(bindingBytes < 500_000, '5,000 UUID-shaped identities stay a few hundred KB');
  assert(bindingBytes <= D1_JSON_BINDING_MAX_BYTES, 'lookup binding stays under its guard');

  const targets = [values[1], values[4_999]].filter((value): value is string => value !== undefined);
  const matched = await executeJsonLookupInSqlite(plan, targets);
  for (let index = 0; index < targets.length; index += 1) {
    assert(matched.includes(targets[index] ?? ''), `production lookup SQL selects target ${index}`);
  }
}

async function executeJsonLookupInSqlite(
  plan: { sql: string; binding: string },
  targets: readonly string[],
): Promise<string[]> {
  const encode = new TextEncoder();
  const seed = targets
    .map((target) => `INSERT INTO songs(id) VALUES(CAST(X'${hex(encode.encode(target))}' AS TEXT));`)
    .join('\n');
  const sql = plan.sql.replace('?', `'${plan.binding.replace(/'/g, "''")}'`);
  // @ts-expect-error The Worker project intentionally omits Node ambient types;
  // this test-only dynamic import uses the repository's sqlite3 CLI.
  const { spawnSync } = await import('node:child_process');
  const execution = spawnSync('sqlite3', ['-batch', '-bail', ':memory:'], {
    input: `CREATE TABLE songs(id TEXT PRIMARY KEY);\n${seed}\n${sql};`,
    encoding: 'utf8',
  });
  if (execution.status !== 0) {
    throw new Error(`JSON D1 lookup SQL failed in sqlite3: ${String(execution.stderr)}`);
  }
  const byHex = new Map(targets.map((target) => [hex(encode.encode(target)), target]));
  return String(execution.stdout)
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => byHex.get(line.toLowerCase()))
    .filter((value): value is string => value !== undefined);
}

function hex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function testOversizedLookupIsRefused(): void {
  const oversized = Array.from({ length: 20 }, () => 'x'.repeat(100_000));
  const expectedBytes = utf8ByteLength(JSON.stringify(oversized));
  assert(expectedBytes > D1_JSON_BINDING_MAX_BYTES, 'fixture exceeds the D1 binding guard');
  let rejected: unknown;
  try {
    d1JsonLookupPlan('songs', 'id', 'hex(id)', oversized);
  } catch (error) {
    rejected = error;
  }
  assert(
    rejected instanceof ExportLimitExceededError
      && rejected.code === 'EXPORT_LIMIT_EXCEEDED'
      && rejected.httpStatus === 422
      && rejected.diagnostic.resource === 'd1JsonBindingBytes'
      && rejected.diagnostic.actual === expectedBytes
      && rejected.diagnostic.limit === D1_JSON_BINDING_MAX_BYTES
      && rejected.diagnostic.state === 'exceeded',
    'an unbindable identity set is refused with an honest diagnostic',
  );
}

function testDecoratedFindingsAreRemeasured(): void {
  const small: VodExportFindingApi = {
    code: 'MISSING_END_SECONDS',
    severity: 'error',
    message: 'End time is required.',
    entityType: 'performance',
    entityId: 'performance-1',
    repairPath: '/streams/stream-1?performance=performance-1',
  };
  const diagnostic = assertApiFindingsCapacity(false, [small]);
  equal(diagnostic.resource, 'findingsBytes', 'decorated response reports the findings byte resource');
  equal(
    diagnostic.actual,
    utf8ByteLength(JSON.stringify({ canPublish: false, findings: [small] })),
    'allocation-free decorated response measurement matches exact compact JSON bytes',
  );

  let rejected: unknown;
  try {
    assertApiFindingsCapacity(false, [{
      ...small,
      repairPath: `/streams?search=${'x'.repeat(VOD_EXPORT_LIMITS.findingsBytes)}`,
    }]);
  } catch (error) {
    rejected = error;
  }
  assert(
    rejected instanceof ExportLimitExceededError
      && rejected.diagnostic.resource === 'findingsBytes',
    'repair-path expansion over 4 MiB becomes the confirmed capacity error',
  );
}

function testRelationshipFindingsOpenPrivateRepairRecords(): void {
  const relationship: VodExportFindingApi = {
    code: 'MISSING_VOD_RELATION',
    severity: 'error',
    message: 'Approved performance references a missing VOD.',
    streamerSlug: 'alpha',
    entityType: 'performance',
    entityId: 'performance-1',
  };
  equal(
    repairPathForFinding(
      relationship,
      new Map([['performance-1', 42]]),
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    ),
    '/vod-export/repair/performance/42',
    'relationship finding resolves its performance ID to a private row detail',
  );
  const missingSongId: VodExportFindingApi = {
    code: 'MISSING_SONG_ID',
    severity: 'error',
    message: 'Canonical song row has no public ID.',
    streamerSlug: 'alpha',
    entityType: 'song',
    details: { rowId: 17 },
  };
  equal(
    repairPathForFinding(missingSongId, new Map(), new Map(), new Map(), new Map(), new Map()),
    '/vod-export/repair/song/17',
    'missing song identity uses its private row locator',
  );

  const longSubmissionId = 'submission-'.padEnd(20_000, 'x');
  equal(
    repairPathForFinding({
      code: 'MISSING_STREAMER_SLUG',
      severity: 'error',
      message: 'Enabled approved streamer has no slug.',
      entityType: 'streamer',
      details: { submissionId: longSubmissionId },
    }, new Map(), new Map(), new Map(), new Map(), new Map([[longSubmissionId, 8]])),
    '/vod-export/repair/streamer/8',
    'large private streamer locator resolves to a short server-controlled row path',
  );
  const longStreamId = 'stream-'.padEnd(20_000, 'y');
  equal(
    repairPathForFinding({
      code: 'MISSING_VIDEO_ID',
      severity: 'error',
      message: 'Canonical VOD has no video ID.',
      streamerSlug: 'alpha',
      entityType: 'vod',
      field: 'videoId',
      details: { streamId: longStreamId },
    }, new Map(), new Map(), new Map(), new Map([[longStreamId, 9]]), new Map()),
    '/vod-export/repair/vod/9',
    'large private VOD locator resolves to a short server-controlled row path',
  );

  equal(
    repairPathForFinding({
      code: 'MISSING_ORIGINAL_ARTIST',
      severity: 'warning',
      message: 'Original artist is missing.',
      streamerSlug: 'alpha',
      entityType: 'song',
      entityId: 'song-with-a-long-public-id',
      field: 'originalArtist',
      details: { affectedPerformanceCount: 1 },
    }, new Map(), new Map([['song-with-a-long-public-id', 23]]), new Map(), new Map(), new Map()),
    '/vod-export/repair/song/23',
    'song findings resolve public IDs to short private row paths',
  );
}

async function main(): Promise<void> {
  await testFindingsLookupBindsOneJsonArray();
  testOversizedLookupIsRefused();
  testDecoratedFindingsAreRemeasured();
  testRelationshipFindingsOpenPrivateRepairRecords();
  console.log('✓ VOD export API lookup and decorated-findings capacity guards');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

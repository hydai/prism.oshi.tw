import { VOD_EXPORT_LIMITS } from './constants';
import {
  assertApiFindingsCapacity,
  forEachD1LookupBinding,
  packedLookupSql,
  repairPathForFinding,
  type D1LookupBinding,
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

const decoder = new TextDecoder();

function decodePackedBinding(binding: Uint8Array): string[] {
  const payloadBytes = Number(decoder.decode(binding.subarray(0, 8)));
  assert(Number.isSafeInteger(payloadBytes), 'packed lookup has a numeric payload length');
  assert(payloadBytes >= 0 && payloadBytes <= binding.byteLength - 8, 'packed payload fits its binding');
  const decoded: string[] = [];
  let offset = 8;
  const end = offset + payloadBytes;
  while (offset < end) {
    const valueBytes = Number(decoder.decode(binding.subarray(offset, offset + 8)));
    assert(Number.isSafeInteger(valueBytes), 'packed lookup has a numeric entry length');
    offset += 8;
    assert(valueBytes >= 0 && offset + valueBytes <= end, 'packed entry fits its payload');
    decoded.push(decoder.decode(binding.subarray(offset, offset + valueBytes)));
    offset += valueBytes;
  }
  equal(offset, end, 'packed lookup consumes its exact payload');
  return decoded;
}

async function testD1LookupBindingsAreBounded(): Promise<void> {
  const values = Array.from(
    { length: 5_000 },
    (_, index) => `${'\u0000'.repeat(395)}${String(index).padStart(5, '0')}`,
  );
  const legacy = JSON.stringify(values);
  assert(utf8ByteLength(legacy) > 2_000_000, 'fixture exceeds D1 single-value limit');

  values[1] = '繁體中文😀\u0000lookup';
  const sqlTargets = [values[1], values[4_700], values[4_999]].filter(
    (value): value is string => value !== undefined,
  );
  const sqlMatches = new Set<string>();
  const decoded: string[] = [];
  const stats = await forEachD1LookupBinding(values, async (binding: D1LookupBinding) => {
    assert(binding.kind === 'packed', 'ordinary lookup values use packed bindings');
    assert(binding.value.byteLength <= 1_900_008, 'packed lookup binding stays below its safety target');
    decoded.push(...decodePackedBinding(binding.value));
    for (const match of await executePackedLookupInSqlite(binding.value, sqlTargets)) sqlMatches.add(match);
  });
  assert(stats.packedBindings > 1, 'large lookup is split into multiple bindings');
  equal(stats.directBindings, 0, 'ordinary lookup values need no direct bindings');
  equal(stats.skippedValues, 0, 'ordinary lookup values are not skipped');
  equal(decoded.length, values.length, 'binding chunks preserve every lookup value');
  for (let index = 0; index < values.length; index += 1) {
    equal(decoded[index], values[index], `binding value ${index} round-trips exactly`);
  }
  for (let index = 0; index < sqlTargets.length; index += 1) {
    const target = sqlTargets[index];
    assert(target !== undefined && sqlMatches.has(target), `production packed SQL preserves target ${index}`);
  }
}

async function executePackedLookupInSqlite(
  binding: Uint8Array,
  targets: readonly string[],
): Promise<string[]> {
  const schema = targets
    .map((target) => `INSERT INTO songs(id) VALUES(CAST(X'${hex(new TextEncoder().encode(target))}' AS TEXT));`)
    .join('\n');
  const sql = packedLookupSql('songs', 'id', 'hex(id)')
    .replace('?', `X'${hex(binding)}'`);
  // @ts-expect-error The Worker project intentionally omits Node ambient types;
  // this test-only dynamic import uses the repository's sqlite3 CLI.
  const { spawnSync } = await import('node:child_process');
  const execution = spawnSync('sqlite3', ['-batch', '-bail', ':memory:'], {
    input: `CREATE TABLE songs(id TEXT PRIMARY KEY);\n${schema}\n${sql};`,
    encoding: 'utf8',
  });
  if (execution.status !== 0) {
    throw new Error(`Packed D1 lookup SQL failed in sqlite3: ${String(execution.stderr)}`);
  }
  const byHex = new Map(targets.map((target) => [hex(new TextEncoder().encode(target)), target]));
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

async function testLargeLookupUsesDirectBinding(): Promise<void> {
  const large = 'x'.repeat(1_950_000);
  let received: string | number | undefined;
  const stats = await forEachD1LookupBinding([large], async (binding) => {
    assert(binding.kind === 'direct', 'near-limit identity uses a direct equality binding');
    received = binding.value;
  });
  equal(stats.packedBindings, 0, 'oversized packed representation is not bound as a packed BLOB');
  equal(stats.directBindings, 1, 'raw value below D1 limit uses direct equality');
  equal(received, large, 'direct binding preserves the exact lookup identity');
  equal(stats.skippedValues, 0, 'bindable raw identity is not skipped');

  const skipped = await forEachD1LookupBinding(['x'.repeat(2_000_001)], async () => {
    throw new Error('identity above the D1 limit must not be bound');
  });
  equal(skipped.packedBindings, 0, 'over-limit identity is not packed');
  equal(skipped.directBindings, 0, 'over-limit identity is not directly bound');
  equal(skipped.skippedValues, 1, 'over-limit optional repair identity is skipped safely');
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
  await testD1LookupBindingsAreBounded();
  await testLargeLookupUsesDirectBinding();
  testDecoratedFindingsAreRemeasured();
  testRelationshipFindingsOpenPrivateRepairRecords();
  console.log('✓ VOD export API lookup and decorated-findings capacity guards');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

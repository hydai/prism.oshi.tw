import { VOD_EXPORT_LIMITS } from './constants';
import {
  assertApiFindingsCapacity,
  planD1LookupBindings,
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

function testD1JsonBindingsAreBounded(): void {
  const values = Array.from(
    { length: 5_000 },
    (_, index) => `${'\u0000'.repeat(245)}${String(index).padStart(5, '0')}`,
  );
  const legacy = JSON.stringify(values);
  assert(utf8ByteLength(legacy) > 2_000_000, 'fixture exceeds D1 single-value limit');

  const plan = planD1LookupBindings(values);
  const bindings = plan.jsonBindings;
  assert(bindings.length > 1, 'large lookup is split into multiple bindings');
  equal(plan.directBindings.length, 0, 'ordinary lookup values need no direct bindings');
  equal(plan.skippedValues, 0, 'ordinary lookup values are not skipped');
  for (const binding of bindings) {
    assert(utf8ByteLength(binding) <= 1_900_000, 'each lookup binding stays below its safety target');
  }
  const decoded = bindings.flatMap((binding) => JSON.parse(binding) as string[]);
  equal(decoded.length, values.length, 'binding chunks preserve every lookup value');
  for (let index = 0; index < values.length; index += 1) {
    equal(decoded[index], values[index], `binding value ${index} round-trips exactly`);
  }
}

function testLargeLookupUsesDirectBinding(): void {
  const large = 'x'.repeat(1_950_000);
  const plan = planD1LookupBindings([large]);
  equal(plan.jsonBindings.length, 0, 'oversized JSON representation is not bound as JSON');
  equal(plan.directBindings.length, 1, 'raw value below D1 limit uses direct equality');
  equal(plan.directBindings[0], large, 'direct binding preserves the exact lookup identity');
  equal(plan.skippedValues, 0, 'bindable raw identity is not skipped');
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
  assert(diagnostic.actual > 0, 'decorated response has a measured byte size');

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
    repairPathForFinding(relationship, new Map([['performance-1', 42]]), new Map(), new Map(), new Map()),
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
    repairPathForFinding(missingSongId, new Map(), new Map(), new Map(), new Map()),
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
    }, new Map(), new Map(), new Map(), new Map([[longSubmissionId, 8]])),
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
    }, new Map(), new Map(), new Map([[longStreamId, 9]]), new Map()),
    '/vod-export/repair/vod/9',
    'large private VOD locator resolves to a short server-controlled row path',
  );
}

function main(): void {
  testD1JsonBindingsAreBounded();
  testLargeLookupUsesDirectBinding();
  testDecoratedFindingsAreRemeasured();
  testRelationshipFindingsOpenPrivateRepairRecords();
  console.log('✓ VOD export API lookup and decorated-findings capacity guards');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

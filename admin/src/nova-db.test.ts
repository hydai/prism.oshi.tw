import { buildStatusFilterQuery } from './query-filters';
import {
  deleteSubmission,
  deleteVod,
  getSubmissionById,
  getSubmissionChannelId,
  getSubmissionForUpdate,
  getSubmissionStatus,
  getVodById,
  getVodStatus,
  listApprovedSubmissionsWithChannel,
  listSubmissions,
  listVodSongs,
  listVods,
  submissionExists,
  updateSubmissionFields,
  updateSubmissionStatus,
  updateSubmissionSubscriberInfo,
  updateSubmissionVerification,
  updateVodFields,
  updateVodStatus,
  vodExists,
} from './nova-db';
import type { NovaEditableField } from './nova-db';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertThrows(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

type Captured = { sql: string; params: unknown[] };

class FakeStatement {
  params: unknown[] = [];
  constructor(private readonly db: FakeD1Database, readonly sql: string) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.firstCalls.push({ sql: this.sql, params: this.params });
    for (const [pattern, row] of this.db.firstResponses) {
      if (this.sql.includes(pattern)) return row as T | null;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.allCalls.push({ sql: this.sql, params: this.params });
    for (const [pattern, rows] of this.db.allResponses) {
      if (this.sql.includes(pattern)) return { results: rows as T[] };
    }
    return { results: [] };
  }

  async run<T>(): Promise<{ results: T[]; meta: { changes: number } }> {
    this.db.runCalls.push({ sql: this.sql, params: this.params });
    for (const [pattern, rows] of this.db.runResponses) {
      if (this.sql.includes(pattern)) return { results: rows as T[], meta: { changes: rows.length } };
    }
    return { results: [], meta: { changes: 1 } };
  }
}

// Hand-rolled D1 stand-in: every prepare() is recorded, and .first/.all/.run
// answer from an ordered list of [SQL substring, response] pairs so a test
// only has to script the shapes it cares about.
class FakeD1Database {
  firstCalls: Captured[] = [];
  allCalls: Captured[] = [];
  runCalls: Captured[] = [];
  firstResponses: Array<[string, unknown]> = [];
  allResponses: Array<[string, unknown[]]> = [];
  runResponses: Array<[string, unknown[]]> = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
}

function asDb(fake: FakeD1Database): D1Database {
  return fake as unknown as D1Database;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// --- buildStatusFilterQuery ---

function testBuildStatusFilterQueryZeroConditions(): void {
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM submissions', 'submitted_at DESC', [null, undefined]);
  assertEqual(sql, 'SELECT * FROM submissions ORDER BY submitted_at DESC', 'no WHERE clause when every condition is absent');
  assertEqual(binds.length, 0, 'no binds when every condition is absent');
}

function testBuildStatusFilterQueryOneCondition(): void {
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM submissions', 'submitted_at DESC', [
    { column: 'status = ?', binds: ['pending'] },
    null,
  ]);
  assertEqual(sql, 'SELECT * FROM submissions WHERE status = ? ORDER BY submitted_at DESC', 'one active condition renders one WHERE clause');
  assertEqual(binds.length, 1, 'one bind for one condition');
  assertEqual(binds[0], 'pending', 'bind value matches the condition');
}

function testBuildStatusFilterQueryTwoConditions(): void {
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM tickets', 'submitted_at DESC', [
    { column: 'status = ?', binds: ['pending'] },
    { column: 'type = ?', binds: ['bug'] },
  ]);
  assertEqual(sql, 'SELECT * FROM tickets WHERE status = ? AND type = ? ORDER BY submitted_at DESC', 'two conditions AND together in order');
  assertEqual(binds.join(','), 'pending,bug', 'binds flatten in clause order');
}

function testBuildStatusFilterQueryMultiBindClause(): void {
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM submissions', 'submitted_at DESC', [
    { column: '(id LIKE ? OR slug LIKE ?)', binds: ['%a%', '%a%'] },
  ]);
  assertEqual(sql, 'SELECT * FROM submissions WHERE (id LIKE ? OR slug LIKE ?) ORDER BY submitted_at DESC', 'a clause may carry more than one ?');
  assertEqual(binds.length, 2, 'both binds from the multi-? clause are kept');
}

// --- Submissions: reads ---

async function testListSubmissionsNoFilters(): Promise<void> {
  const fake = new FakeD1Database();
  await listSubmissions(asDb(fake), {});
  assertEqual(fake.allCalls.length, 1, 'one query issued');
  assertEqual(fake.allCalls[0]!.sql, 'SELECT * FROM submissions ORDER BY submitted_at DESC', 'no filters means no WHERE');
  assertEqual(fake.allCalls[0]!.params.length, 0, 'no binds');
}

async function testListSubmissionsStatusAndSearch(): Promise<void> {
  const fake = new FakeD1Database();
  await listSubmissions(asDb(fake), { status: 'approved', search: 'foo' });
  const call = fake.allCalls[0]!;
  assertEqual(
    call.sql,
    "SELECT * FROM submissions WHERE status = ? AND (id LIKE ? OR slug LIKE ? OR display_name LIKE ? OR youtube_channel_id LIKE ?) ORDER BY submitted_at DESC",
    'status + search compose one WHERE with AND',
  );
  assertEqual(call.params.join(','), 'approved,%foo%,%foo%,%foo%,%foo%', 'status bind then four identical LIKE patterns');
}

async function testGetSubmissionByIdRoundTrips(): Promise<void> {
  const found = new FakeD1Database();
  found.firstResponses.push(['SELECT * FROM submissions WHERE id = ?', { id: 'sub-1', slug: 'alice' }]);
  const row = await getSubmissionById(asDb(found), 'sub-1');
  assertEqual((row as { slug: string } | null)?.slug, 'alice', 'full row is returned');

  const missing = new FakeD1Database();
  assertEqual(await getSubmissionById(asDb(missing), 'sub-missing'), null, 'a missing id returns null');
}

async function testGetSubmissionForUpdateProjection(): Promise<void> {
  const fake = new FakeD1Database();
  await getSubmissionForUpdate(asDb(fake), 'sub-1');
  const sql = fake.firstCalls[0]!.sql;
  assert(sql.includes('youtube_channel_id') && sql.includes('youtube_channel_verified_id') && sql.includes('youtube_channel_verified_at'), 'projects the verification columns');
  assert(!sql.includes('SELECT *'), 'does not select every column');
  assertEqual(fake.firstCalls[0]!.params[0], 'sub-1', 'binds the id');
}

async function testGetSubmissionChannelIdProjection(): Promise<void> {
  const fake = new FakeD1Database();
  await getSubmissionChannelId(asDb(fake), 'sub-1');
  assertEqual(fake.firstCalls[0]!.sql, 'SELECT id, youtube_channel_id FROM submissions WHERE id = ?', 'narrow channel-id projection');
}

async function testGetSubmissionStatusProjection(): Promise<void> {
  const fake = new FakeD1Database();
  await getSubmissionStatus(asDb(fake), 'sub-1');
  assertEqual(fake.firstCalls[0]!.sql, 'SELECT id, status FROM submissions WHERE id = ?', 'narrow status projection');
}

async function testSubmissionExists(): Promise<void> {
  const present = new FakeD1Database();
  present.firstResponses.push(['SELECT id FROM submissions WHERE id = ?', { id: 'sub-1' }]);
  assertEqual(await submissionExists(asDb(present), 'sub-1'), true, 'a found row means exists');

  const absent = new FakeD1Database();
  assertEqual(await submissionExists(asDb(absent), 'sub-missing'), false, 'no row means does not exist');
}

async function testDeleteSubmissionIssuesDelete(): Promise<void> {
  const fake = new FakeD1Database();
  await deleteSubmission(asDb(fake), 'sub-1');
  assertEqual(fake.runCalls[0]!.sql, 'DELETE FROM submissions WHERE id = ?', 'deletes by id');
  assertEqual(fake.runCalls[0]!.params[0], 'sub-1', 'binds the id');
}

async function testListApprovedSubmissionsWithChannel(): Promise<void> {
  const fake = new FakeD1Database();
  await listApprovedSubmissionsWithChannel(asDb(fake));
  const sql = fake.allCalls[0]!.sql;
  assert(sql.includes("status = 'approved'") && sql.includes("youtube_channel_id != ''"), 'filters to approved submissions with a channel id set');
}

// --- Submissions: updateSubmissionFields ---

async function testUpdateSubmissionFieldsBuildsDynamicSet(): Promise<void> {
  const fake = new FakeD1Database();
  const applied = await updateSubmissionFields(asDb(fake), 'sub-1', {
    display_name: 'Alice',
    enabled: 1,
  });
  assertEqual(applied, true, 'reports that it applied a write');
  const call = fake.runCalls[0]!;
  assertEqual(call.sql, 'UPDATE submissions SET "display_name" = ?, "enabled" = ? WHERE id = ?', 'allow-list order drives SET clause order, column names quoted');
  assertEqual(call.params.join(','), 'Alice,1,sub-1', 'values then id, in the same order as the SET clauses');
}

async function testUpdateSubmissionFieldsDerivesNormalizedUrl(): Promise<void> {
  const fake = new FakeD1Database();
  await updateSubmissionFields(asDb(fake), 'sub-1', {
    youtube_channel_url: '  HTTPS://YouTube.com/Alice  ',
  });
  const call = fake.runCalls[0]!;
  assert(call.sql.includes('"youtube_channel_url_normalized" = ?'), 'also sets the normalized index column');
  assertEqual(call.params[1], 'https://youtube.com/alice', 'normalized value is trimmed and lower-cased');
}

async function testUpdateSubmissionFieldsAppliesVerification(): Promise<void> {
  const fake = new FakeD1Database();
  await updateSubmissionFields(asDb(fake), 'sub-1', { youtube_channel_id: 'UC123' }, {
    channelId: 'UC123',
    verifiedAt: '2026-01-01T00:00:00.000Z',
  });
  const call = fake.runCalls[0]!;
  assert(call.sql.includes('"youtube_channel_verified_id" = ?') && call.sql.includes('"youtube_channel_verified_at" = ?'), 'verification pair is appended to the SET clause');
  assertEqual(call.params.join(','), 'UC123,UC123,2026-01-01T00:00:00.000Z,sub-1', 'field value first, then the verification pair, then id');
}

async function testUpdateSubmissionFieldsAllowsNullVerification(): Promise<void> {
  const fake = new FakeD1Database();
  await updateSubmissionFields(asDb(fake), 'sub-1', { youtube_channel_id: '' }, {
    channelId: null,
    verifiedAt: null,
  });
  const call = fake.runCalls[0]!;
  assertEqual(call.params[1], null, 'a null verification pair (channel cleared) is written as null, not skipped');
  assertEqual(call.params[2], null, 'both verification columns go null together');
}

async function testUpdateSubmissionFieldsIgnoresUnknownKeys(): Promise<void> {
  const fake = new FakeD1Database();
  const smuggled = { display_name: 'Alice', maliciousColumn: 'DROP TABLE submissions' } as unknown as Partial<Record<NovaEditableField, string | number>>;
  await updateSubmissionFields(asDb(fake), 'sub-1', smuggled);
  const call = fake.runCalls[0]!;
  assert(!call.sql.includes('maliciousColumn'), 'a key outside the allow-list never reaches SQL text');
  assert(!call.params.includes('DROP TABLE submissions'), 'its value never reaches the bind list either');
}

async function testUpdateSubmissionFieldsNoOpWhenEmpty(): Promise<void> {
  const fake = new FakeD1Database();
  const applied = await updateSubmissionFields(asDb(fake), 'sub-1', {});
  assertEqual(applied, false, 'reports nothing was applied');
  assertEqual(fake.runCalls.length, 0, 'no statement is ever run for an empty update');
}

// --- Submissions: status / verification / subscriber writes ---

async function testUpdateSubmissionStatusApproved(): Promise<void> {
  const fake = new FakeD1Database();
  await updateSubmissionStatus(asDb(fake), 'sub-1', 'approved', undefined);
  const call = fake.runCalls[0]!;
  assertEqual(call.sql, 'UPDATE submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?', 'status write shape');
  assertEqual(call.params[0], 'approved', 'status bound');
  assert(typeof call.params[1] === 'string' && ISO_RE.test(call.params[1] as string), 'reviewed_at is an ISO-8601-with-ms timestamp when not pending');
  assertEqual(call.params[2], '', 'reviewer_note defaults to empty string when omitted');
  assertEqual(call.params[3], 'sub-1', 'id bound last');
}

async function testUpdateSubmissionStatusPendingClearsReviewMetadata(): Promise<void> {
  const fake = new FakeD1Database();
  await updateSubmissionStatus(asDb(fake), 'sub-1', 'pending', 'ignored note');
  const call = fake.runCalls[0]!;
  assertEqual(call.params[1], null, 'reviewed_at is null when reverting to pending');
  assertEqual(call.params[2], null, 'reviewer_note is null when reverting to pending, even if one was supplied');
}

async function testUpdateSubmissionStatusRejectsUnknownStatus(): Promise<void> {
  const fake = new FakeD1Database();
  await assertThrows(
    () => updateSubmissionStatus(asDb(fake), 'sub-1', 'archived' as unknown as 'pending', undefined),
    'a status outside NOVA_STATUSES must be rejected',
  );
  assertEqual(fake.runCalls.length, 0, 'rejection happens before any statement runs');
}

async function testUpdateSubmissionVerificationSuccessAndConflict(): Promise<void> {
  const matched = new FakeD1Database();
  matched.runResponses.push(['RETURNING id', [{ id: 'sub-1' }]]);
  assertEqual(
    await updateSubmissionVerification(asDb(matched), 'sub-1', 'UC1', 'UC1', '2026-01-01T00:00:00.000Z'),
    true,
    'a matching RETURNING row means the write landed',
  );

  const conflicted = new FakeD1Database();
  assertEqual(
    await updateSubmissionVerification(asDb(conflicted), 'sub-1', 'UC1', 'UC1', '2026-01-01T00:00:00.000Z'),
    false,
    'no RETURNING row (channel id changed concurrently) means the write did not land',
  );
}

async function testUpdateSubmissionSubscriberInfoSuccessAndConflict(): Promise<void> {
  const matched = new FakeD1Database();
  matched.runResponses.push(['RETURNING id', [{ id: 'sub-1' }]]);
  const ok = await updateSubmissionSubscriberInfo(asDb(matched), 'sub-1', 'UC1', {
    subscriberCount: '1.2K',
    avatarUrl: 'https://example.com/a.png',
    verifiedChannelId: 'UC1',
    verifiedAt: '2026-01-01T00:00:00.000Z',
  });
  assertEqual(ok, true, 'a matching RETURNING row means the write landed');
  assertEqual(matched.runCalls[0]!.params.join(','), '1.2K,https://example.com/a.png,UC1,2026-01-01T00:00:00.000Z,sub-1,UC1', 'bind order: info fields, then id, then expected channel id');

  const conflicted = new FakeD1Database();
  const failed = await updateSubmissionSubscriberInfo(asDb(conflicted), 'sub-1', 'UC1', {
    subscriberCount: '1.2K',
    avatarUrl: '',
    verifiedChannelId: 'UC1',
    verifiedAt: '2026-01-01T00:00:00.000Z',
  });
  assertEqual(failed, false, 'no RETURNING row means the write did not land');
}

// --- VOD submissions ---

async function testListVodsFilters(): Promise<void> {
  const none = new FakeD1Database();
  await listVods(asDb(none), {});
  assertEqual(none.allCalls[0]!.sql, 'SELECT * FROM vod_submissions ORDER BY submitted_at DESC', 'no filters means no WHERE');

  const both = new FakeD1Database();
  await listVods(asDb(both), { status: 'pending', streamer: 'alice' });
  assertEqual(
    both.allCalls[0]!.sql,
    'SELECT * FROM vod_submissions WHERE status = ? AND streamer_slug = ? ORDER BY submitted_at DESC',
    'status + streamer compose one WHERE with AND',
  );
  assertEqual(both.allCalls[0]!.params.join(','), 'pending,alice', 'binds in clause order');
}

async function testGetVodByIdRoundTrips(): Promise<void> {
  const found = new FakeD1Database();
  found.firstResponses.push(['SELECT * FROM vod_submissions WHERE id = ?', { id: 'vod-1' }]);
  assertEqual((await getVodById(asDb(found), 'vod-1') as { id: string } | null)?.id, 'vod-1', 'full row returned');

  const missing = new FakeD1Database();
  assertEqual(await getVodById(asDb(missing), 'vod-missing'), null, 'missing id returns null');
}

async function testGetVodStatusProjection(): Promise<void> {
  const fake = new FakeD1Database();
  await getVodStatus(asDb(fake), 'vod-1');
  assertEqual(fake.firstCalls[0]!.sql, 'SELECT id, status FROM vod_submissions WHERE id = ?', 'narrow status projection');
}

async function testVodExists(): Promise<void> {
  const present = new FakeD1Database();
  present.firstResponses.push(['SELECT id FROM vod_submissions WHERE id = ?', { id: 'vod-1' }]);
  assertEqual(await vodExists(asDb(present), 'vod-1'), true, 'a found row means exists');
  const absent = new FakeD1Database();
  assertEqual(await vodExists(asDb(absent), 'vod-missing'), false, 'no row means does not exist');
}

async function testDeleteVodIssuesDelete(): Promise<void> {
  const fake = new FakeD1Database();
  await deleteVod(asDb(fake), 'vod-1');
  assertEqual(fake.runCalls[0]!.sql, 'DELETE FROM vod_submissions WHERE id = ?', 'deletes by id');
}

async function testListVodSongsOrdersAscending(): Promise<void> {
  const fake = new FakeD1Database();
  await listVodSongs(asDb(fake), 'vod-1');
  assertEqual(fake.allCalls[0]!.sql, 'SELECT * FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order ASC', 'explicit ascending order, serving both the detail view and the import path');
  assertEqual(fake.allCalls[0]!.params[0], 'vod-1', 'binds the vod submission id');
}

async function testUpdateVodStatusPendingVsApproved(): Promise<void> {
  const approvedFake = new FakeD1Database();
  await updateVodStatus(asDb(approvedFake), 'vod-1', 'approved', 'looks good');
  const approvedCall = approvedFake.runCalls[0]!;
  assertEqual(approvedCall.sql, 'UPDATE vod_submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?', 'status write shape');
  assertEqual(approvedCall.params[2], 'looks good', 'reviewer_note carried through when not pending');

  const pendingFake = new FakeD1Database();
  await updateVodStatus(asDb(pendingFake), 'vod-1', 'pending', 'looks good');
  assertEqual(pendingFake.runCalls[0]!.params[1], null, 'reviewed_at nulled when reverting to pending');
  assertEqual(pendingFake.runCalls[0]!.params[2], null, 'reviewer_note nulled when reverting to pending');
}

async function testUpdateVodStatusRejectsUnknownStatus(): Promise<void> {
  const fake = new FakeD1Database();
  await assertThrows(
    () => updateVodStatus(asDb(fake), 'vod-1', 'archived' as unknown as 'pending', undefined),
    'a status outside NOVA_STATUSES must be rejected',
  );
  assertEqual(fake.runCalls.length, 0, 'rejection happens before any statement runs');
}

async function testUpdateVodFieldsBuildsDynamicSetAndIgnoresUnknownKeys(): Promise<void> {
  const fake = new FakeD1Database();
  const smuggled = { stream_title: 'New Title', reviewer_note: 'ok', extra: 'nope' } as unknown as Record<string, string>;
  const applied = await updateVodFields(asDb(fake), 'vod-1', smuggled);
  assertEqual(applied, true, 'reports that it applied a write');
  const call = fake.runCalls[0]!;
  assertEqual(call.sql, 'UPDATE vod_submissions SET stream_title = ?, reviewer_note = ? WHERE id = ?', 'allow-list order, unquoted (no reserved words among vod columns)');
  assertEqual(call.params.join(','), 'New Title,ok,vod-1', 'values then id');
  assert(!call.sql.includes('extra'), 'a key outside the allow-list never reaches SQL text');
}

async function testUpdateVodFieldsNoOpWhenEmpty(): Promise<void> {
  const fake = new FakeD1Database();
  const applied = await updateVodFields(asDb(fake), 'vod-1', {});
  assertEqual(applied, false, 'reports nothing was applied');
  assertEqual(fake.runCalls.length, 0, 'no statement is ever run for an empty update');
}

async function main(): Promise<void> {
  testBuildStatusFilterQueryZeroConditions();
  testBuildStatusFilterQueryOneCondition();
  testBuildStatusFilterQueryTwoConditions();
  testBuildStatusFilterQueryMultiBindClause();

  await testListSubmissionsNoFilters();
  await testListSubmissionsStatusAndSearch();
  await testGetSubmissionByIdRoundTrips();
  await testGetSubmissionForUpdateProjection();
  await testGetSubmissionChannelIdProjection();
  await testGetSubmissionStatusProjection();
  await testSubmissionExists();
  await testDeleteSubmissionIssuesDelete();
  await testListApprovedSubmissionsWithChannel();

  await testUpdateSubmissionFieldsBuildsDynamicSet();
  await testUpdateSubmissionFieldsDerivesNormalizedUrl();
  await testUpdateSubmissionFieldsAppliesVerification();
  await testUpdateSubmissionFieldsAllowsNullVerification();
  await testUpdateSubmissionFieldsIgnoresUnknownKeys();
  await testUpdateSubmissionFieldsNoOpWhenEmpty();

  await testUpdateSubmissionStatusApproved();
  await testUpdateSubmissionStatusPendingClearsReviewMetadata();
  await testUpdateSubmissionStatusRejectsUnknownStatus();
  await testUpdateSubmissionVerificationSuccessAndConflict();
  await testUpdateSubmissionSubscriberInfoSuccessAndConflict();

  await testListVodsFilters();
  await testGetVodByIdRoundTrips();
  await testGetVodStatusProjection();
  await testVodExists();
  await testDeleteVodIssuesDelete();
  await testListVodSongsOrdersAscending();
  await testUpdateVodStatusPendingVsApproved();
  await testUpdateVodStatusRejectsUnknownStatus();
  await testUpdateVodFieldsBuildsDynamicSetAndIgnoresUnknownKeys();
  await testUpdateVodFieldsNoOpWhenEmpty();

  console.log('✓ nova-db: filter composition, allow-listed writes, and optimistic-concurrency updates');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import {
  buildHighConfidenceWorkCandidates,
  listWorkMatchCandidates,
  mergeWorkMatchCandidate,
  reviewWorkMatchCandidate,
  WorkMatchError,
  type WorkMatchSourceRow,
} from './work-review';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function row(
  workId: string,
  title: string,
  artist: string,
  songId: string,
  streamerId: string,
  performances: number,
  tags = '[]',
): WorkMatchSourceRow {
  return {
    work_id: workId,
    title,
    original_artist: artist,
    work_tags: tags,
    work_created_at: '2026-01-01 00:00:00',
    work_updated_at: '2026-01-02 00:00:00',
    song_id: songId,
    streamer_id: streamerId,
    song_status: 'approved',
    performance_count: performances,
  };
}

const SOURCE_ROWS: WorkMatchSourceRow[] = [
  row('work-case-main', 'I Love You 3000', 'Stephanie Poetri', 'song-a', 'alice', 8, '["pop"]'),
  row('work-case-main', 'I Love You 3000', 'Stephanie Poetri', 'song-b', 'bob', 4, '["pop"]'),
  row('work-case-alt', 'I love you 3000', 'Stephanie Poetri', 'song-c', 'alice', 2, '["english"]'),
  row('work-punctuation-main', '斑馬斑馬', '宋冬野', 'song-d', 'carol', 5),
  row('work-punctuation-alt', '斑馬，斑馬', '宋冬野', 'song-e', 'dave', 1),
  row('work-accent-main', 'My Heart Will Go On', 'Céline Dion', 'song-f', 'erin', 4),
  row('work-accent-alt', 'My Heart Will Go On', 'Celine Dion', 'song-g', 'frank', 1),
  row('work-japanese-one', 'Japanese Guard', 'ボカロP', 'song-h', 'gina', 1),
  row('work-japanese-two', 'Japanese Guard', 'ポカロP', 'song-i', 'hank', 1),
  row('work-japanese-combining-dakuten-base', 'わ', 'Japanese Combining Guard', 'song-j', 'iris', 1),
  row('work-japanese-combining-dakuten-mark', 'わ\u3099', 'Japanese Combining Guard', 'song-k', 'jane', 1),
  row('work-japanese-combining-handakuten-base', 'か', 'Japanese Combining Guard', 'song-l', 'kate', 1),
  row('work-japanese-combining-handakuten-mark', 'か\u309a', 'Japanese Combining Guard', 'song-m', 'lena', 1),
  row('work-symbol-heart', 'Love ♥', 'Symbol Guard', 'song-n', 'mona', 1),
  row('work-symbol-star', 'Love ☆', 'Symbol Guard', 'song-o', 'nora', 1),
  row('work-symbol-flat', 'Song ♭', 'Symbol Guard', 'song-p', 'olivia', 1),
  row('work-symbol-sharp', 'Song ♯', 'Symbol Guard', 'song-q', 'pat', 1),
];

const PARTIAL_MERGE_ROWS: WorkMatchSourceRow[] = [
  row('work-partial-main', 'Partial Title', 'Example Artist', 'partial-song-a', 'alice', 10),
  row('work-partial-one', 'partial title', 'Example Artist', 'partial-song-b', 'bob', 4),
  row('work-partial-two', 'Ｐａｒｔｉａｌ Ｔｉｔｌｅ', 'Example Artist', 'partial-song-c', 'carol', 2),
];

type CapturedStatement = { sql: string; params: unknown[] };

class FakeStatement {
  params: unknown[] = [];

  constructor(
    private readonly db: FakeD1,
    readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    if (/INSERT\s+INTO\s+work_match_reviews/i.test(this.sql)) {
      return {
        results: (this.db.reviewGuardValid ? [{ candidate_key: 'fake-candidate' }] : []) as T[],
      };
    }
    return { results: [] };
  }
}

class FakeD1 {
  readonly executed: CapturedStatement[] = [];
  readonly mergeStatements: CapturedStatement[] = [];
  reviewGuardValid = true;
  mergeGuardValid = true;

  constructor(
    readonly rows: WorkMatchSourceRow[],
    readonly reviewRows: unknown[] = [],
  ) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ results: unknown[]; meta: { changes: number } }>> {
    if (statements.length === 3 && statements[0]?.sql.includes('work_match_state')) {
      return [
        { results: [{ revision: 7 }], meta: { changes: 0 } },
        { results: this.rows, meta: { changes: 0 } },
        { results: this.reviewRows, meta: { changes: 0 } },
      ];
    }

    this.mergeStatements.push(...statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params,
    })));
    return statements.map((statement, index) => {
      if (index === 0 && /RETURNING\s+1\s+AS\s+valid/i.test(statement.sql)) {
        return {
          results: this.mergeGuardValid ? [{ valid: 1 }] : [],
          meta: { changes: this.mergeGuardValid ? 1 : 0 },
        };
      }
      if (!this.mergeGuardValid && /work_merge_guard/i.test(statement.sql)) {
        return { results: [], meta: { changes: 0 } };
      }
      if (/UPDATE\s+song_work_links/i.test(statement.sql)) {
        return { results: [], meta: { changes: 1 } };
      }
      if (/DELETE\s+FROM\s+works/i.test(statement.sql)) {
        return { results: [], meta: { changes: 1 } };
      }
      return { results: [], meta: { changes: 1 } };
    });
  }
}

async function testTierACandidateGeneration(): Promise<void> {
  const candidates = await buildHighConfidenceWorkCandidates(SOURCE_ROWS);
  equal(candidates.length, 3, 'only the three format-only duplicate clusters are returned');

  const caseCandidate = candidates.find((candidate) => (
    candidate.works.some((work) => work.id === 'work-case-main')
  ));
  assert(caseCandidate, 'case variant candidate exists');
  equal(caseCandidate.suggestedCanonicalWorkId, 'work-case-main', 'usage selects the canonical work');
  equal(caseCandidate.songCount, 3, 'candidate preserves every linked local song');
  equal(caseCandidate.performanceCount, 14, 'candidate counts every preserved performance');
  equal(caseCandidate.localDuplicates[0]?.streamerId, 'alice', 'same-streamer follow-up is visible');
  equal(caseCandidate.localDuplicates[0]?.songCount, 2, 'local follow-up includes both local songs');
  assert(
    caseCandidate.reasons.includes('case_width_whitespace'),
    'case normalization is an explicit reason',
  );
  assert(
    !caseCandidate.reasons.includes('punctuation_spacing'),
    'case-only matches are not mislabeled as punctuation variants',
  );

  const accentCandidate = candidates.find((candidate) => (
    candidate.works.some((work) => work.id === 'work-accent-main')
  ));
  assert(accentCandidate?.reasons.includes('diacritic_variant'), 'Latin accents are a Tier A signal');
  assert(
    !candidates.some((candidate) => candidate.works.some((work) => work.id === 'work-japanese-one')),
    'Japanese dakuten differences are not folded as Latin accents',
  );
  assert(
    !candidates.some((candidate) => candidate.works.some((work) => (
      work.id.startsWith('work-japanese-combining-')
    ))),
    'non-composable Japanese voicing marks remain significant',
  );
  assert(
    !candidates.some((candidate) => candidate.works.some((work) => (
      work.id.startsWith('work-symbol-')
    ))),
    'semantic Unicode symbol differences remain significant',
  );
  assert(candidates.every((candidate) => candidate.candidateKey.length === 64), 'candidate keys are SHA-256');
  assert(candidates.every((candidate) => candidate.fingerprint.length === 64), 'fingerprints are SHA-256');
}

async function testReviewedFingerprintFiltering(): Promise<void> {
  const initial = await buildHighConfidenceWorkCandidates(SOURCE_ROWS);
  const reviewed = initial[0]!;
  const fakeDb = new FakeD1(SOURCE_ROWS, [{
    candidate_key: reviewed.candidateKey,
    fingerprint: reviewed.fingerprint,
    decision: 'not_duplicate',
    note: 'Verified separate compositions',
    review_version: 3,
    reviewed_by: 'curator@example.com',
    reviewed_at: '2026-07-19 00:00:00',
  }]);

  const pending = await listWorkMatchCandidates(fakeDb as unknown as D1Database, {
    filter: 'pending',
  });
  equal(pending.stats.notDuplicateCount, 1, 'review stats include the persisted decision');
  equal(pending.total, initial.length - 1, 'the exact reviewed fingerprint leaves the pending queue');

  const dismissed = await listWorkMatchCandidates(fakeDb as unknown as D1Database, {
    filter: 'not_duplicate',
  });
  equal(dismissed.total, 1, 'reviewed candidate remains auditable');
  equal(dismissed.data[0]?.reviewNote, 'Verified separate compositions', 'review note is retained');
  equal(dismissed.data[0]?.reviewVersion, 3, 'review record version is exposed for optimistic concurrency');
}

async function testReviewDecisionUsesRevisionGuard(): Promise<void> {
  const candidate = (await buildHighConfidenceWorkCandidates(SOURCE_ROWS))[0]!;
  const fakeDb = new FakeD1(SOURCE_ROWS);
  await reviewWorkMatchCandidate(
    fakeDb as unknown as D1Database,
    {
      candidateKey: candidate.candidateKey,
      fingerprint: candidate.fingerprint,
      workIds: candidate.works.map((work) => work.id),
      decision: 'needs_research',
      expectedReviewVersion: null,
      note: 'Check official credits',
    },
    'curator@example.com',
  );

  const write = fakeDb.executed.find((statement) => /INSERT\s+INTO\s+work_match_reviews/i.test(statement.sql));
  assert(write, 'review decision is persisted');
  assert(/work_match_state/i.test(write.sql), 'review write is bound to the scanned catalog revision');
  assert(/ON\s+CONFLICT\s*\(candidate_key,\s*fingerprint\)/i.test(write.sql), 'reviews are content-addressed');
  assert(/review_version\s*=\s*work_match_reviews\.review_version\s*\+\s*1/i.test(write.sql), 'review updates increment an atomic record version');

  const staleDb = new FakeD1(SOURCE_ROWS);
  staleDb.reviewGuardValid = false;
  let caught: unknown;
  try {
    await reviewWorkMatchCandidate(
      staleDb as unknown as D1Database,
      {
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        workIds: candidate.works.map((work) => work.id),
        decision: 'not_duplicate',
        expectedReviewVersion: null,
      },
      'curator@example.com',
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof WorkMatchError, 'stale review fails closed');
  equal(caught.code, 'work_match_stale', 'stale review has a retryable conflict code');

  const concurrentReviewDb = new FakeD1(SOURCE_ROWS, [{
    candidate_key: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    decision: 'needs_research',
    note: 'Saved in another session',
    review_version: 2,
    reviewed_by: 'other-curator@example.com',
    reviewed_at: '2026-07-19 01:00:00',
  }]);
  caught = undefined;
  try {
    await reviewWorkMatchCandidate(
      concurrentReviewDb as unknown as D1Database,
      {
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        workIds: candidate.works.map((work) => work.id),
        decision: 'not_duplicate',
        expectedReviewVersion: null,
      },
      'curator@example.com',
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof WorkMatchError, 'concurrent review decision changes fail closed');
  equal(caught.code, 'work_match_stale', 'concurrent review overwrite requires a refresh');
  equal(concurrentReviewDb.executed.length, 0, 'stale review version performs no write');
}

async function testGlobalWorkMergePreservesLocalEntities(): Promise<void> {
  const candidate = (await buildHighConfidenceWorkCandidates(SOURCE_ROWS)).find((item) => (
    item.works.some((work) => work.id === 'work-case-main')
  ));
  assert(candidate, 'merge fixture candidate exists');
  const fakeDb = new FakeD1(SOURCE_ROWS);
  const result = await mergeWorkMatchCandidate(
    fakeDb as unknown as D1Database,
    {
      candidateKey: candidate.candidateKey,
      fingerprint: candidate.fingerprint,
      catalogRevision: 7,
      expectedReviewVersion: null,
      canonicalWorkId: 'work-case-main',
      sourceWorkIds: ['work-case-alt'],
      note: '  Verified official source  ',
    },
    'curator@example.com',
  );

  equal(result.mergedWorks, 1, 'one duplicate work is retired');
  equal(result.relinkedSongs, 1, 'source work local songs are repointed');
  equal(result.preservedSongs, 3, 'all local song rows are reported as preserved');
  equal(result.preservedPerformances, 14, 'all performances are reported as preserved');

  const sql = fakeDb.mergeStatements.map((statement) => statement.sql).join('\n');
  assert(/work_match_state/i.test(fakeDb.mergeStatements[0]?.sql ?? ''), 'merge guard binds the catalog revision');
  assert(/expected_links/i.test(fakeDb.mergeStatements[0]?.sql ?? ''), 'merge guard binds every reviewed song link');
  assert(/work_match_reviews/i.test(fakeDb.mergeStatements[0]?.sql ?? ''), 'merge guard binds the displayed review record');
  assert(/review_version/i.test(fakeDb.mergeStatements[0]?.sql ?? ''), 'merge guard checks the displayed review version');
  assert(/INSERT\s+INTO\s+work_aliases/i.test(sql), 'retired work metadata is snapshotted');
  const audit = fakeDb.mergeStatements.find((statement) => (
    /INSERT\s+INTO\s+work_match_merge_audits/i.test(statement.sql)
  ));
  assert(audit, 'confirmed merge writes durable review audit evidence');
  assert(audit.params.includes('Verified official source'), 'merge audit preserves the trimmed curator note');
  assert(/UPDATE\s+song_work_links/i.test(sql), 'local songs are repointed through the bridge');
  assert(/DELETE\s+FROM\s+works/i.test(sql), 'only source work identities are deleted');
  assert(!/DELETE\s+FROM\s+songs/i.test(sql), 'global merge never deletes a song');
  assert(!/UPDATE\s+performances/i.test(sql), 'global merge never changes a performance');
  assert(!/DELETE\s+FROM\s+performances/i.test(sql), 'global merge never deletes a performance');
  const aliasIndex = fakeDb.mergeStatements.findIndex((statement) => (
    /INSERT\s+INTO\s+work_aliases/i.test(statement.sql)
    && /SELECT\s+source\.id/i.test(statement.sql)
  ));
  const deleteIndex = fakeDb.mergeStatements.findIndex((statement) => /DELETE\s+FROM\s+works/i.test(statement.sql));
  assert(aliasIndex >= 0 && aliasIndex < deleteIndex, 'source work is snapshotted before deletion');

  const staleDb = new FakeD1(SOURCE_ROWS);
  staleDb.mergeGuardValid = false;
  let caught: unknown;
  try {
    await mergeWorkMatchCandidate(
      staleDb as unknown as D1Database,
      {
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        catalogRevision: 7,
        expectedReviewVersion: null,
        canonicalWorkId: 'work-case-main',
        sourceWorkIds: ['work-case-alt'],
      },
      'curator@example.com',
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof WorkMatchError, 'transaction-time catalog changes fail closed');
  equal(caught.code, 'work_match_stale', 'stale merge returns the conflict code');

  const staleDisplayDb = new FakeD1(SOURCE_ROWS);
  caught = undefined;
  try {
    await mergeWorkMatchCandidate(
      staleDisplayDb as unknown as D1Database,
      {
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        catalogRevision: 6,
        expectedReviewVersion: null,
        canonicalWorkId: 'work-case-main',
        sourceWorkIds: ['work-case-alt'],
      },
      'curator@example.com',
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof WorkMatchError, 'a changed displayed catalog revision fails closed');
  equal(caught.code, 'work_match_stale', 'displayed revision conflicts require reconfirmation');
  equal(staleDisplayDb.mergeStatements.length, 0, 'stale displayed impact performs no writes');

  const concurrentReviewDb = new FakeD1(SOURCE_ROWS, [{
    candidate_key: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    decision: 'not_duplicate',
    note: 'Saved in another session',
    review_version: 2,
    reviewed_by: 'other-curator@example.com',
    reviewed_at: '2026-07-19 02:00:00',
  }]);
  caught = undefined;
  try {
    await mergeWorkMatchCandidate(
      concurrentReviewDb as unknown as D1Database,
      {
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        catalogRevision: 7,
        expectedReviewVersion: null,
        canonicalWorkId: 'work-case-main',
        sourceWorkIds: ['work-case-alt'],
      },
      'curator@example.com',
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof WorkMatchError, 'a changed review decision invalidates an open confirmation');
  equal(caught.code, 'work_match_stale', 'changed review versions require reconfirmation');
  equal(concurrentReviewDb.mergeStatements.length, 0, 'stale displayed review performs no writes');
}

async function testPartialGlobalWorkMerge(): Promise<void> {
  const candidate = (await buildHighConfidenceWorkCandidates(PARTIAL_MERGE_ROWS))[0];
  assert(candidate, 'partial merge fixture candidate exists');
  equal(candidate.works.length, 3, 'partial merge fixture has multiple possible sources');

  const fakeDb = new FakeD1(PARTIAL_MERGE_ROWS);
  const result = await mergeWorkMatchCandidate(
    fakeDb as unknown as D1Database,
    {
      candidateKey: candidate.candidateKey,
      fingerprint: candidate.fingerprint,
      catalogRevision: 7,
      expectedReviewVersion: null,
      canonicalWorkId: 'work-partial-main',
      sourceWorkIds: ['work-partial-one'],
    },
    'curator@example.com',
  );

  equal(result.preservedSongs, 2, 'partial merge reports only the confirmed batch songs');
  equal(result.preservedPerformances, 14, 'partial merge reports only the confirmed batch performances');
  const expectedWorkState = JSON.parse(String(fakeDb.mergeStatements[0]?.params[0])) as Record<string, unknown>;
  assert(expectedWorkState['work-partial-main'], 'partial guard includes the canonical work');
  assert(expectedWorkState['work-partial-one'], 'partial guard includes the confirmed source');
  assert(!expectedWorkState['work-partial-two'], 'partial guard excludes deferred sources');
}

async function main(): Promise<void> {
  await testTierACandidateGeneration();
  await testReviewedFingerprintFiltering();
  await testReviewDecisionUsesRevisionGuard();
  await testGlobalWorkMergePreservesLocalEntities();
  await testPartialGlobalWorkMerge();
  console.log('✓ global work review is conservative, content-addressed, and performance-safe');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

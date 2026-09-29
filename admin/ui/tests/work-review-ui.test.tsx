import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AuthUser,
  WorkMatchCandidate,
  WorkMatchCandidatesResponse,
} from '../../shared/types';
import type { WorkReviewState } from '../src/pages/work-review-state';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installLocalStorage(): void {
  const storage = new Map<string, string>([['prism_admin_streamer', 'mizuki']]);
  const stub: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}

const candidate: WorkMatchCandidate = {
  candidateKey: 'a'.repeat(64),
  fingerprint: 'b'.repeat(64),
  catalogRevision: 7,
  confidence: 'high',
  reasons: ['case_width_whitespace'],
  works: [
    {
      id: 'work-canonical',
      title: 'I Love You 3000',
      originalArtist: 'Stephanie Poetri',
      tags: ['pop'],
      streamerCount: 2,
      songCount: 2,
      performanceCount: 8,
      approvedSongCount: 2,
      pendingSongCount: 0,
      streamerIds: ['alice', 'bob'],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    },
    {
      id: 'work-source',
      title: 'I love you 3000',
      originalArtist: 'Stephanie Poetri',
      tags: ['english'],
      streamerCount: 1,
      songCount: 1,
      performanceCount: 2,
      approvedSongCount: 1,
      pendingSongCount: 0,
      streamerIds: ['alice'],
      createdAt: '2026-01-03',
      updatedAt: '2026-01-04',
    },
  ],
  suggestedCanonicalWorkId: 'work-canonical',
  streamerCount: 2,
  songCount: 3,
  performanceCount: 10,
  localDuplicates: [{ streamerId: 'alice', songCount: 2 }],
  decision: null,
  reviewNote: '',
  reviewVersion: null,
  reviewedBy: null,
  reviewedAt: null,
};

/** The fixture under another key; the catalog revision tells a row on screen (7) from its re-read (8). */
function rowAt(candidateKey: string, catalogRevision = 7): WorkMatchCandidate {
  return { ...candidate, candidateKey, catalogRevision };
}

/** "a@7 b@8": each row's key and revision, in order, so a list reads as one string in a failure message. */
function keysAndRevisions(rows: readonly WorkMatchCandidate[]): string {
  return rows.map((row) => `${row.candidateKey}@${row.catalogRevision}`).join(' ');
}

async function main(): Promise<void> {
  installLocalStorage();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const listResponse: WorkMatchCandidatesResponse = {
    data: [candidate],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    stats: {
      candidateCount: 1,
      pendingCount: 1,
      notDuplicateCount: 0,
      needsResearchCount: 0,
      affectedWorks: 2,
    },
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const body = url.endsWith('/merge')
        ? {
            ok: true,
            canonicalWorkId: 'work-canonical',
            mergedWorks: 1,
            relinkedSongs: 1,
            preservedSongs: 3,
            preservedPerformances: 10,
          }
        : url.endsWith('/review')
          ? { ok: true }
          : listResponse;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const { api } = await import('../src/api/client');
  const { getNavGroups } = await import('../src/lib/navigation');
  const {
    default: GlobalWorkReview,
    MergeImpact,
  } = await import('../src/pages/GlobalWorkReview');
  const { default: WorkMatchCandidateCard } = await import(
    '../src/components/WorkMatchCandidateCard'
  );
  const {
    candidateReviewStateKey,
    mergeRefreshedCandidates,
    decisionsAfterRefresh,
    selectMergeSourceWorkIds,
  } = await import('../src/lib/global-work-review');
  const {
    initialWorkReviewState,
    isWorkReviewQueueBusy,
    workReviewReducer,
  } = await import('../src/pages/work-review-state');

  await api.listWorkMatches({ filter: 'pending', page: 2, pageSize: 20 });
  await api.reviewWorkMatch({
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    workIds: candidate.works.map((work) => work.id),
    decision: 'needs_research',
    expectedReviewVersion: candidate.reviewVersion,
    note: 'Verify official source',
  });
  await api.mergeWorkMatch({
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    catalogRevision: candidate.catalogRevision,
    expectedReviewVersion: candidate.reviewVersion,
    canonicalWorkId: 'work-canonical',
    sourceWorkIds: ['work-source'],
    note: 'Verified official release credits',
  });

  assert(requests[0]?.url === '/api/work-matches?filter=pending&page=2&pageSize=20', 'scan API is site-wide and paginated');
  assert(!requests.some((request) => request.url.includes('streamer=')), 'work review never inherits the selected streamer');
  assert(requests[1]?.init?.method === 'POST', 'review decision uses an authenticated mutation request');
  const reviewBody = JSON.parse(String(requests[1]?.init?.body)) as Record<string, unknown>;
  assert(reviewBody.expectedReviewVersion === null, 'review payload binds the displayed decision version');
  assert(requests[2]?.init?.method === 'POST', 'global merge uses an authenticated mutation request');
  const mergeBody = JSON.parse(String(requests[2]?.init?.body)) as Record<string, unknown>;
  assert(mergeBody.catalogRevision === 7, 'merge payload binds the displayed catalog revision');
  assert(mergeBody.expectedReviewVersion === null, 'merge payload binds the displayed review version');
  assert(mergeBody.note === 'Verified official release credits', 'merge payload preserves the curator note');
  assert(mergeBody.canonicalWorkId === 'work-canonical', 'merge payload binds the reviewed canonical ID');
  assert(
    Array.isArray(mergeBody.sourceWorkIds) && mergeBody.sourceWorkIds[0] === 'work-source',
    'merge payload binds the reviewed source IDs',
  );

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getNavGroups(curator).flatMap((group) => group.items).some((item) => item.to === '/works/review'),
    'curators see the site-wide work review queue',
  );
  assert(
    !getNavGroups(contributor).flatMap((group) => group.items).some((item) => item.to === '/works/review'),
    'contributors cannot navigate to global work review',
  );

  const pageHtml = renderToStaticMarkup(<GlobalWorkReview />);
  assert(pageHtml.includes('Global Work Review'), 'review page renders its global heading');
  assert(pageHtml.includes('never merges automatically'), 'review page states its manual-only safety boundary');
  const impactHtml = renderToStaticMarkup(
    <MergeImpact
      candidate={candidate}
      canonicalWorkId="work-canonical"
      sourceWorkIds={['work-source']}
    />,
  );
  assert(impactHtml.includes('Site-wide identity change'), 'confirmation states the global scope');
  assert(impactHtml.includes('performance IDs are preserved'), 'confirmation guarantees stable playback identities');
  assert(impactHtml.includes('No song or performance row is deleted'), 'confirmation states the non-destructive boundary');
  assert(impactHtml.includes('Canonical tags after merge: pop, english'), 'confirmation discloses the resulting tag union');
  assert(impactHtml.includes('Adds: english'), 'confirmation identifies tags added to the canonical work');

  const candidateHtml = renderToStaticMarkup(
    <WorkMatchCandidateCard
      candidate={candidate}
      selectedCanonicalWorkId="work-canonical"
      note="Verify official source"
      queueBusy={false}
      acting={false}
      isConfirming={false}
      onCanonicalChange={() => undefined}
      onNoteChange={() => undefined}
      onReviewMergeImpact={() => undefined}
      onCancelMerge={() => undefined}
      onConfirmMerge={() => undefined}
      onSaveDecision={() => undefined}
    />,
  );
  assert(candidateHtml.includes('I Love You 3000'), 'candidate card renders the canonical work');
  assert(candidateHtml.includes('I love you 3000'), 'candidate card renders the possible duplicate');
  assert(candidateHtml.includes('Verify official source'), 'candidate card preserves the draft review note');
  assert(candidateHtml.includes('Review merge impact'), 'candidate card exposes the merge review action');
  assert(candidateHtml.includes('Local follow-up required'), 'candidate card discloses local duplicate follow-up');

  const changedFingerprint = { ...candidate, fingerprint: 'c'.repeat(64) };
  assert(
    candidateReviewStateKey(candidate) !== candidateReviewStateKey(changedFingerprint),
    'review notes are isolated by candidate fingerprint',
  );
  const oversizedCandidate: WorkMatchCandidate = {
    ...candidate,
    works: Array.from({ length: 53 }, (_, index) => ({
      ...candidate.works[0]!,
      id: `work-${index}`,
    })),
  };
  const partialSources = selectMergeSourceWorkIds(oversizedCandidate, 'work-0');
  assert(partialSources.length === 50, 'over-limit candidates are split into server-safe batches');
  assert(!partialSources.includes('work-0'), 'partial merge sources exclude the canonical work');

  let reviewState = workReviewReducer(
    {
      ...initialWorkReviewState,
      candidates: [candidate],
      stats: listResponse.stats,
      total: 1,
      totalPages: 1,
      scanError: 'stale scan error',
    },
    { type: 'scanStarted' },
  );
  assert(reviewState.loading, 'starting a scan enables the loading state');
  assert(reviewState.candidates.length === 0, 'starting a scan clears stale candidates');
  assert(reviewState.total === 0 && reviewState.totalPages === 0, 'starting a scan resets pagination totals');
  assert(reviewState.scanError === null, 'starting a scan clears the previous scan error');

  reviewState = workReviewReducer(reviewState, {
    type: 'scanSucceeded',
    response: listResponse,
  });
  assert(reviewState.candidates[0]?.candidateKey === candidate.candidateKey, 'a scan stores its candidates');
  assert(reviewState.stats.candidateCount === 1, 'a scan stores aggregate queue statistics');
  assert(reviewState.total === 1 && reviewState.totalPages === 1, 'a scan stores pagination totals');

  reviewState = {
    ...reviewState,
    page: 1,
    totalPages: 3,
    actionError: 'stale action error',
    message: 'stale success message',
    confirmingCandidateKey: candidate.candidateKey,
  };
  reviewState = workReviewReducer(reviewState, { type: 'nextPageRequested' });
  reviewState = workReviewReducer(reviewState, { type: 'nextPageRequested' });
  assert(reviewState.page === 3, 'consecutive page actions use the latest reducer state');
  assert(reviewState.actionError === null && reviewState.message === null, 'changing pages clears action feedback');
  assert(reviewState.confirmingCandidateKey === null, 'changing pages closes merge confirmation');

  reviewState = workReviewReducer(
    {
      ...reviewState,
      page: 3,
      actionError: 'stale action error',
      message: 'stale success message',
      confirmingCandidateKey: candidate.candidateKey,
    },
    { type: 'filterChanged', filter: 'needs_research' },
  );
  assert(reviewState.filter === 'needs_research', 'changing the filter stores the selected queue');
  assert(reviewState.page === 1, 'changing the filter returns to the first page');
  assert(reviewState.actionError === null && reviewState.message === null, 'changing the filter clears action feedback');
  assert(reviewState.confirmingCandidateKey === null, 'changing the filter closes merge confirmation');

  reviewState = workReviewReducer(reviewState, {
    type: 'actionStarted',
    candidateKey: candidate.candidateKey,
  });
  assert(reviewState.actionCandidateKey === candidate.candidateKey, 'an action marks its candidate as busy');
  reviewState = workReviewReducer(reviewState, {
    type: 'actionSucceeded',
    message: 'Saved for source research.',
  });
  reviewState = workReviewReducer(reviewState, { type: 'refreshRequested' });
  reviewState = workReviewReducer(reviewState, { type: 'actionFinished' });
  assert(reviewState.message === 'Saved for source research.', 'a successful action preserves its feedback through refresh');
  assert(reviewState.refreshVersion === 1, 'a completed action requests a fresh scan');
  assert(reviewState.actionCandidateKey === null, 'finishing an action releases the queue lock');

  console.log('✓ work review UI and state transitions preserve curator safeguards');

  // --- mergeRefreshedCandidates: the rows on screen absorb a silent re-read of the same page ---

  const MERGE_CASES: ReadonlyArray<{
    name: string;
    current: WorkMatchCandidate[];
    decided: string[];
    fresh: WorkMatchCandidate[];
    expected: string;
  }> = [
    {
      name: 'a row the re-read has is replaced by the fresh row',
      current: [rowAt('a'), rowAt('b')],
      decided: [],
      fresh: [rowAt('a', 8), rowAt('b', 8)],
      expected: 'a@8 b@8',
    },
    {
      name: 'the order on screen wins over the re-read order',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: [],
      fresh: [rowAt('c', 8), rowAt('a', 8), rowAt('b', 8)],
      expected: 'a@8 b@8 c@8',
    },
    {
      name: 'a decided row the re-read lacks stays as it was',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: ['b'],
      fresh: [rowAt('a', 8), rowAt('c', 8)],
      expected: 'a@8 b@7 c@8',
    },
    {
      name: 'a decided row the re-read still has takes the fresh version',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('a', 8), rowAt('b', 8)],
      expected: 'a@8 b@8',
    },
    {
      name: 'an undecided row the re-read lacks drops out',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: [],
      fresh: [rowAt('a', 8), rowAt('c', 8)],
      expected: 'a@8 c@8',
    },
    {
      name: 'rows only the re-read has append in its order',
      current: [rowAt('a')],
      decided: [],
      fresh: [rowAt('x', 8), rowAt('a', 8), rowAt('y', 8)],
      expected: 'a@8 x@8 y@8',
    },
    {
      name: 'replace, keep, drop and append together',
      current: [rowAt('a'), rowAt('b'), rowAt('c'), rowAt('d')],
      decided: ['b'],
      fresh: [rowAt('n', 8), rowAt('d', 8), rowAt('a', 8), rowAt('m', 8)],
      expected: 'a@8 b@7 d@8 n@8 m@8',
    },
    {
      name: 'an empty re-read leaves only the decided rows',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: ['a', 'c'],
      fresh: [],
      expected: 'a@7 c@7',
    },
    {
      name: 'an empty screen takes the whole re-read',
      current: [],
      decided: [],
      fresh: [rowAt('x', 8), rowAt('y', 8)],
      expected: 'x@8 y@8',
    },
    {
      name: 'a decided key on neither side adds no row',
      current: [rowAt('a')],
      decided: ['gone'],
      fresh: [rowAt('a', 8)],
      expected: 'a@8',
    },
  ];

  for (const { name, current, decided, fresh, expected } of MERGE_CASES) {
    // Frozen inputs: a merge that pushes into or sorts either list throws.
    const merged = mergeRefreshedCandidates(
      Object.freeze([...current]),
      Object.freeze([...fresh]),
      Object.fromEntries(decided.map((key) => [key, 'merged' as const])),
    );
    const actual = keysAndRevisions(merged);
    assert(actual === expected, `mergeRefreshedCandidates, ${name}: expected "${expected}", got "${actual}"`);
  }
  const staleDecided = rowAt('b');
  const keptDecided = mergeRefreshedCandidates([rowAt('a'), staleDecided], [rowAt('a', 8)], { b: 'merged' });
  assert(keptDecided[1] === staleDecided, 'a decided row the re-read lacks is the very row that was on screen');

  console.log('✓ mergeRefreshedCandidates: a fresh row replaces, a decided row stays, a vanished row drops, a new row appends');

  // --- decisionsAfterRefresh: a decision holds for the fingerprint it was made under ---

  /** The row under another fingerprint: a title or an artist of its works edited elsewhere. */
  const refingerprinted = (row: WorkMatchCandidate): WorkMatchCandidate => ({ ...row, fingerprint: 'c'.repeat(64) });
  const LAPSE_CASES: ReadonlyArray<{
    name: string;
    current: WorkMatchCandidate[];
    decided: string[];
    fresh: WorkMatchCandidate[];
    expected: string;
  }> = [
    {
      name: 'a decided row the re-read returns under another fingerprint loses its decision',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [refingerprinted(rowAt('a', 8)), rowAt('b', 8)],
      expected: '',
    },
    {
      name: 'a decided row the re-read returns under the same fingerprint keeps it',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('a', 8), rowAt('b', 8)],
      expected: 'a',
    },
    {
      name: 'a decided row the re-read lacks keeps it',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('b', 8)],
      expected: 'a',
    },
    {
      name: 'of several decisions only the one whose fingerprint changed lapses',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: ['a', 'b', 'c'],
      fresh: [rowAt('a', 8), refingerprinted(rowAt('b', 8))],
      expected: 'a c',
    },
    {
      name: 'an undecided row under another fingerprint takes no decision with it',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('a', 8), refingerprinted(rowAt('b', 8))],
      expected: 'a',
    },
  ];
  for (const { name, current, decided, fresh, expected } of LAPSE_CASES) {
    // Frozen inputs: a helper that edits the rows or the decisions in place throws.
    const kept = decisionsAfterRefresh(
      Object.freeze([...current]),
      Object.freeze([...fresh]),
      Object.freeze(Object.fromEntries(decided.map((key) => [key, 'merged' as const]))),
    );
    const actual = Object.keys(kept).sort().join(' ');
    assert(actual === expected, `decisionsAfterRefresh, ${name}: expected "${expected}", got "${actual}"`);
  }
  const holding = { a: 'not_duplicate', b: 'needs_research' } as const;
  assert(
    decisionsAfterRefresh([rowAt('a'), rowAt('b')], [rowAt('a', 8)], holding) === holding,
    'with no decision lapsed, the very same record comes back',
  );
  assert(
    JSON.stringify(decisionsAfterRefresh([rowAt('a'), rowAt('b')], [refingerprinted(rowAt('a', 8)), rowAt('b', 8)], holding))
      === JSON.stringify({ b: 'needs_research' }),
    'a decision that holds keeps the outcome it recorded',
  );

  console.log(
    '✓ decisionsAfterRefresh: a decision holds while its candidate keeps the fingerprint it was made under; a re-read under another fingerprint drops it, a missing row keeps it',
  );

  // --- The queue's state: selection, decided rows and the silent re-read ---

  const queueState = (overrides: Partial<WorkReviewState> = {}): WorkReviewState => ({
    ...initialWorkReviewState,
    loading: false,
    candidates: [rowAt('a'), rowAt('b'), rowAt('c'), rowAt('d')],
    selectedKey: 'a',
    ...overrides,
  });
  const decidedKeys = (state: WorkReviewState): string => Object.keys(state.decided).sort().join(' ');

  {
    const started = workReviewReducer(
      queueState({ selectedKey: 'c', decided: { a: 'merged' }, rereading: true }),
      { type: 'scanStarted' },
    );
    assert(started.candidates.length === 0 && started.selectedKey === null, 'starting a scan clears the selection with the list');
    assert(!started.rereading, 'starting a scan abandons a re-read of the list it just cleared');

    const scanned = workReviewReducer(
      { ...started, decided: { a: 'merged' }, rereadError: "Couldn't refresh this page." },
      { type: 'scanSucceeded', response: { ...listResponse, data: [rowAt('x'), rowAt('y')], total: 2 } },
    );
    assert(keysAndRevisions(scanned.candidates) === 'x@7 y@7', 'a scan stores its rows');
    assert(scanned.selectedKey === 'x', 'a scan selects its first candidate');
    assert(decidedKeys(scanned) === '', 'a scan forgets the decisions of the list it replaces');
    assert(scanned.rereadError === null, 'a scan clears a failed re-read');

    const emptied = workReviewReducer(scanned, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [], total: 0, totalPages: 0 },
    });
    assert(emptied.selectedKey === null, 'a scan without candidates selects nothing');

    const picked = workReviewReducer(
      queueState({ decided: { a: 'merged' }, rereading: true }),
      { type: 'candidateSelected', key: 'c' },
    );
    assert(picked.selectedKey === 'c', 'selecting a row stores its key');
    assert(
      keysAndRevisions(picked.candidates) === 'a@7 b@7 c@7 d@7' && decidedKeys(picked) === 'a' && picked.rereading,
      'selecting a row changes nothing else',
    );
  }
  console.log('✓ work review state: a scan selects its first candidate and forgets the previous decisions; a click selects a row');

  {
    const recorded = workReviewReducer(queueState(), {
      type: 'decisionRecorded',
      candidateKey: 'a',
      outcome: 'not_duplicate',
    });
    assert(recorded.decided['a'] === 'not_duplicate', 'a decision is recorded against its candidate');
    assert(recorded.selectedKey === 'b', 'a decision moves the selection to the next undecided row');
    assert(recorded.rereading, 'a decision starts the silent re-read');
    assert(keysAndRevisions(recorded.candidates) === 'a@7 b@7 c@7 d@7', 'the decided row stays in the list');

    for (const outcome of ['not_duplicate', 'needs_research', 'merged'] as const) {
      const state = workReviewReducer(queueState(), { type: 'decisionRecorded', candidateKey: 'a', outcome });
      assert(state.decided['a'] === outcome, `the ${outcome} outcome is recorded as given`);
    }

    // A decision ends any pending merge confirmation: the full reload that used to clear it is gone.
    for (const confirming of ['a', 'c']) {
      const confirmed = workReviewReducer(queueState({ confirmingCandidateKey: confirming }), {
        type: 'decisionRecorded',
        candidateKey: 'a',
        outcome: 'merged',
      });
      assert(
        confirmed.confirmingCandidateKey === null,
        `a decision ends the merge confirmation open on ${confirming === 'a' ? 'the decided row' : 'another row'}`,
      );
    }

    const DECISION_CASES: ReadonlyArray<{
      name: string;
      state: WorkReviewState;
      candidateKey: string;
      expected: string | null;
    }> = [
      { name: 'the next row', state: queueState(), candidateKey: 'a', expected: 'b' },
      {
        name: 'decided rows after it are skipped',
        state: queueState({ decided: { b: 'merged', c: 'needs_research' } }),
        candidateKey: 'a',
        expected: 'd',
      },
      {
        name: 'the last row wraps to the first undecided one',
        state: queueState({ selectedKey: 'd', decided: { a: 'merged' } }),
        candidateKey: 'd',
        expected: 'b',
      },
      {
        name: 'nothing left undecided selects nothing',
        state: queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: 'b', decided: { a: 'merged' } }),
        candidateKey: 'b',
        expected: null,
      },
      {
        name: 'a curator who moved on to another undecided row while it saved keeps that row',
        state: queueState({ selectedKey: 'c' }),
        candidateKey: 'a',
        expected: 'c',
      },
      {
        name: 'a selection resting on another decided row moves on from the decided one',
        state: queueState({ selectedKey: 'b', decided: { b: 'needs_research' } }),
        candidateKey: 'a',
        expected: 'c',
      },
      {
        name: 'no selection starts from the decided row',
        state: queueState({ selectedKey: null }),
        candidateKey: 'b',
        expected: 'c',
      },
    ];
    for (const { name, state, candidateKey, expected } of DECISION_CASES) {
      const after = workReviewReducer(state, { type: 'decisionRecorded', candidateKey, outcome: 'merged' });
      assert(
        after.selectedKey === expected,
        `decisionRecorded, ${name}: expected ${String(expected)}, got ${String(after.selectedKey)}`,
      );
      assert(after.decided[candidateKey] === 'merged' && after.rereading, `decisionRecorded, ${name}: recorded, re-reading`);
    }
  }
  console.log('✓ work review state: a decision is recorded, the row stays, the selection moves to the next undecided row and a re-read starts');

  {
    const refreshedStats = {
      candidateCount: 5,
      pendingCount: 3,
      notDuplicateCount: 1,
      needsResearchCount: 0,
      affectedWorks: 8,
    };
    for (const loading of [false, true]) {
      const before = queueState({
        loading,
        rereading: true,
        selectedKey: 'b',
        decided: { a: 'merged' },
        filter: 'all',
        page: 2,
        scanError: 'scan error',
        actionError: 'action error',
        message: 'Saved.',
        refreshVersion: 3,
        confirmingCandidateKey: 'c',
        actionCandidateKey: 'a',
      });
      const refreshed = workReviewReducer(before, {
        type: 'pageRefreshed',
        candidates: [rowAt('b', 8), rowAt('c', 8), rowAt('d', 8), rowAt('e', 8)],
        stats: refreshedStats,
        total: 5,
        totalPages: 2,
      });
      assert(
        keysAndRevisions(refreshed.candidates) === 'a@7 b@8 c@8 d@8 e@8',
        `a re-read merges into the rows on screen, got ${keysAndRevisions(refreshed.candidates)}`,
      );
      assert(refreshed.stats === refreshedStats, 'a re-read updates the filter counts');
      assert(refreshed.total === 5 && refreshed.totalPages === 2, 'a re-read updates the pagination totals');
      assert(!refreshed.rereading, 'a re-read that lands ends the re-read');
      for (const field of [
        'loading',
        'filter',
        'page',
        'scanError',
        'actionError',
        'message',
        'refreshVersion',
        'confirmingCandidateKey',
        'actionCandidateKey',
        'decided',
        'selectedKey',
      ] as const) {
        assert(Object.is(before[field], refreshed[field]), `a silent re-read leaves ${field} alone (loading ${String(loading)})`);
      }
    }

    const RESELECT_CASES: ReadonlyArray<{
      name: string;
      state: WorkReviewState;
      fresh: WorkMatchCandidate[];
      expected: string | null;
    }> = [
      {
        name: 'a selected row that is still there stays selected',
        state: queueState({ selectedKey: 'b' }),
        fresh: [rowAt('a', 8), rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
        expected: 'b',
      },
      {
        name: 'a selected row that vanished gives way to the next row from its old position',
        state: queueState({ selectedKey: 'b' }),
        fresh: [rowAt('a', 8), rowAt('c', 8), rowAt('d', 8)],
        expected: 'c',
      },
      {
        name: 'rows after it that vanished too, or were decided, are skipped',
        state: queueState({ selectedKey: 'b', decided: { c: 'needs_research' } }),
        fresh: [rowAt('a', 8), rowAt('d', 8)],
        expected: 'd',
      },
      {
        name: 'the order on screen decides what follows, not the re-read order',
        state: queueState({ selectedKey: 'c' }),
        fresh: [rowAt('d', 8), rowAt('a', 8), rowAt('b', 8)],
        expected: 'd',
      },
      {
        name: 'with nothing live after it, the first live row before it',
        state: queueState({ selectedKey: 'c', decided: { a: 'merged' } }),
        fresh: [rowAt('b', 8)],
        expected: 'b',
      },
      {
        name: 'nothing live left selects nothing',
        state: queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: 'b', decided: { a: 'merged' } }),
        fresh: [],
        expected: null,
      },
      {
        name: 'no selection takes the first undecided row on screen',
        state: queueState({ selectedKey: null, decided: { a: 'merged' } }),
        fresh: [rowAt('a', 8), rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
        expected: 'b',
      },
      {
        // An over-limit merge's remainder comes back under a new key, appended.
        name: 'the selected row vanished and the only undecided row is one the re-read appended',
        state: queueState({ candidates: [rowAt('a')], selectedKey: 'a' }),
        fresh: [rowAt('x', 8)],
        expected: 'x',
      },
      {
        name: 'the appended row that is picked is the first undecided one of the merged list',
        state: queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: 'a', decided: { b: 'merged' } }),
        fresh: [rowAt('x', 8), rowAt('y', 8)],
        expected: 'x',
      },
      {
        name: 'every row decided (no selection) and the re-read appends an undecided row',
        state: queueState({
          candidates: [rowAt('a'), rowAt('b')],
          selectedKey: null,
          decided: { a: 'merged', b: 'not_duplicate' },
        }),
        fresh: [rowAt('x', 8)],
        expected: 'x',
      },
      {
        name: 'every merged row decided and nothing appended stays unselected',
        state: queueState({
          candidates: [rowAt('a'), rowAt('b')],
          selectedKey: null,
          decided: { a: 'merged', b: 'not_duplicate' },
        }),
        fresh: [],
        expected: null,
      },
      {
        name: 'every merged row decided, the re-read only returning them, stays unselected',
        state: queueState({
          candidates: [rowAt('a'), rowAt('b')],
          selectedKey: null,
          decided: { a: 'merged', b: 'not_duplicate' },
        }),
        fresh: [rowAt('a', 8), rowAt('b', 8)],
        expected: null,
      },
      {
        name: 'the walk from the old position comes first: a live row after it beats an appended one',
        state: queueState({ selectedKey: 'b' }),
        fresh: [rowAt('a', 8), rowAt('c', 8), rowAt('d', 8), rowAt('x', 8)],
        expected: 'c',
      },
      {
        name: 'the walk wraps before an appended row is considered',
        state: queueState({ selectedKey: 'd' }),
        fresh: [rowAt('a', 8), rowAt('b', 8), rowAt('x', 8)],
        expected: 'a',
      },
    ];
    for (const { name, state, fresh, expected } of RESELECT_CASES) {
      const after = workReviewReducer(state, {
        type: 'pageRefreshed',
        candidates: fresh,
        stats: refreshedStats,
        total: fresh.length,
        totalPages: 1,
      });
      assert(
        after.selectedKey === expected,
        `pageRefreshed, ${name}: expected ${String(expected)}, got ${String(after.selectedKey)}`,
      );
      assert(
        after.selectedKey === null || after.candidates.some((row) => row.candidateKey === after.selectedKey),
        `pageRefreshed, ${name}: the selection is a row of the merged list`,
      );
    }
  }
  console.log('✓ work review state: a re-read merges into the rows, keeps loading alone and re-selects only when nothing is selected or the selected row vanished');

  {
    // A decision holds for the fingerprint it was made under. A re-read that brings its candidate back
    // under another one (a title or an artist edited elsewhere) brings a new candidate, pending on the
    // server: the decision lapses and the fresh row is live again — selectable, actionable, counted.
    const refreshed = (state: WorkReviewState, fresh: WorkMatchCandidate[]) =>
      workReviewReducer(state, { type: 'pageRefreshed', candidates: fresh, stats: listResponse.stats, total: fresh.length, totalPages: 1 });
    const changedA = refingerprinted(rowAt('a', 8));

    const lapsed = refreshed(
      queueState({ selectedKey: 'd', decided: { a: 'not_duplicate', b: 'merged', c: 'needs_research' }, rereading: true }),
      [changedA, rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
    );
    assert(decidedKeys(lapsed) === 'b c', `the re-read under another fingerprint drops a's decision only (got "${decidedKeys(lapsed)}")`);
    assert(lapsed.candidates[0] === changedA, 'the fresh row takes its place, in place');
    assert(lapsed.selectedKey === 'd' && !lapsed.rereading, 'the selection stays and the re-read is over');
    const counted = workReviewReducer(lapsed, { type: 'decisionRecorded', candidateKey: 'd', outcome: 'merged' });
    assert(counted.selectedKey === 'a', `the queue counts the row again: deciding the last one wraps to it (got ${String(counted.selectedKey)})`);

    const reselected = refreshed(
      queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: null, decided: { a: 'merged', b: 'not_duplicate' } }),
      [changedA, rowAt('b', 8)],
    );
    assert(
      reselected.selectedKey === 'a' && decidedKeys(reselected) === 'b',
      `with every row decided and nothing selected, the row gone live again is selected (got ${String(reselected.selectedKey)})`,
    );

    const aDecided = queueState({ selectedKey: 'b', decided: { a: 'not_duplicate' } });
    const sameFingerprint = refreshed(aDecided, [rowAt('a', 8), rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)]);
    assert(
      sameFingerprint.decided === aDecided.decided,
      'a re-read under the same fingerprint keeps the decision, the very same record',
    );
    assert(keysAndRevisions(sameFingerprint.candidates) === 'a@8 b@8 c@8 d@8', 'and the decided row takes the fresh version');

    const lacking = refreshed(aDecided, [rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)]);
    assert(
      lacking.decided === aDecided.decided && keysAndRevisions(lacking.candidates) === 'a@7 b@8 c@8 d@8',
      'a decided row the re-read lacks keeps its decision and stays as it was',
    );
  }
  console.log(
    '✓ work review state: a re-read that brings a decided candidate back under another fingerprint drops the decision, and the fresh row is selectable and counted; the same fingerprint or a missing row keeps it',
  );

  {
    const before = queueState({ rereading: true, selectedKey: 'b', decided: { a: 'merged' } });
    const failed = workReviewReducer(before, { type: 'pageRefreshFailed', error: "Couldn't refresh this page." });
    assert(failed.candidates === before.candidates, 'a failed re-read keeps the list');
    assert(failed.decided === before.decided && failed.selectedKey === 'b', 'a failed re-read keeps the decisions and the selection');
    assert(!failed.rereading, 'a failed re-read ends the re-read');
    assert(failed.rereadError === "Couldn't refresh this page.", 'a failed re-read says why');
    assert(failed.loading === before.loading, 'a failed re-read leaves loading alone');

    // The block stays until a reload lands: a scan that has only started does not lift it.
    const reloading = workReviewReducer(failed, { type: 'scanStarted' });
    assert(reloading.rereadError === "Couldn't refresh this page.", 'a scan that has started keeps the failed re-read');
    const reloaded = workReviewReducer(reloading, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [rowAt('x')], total: 1 },
    });
    assert(reloaded.rereadError === null, 'a scan that succeeds clears it');
  }
  console.log('✓ work review state: a failed re-read keeps the list and blocks the queue until a reload succeeds');

  {
    // The busy rule the page gates every decision, merge, filter and page control on.
    const BUSY_CASES: ReadonlyArray<{ name: string; overrides: Partial<WorkReviewState>; busy: boolean }> = [
      { name: 'nothing running', overrides: {}, busy: false },
      { name: 'a decision or merge saving', overrides: { actionCandidateKey: 'a' }, busy: true },
      { name: 'a silent re-read running', overrides: { rereading: true }, busy: true },
      { name: 'the last re-read failed', overrides: { rereadError: "Couldn't refresh this page." }, busy: true },
      {
        name: 'all three at once',
        overrides: { actionCandidateKey: 'a', rereading: true, rereadError: "Couldn't refresh this page." },
        busy: true,
      },
    ];
    for (const { name, overrides, busy } of BUSY_CASES) {
      assert(
        isWorkReviewQueueBusy(queueState(overrides)) === busy,
        `isWorkReviewQueueBusy, ${name}: expected ${busy ? 'busy' : 'idle'}`,
      );
    }
    assert(!isWorkReviewQueueBusy(initialWorkReviewState), 'a fresh page is idle');

    // The rule follows the state machine. A saved decision stays busy through the re-read, so a
    // second merge never starts on a row the re-read has not refreshed.
    let flow = workReviewReducer(queueState(), { type: 'actionStarted', candidateKey: 'a' });
    assert(isWorkReviewQueueBusy(flow), 'a decision that is saving keeps the queue busy');
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'a', outcome: 'merged' });
    flow = workReviewReducer(flow, { type: 'actionFinished' });
    assert(isWorkReviewQueueBusy(flow), 'the save is over but the re-read has not landed: still busy');
    flow = workReviewReducer(flow, {
      type: 'pageRefreshed',
      candidates: [rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
      stats: listResponse.stats,
      total: 3,
      totalPages: 1,
    });
    assert(!isWorkReviewQueueBusy(flow), 'the re-read has landed: idle');
    flow = workReviewReducer(flow, { type: 'actionStarted', candidateKey: 'b' });
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'b', outcome: 'not_duplicate' });
    flow = workReviewReducer(flow, { type: 'actionFinished' });
    flow = workReviewReducer(flow, { type: 'pageRefreshFailed', error: "Couldn't refresh this page." });
    assert(isWorkReviewQueueBusy(flow), 'a failed re-read keeps the queue busy');
    flow = workReviewReducer(flow, { type: 'scanStarted' });
    assert(isWorkReviewQueueBusy(flow), 'a reload that has only started does not free it');
    flow = workReviewReducer(flow, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [rowAt('x')], total: 1 },
    });
    assert(!isWorkReviewQueueBusy(flow), 'a reload that succeeds frees it');
  }
  console.log('✓ work review state: the queue is busy while an action saves, a re-read runs or the last re-read failed');

  {
    const decidedState = queueState({ page: 2, totalPages: 3, decided: { a: 'merged', b: 'not_duplicate' } });
    for (const action of [
      { type: 'filterChanged', filter: 'all' },
      { type: 'previousPageRequested' },
      { type: 'nextPageRequested' },
    ] as const) {
      const moved = workReviewReducer(decidedState, action);
      assert(decidedKeys(moved) === '', `${action.type} clears the decided rows`);
    }
  }
  console.log('✓ work review state: a filter change or a page change clears the decided rows');

  {
    // The page's scan is keyed on the filter and the page, and the kit Segmented also reports a click
    // on the option that is already active. Only a click that changes one of the two rescans, so only
    // such a click may clear the decided rows: the active filter on page 1 changes neither, no scan
    // follows, and clearing would turn every decided row still on screen live again.
    const FILTER_CASES: ReadonlyArray<{
      name: string;
      filter: WorkReviewState['filter'];
      page: number;
      clears: boolean;
    }> = [
      { name: 'the active filter on page 1 changes nothing the scan is keyed on', filter: 'pending', page: 1, clears: false },
      { name: 'the active filter on page 2 goes back to page 1, which rescans', filter: 'pending', page: 2, clears: true },
      { name: 'another filter on page 1 rescans', filter: 'all', page: 1, clears: true },
      { name: 'another filter on page 2 rescans', filter: 'all', page: 2, clears: true },
    ];
    for (const { name, filter, page, clears } of FILTER_CASES) {
      const before = queueState({
        filter: 'pending',
        page,
        totalPages: 3,
        selectedKey: 'c',
        decided: { a: 'merged', b: 'not_duplicate' },
        actionError: 'action error',
        message: 'Saved.',
        confirmingCandidateKey: 'c',
      });
      const after = workReviewReducer(before, { type: 'filterChanged', filter });
      assert(
        decidedKeys(after) === (clears ? '' : 'a b'),
        `filterChanged, ${name}: the decided rows ${clears ? 'clear' : 'stay'}, got "${decidedKeys(after)}"`,
      );
      if (!clears) {
        assert(after.decided === before.decided, `filterChanged, ${name}: the decided map is the very one it was`);
      }
      assert(after.candidates === before.candidates, `filterChanged, ${name}: the rows stay until a scan replaces them`);
      assert(after.selectedKey === 'c', `filterChanged, ${name}: the selection stays until a scan replaces the rows`);
      assert(after.filter === filter && after.page === 1, `filterChanged, ${name}: the filter is stored and the page is the first`);
      assert(
        after.actionError === null && after.message === null && after.confirmingCandidateKey === null,
        `filterChanged, ${name}: the feedback and the merge confirmation are cleared as before`,
      );
    }
  }
  console.log('✓ work review state: the active filter on page 1 keeps the decided rows; any filter click that rescans clears them');

  {
    // The same holds for the page steps: a step that leaves the page where it is (Previous at page 1,
    // Next at the last page) rescans nothing, so it must not clear the decided rows. The reducer does
    // not lean on the buttons being disabled there.
    const PAGE_CASES: ReadonlyArray<{
      name: string;
      action: 'previousPageRequested' | 'nextPageRequested';
      page: number;
      totalPages: number;
      expectedPage: number;
      clears: boolean;
    }> = [
      {
        name: 'Previous at page 1 changes nothing the scan is keyed on',
        action: 'previousPageRequested',
        page: 1,
        totalPages: 3,
        expectedPage: 1,
        clears: false,
      },
      {
        name: 'Next at the last page changes nothing the scan is keyed on',
        action: 'nextPageRequested',
        page: 3,
        totalPages: 3,
        expectedPage: 3,
        clears: false,
      },
      {
        name: 'Previous on a single page changes nothing the scan is keyed on',
        action: 'previousPageRequested',
        page: 1,
        totalPages: 1,
        expectedPage: 1,
        clears: false,
      },
      {
        name: 'Next on a single page changes nothing the scan is keyed on',
        action: 'nextPageRequested',
        page: 1,
        totalPages: 1,
        expectedPage: 1,
        clears: false,
      },
      {
        name: 'Previous from page 2 goes to page 1, which rescans',
        action: 'previousPageRequested',
        page: 2,
        totalPages: 3,
        expectedPage: 1,
        clears: true,
      },
      {
        name: 'Next from page 1 of 3 goes to page 2, which rescans',
        action: 'nextPageRequested',
        page: 1,
        totalPages: 3,
        expectedPage: 2,
        clears: true,
      },
      {
        name: 'Next from the last page but one goes to the last page, which rescans',
        action: 'nextPageRequested',
        page: 2,
        totalPages: 3,
        expectedPage: 3,
        clears: true,
      },
    ];
    for (const { name, action, page, totalPages, expectedPage, clears } of PAGE_CASES) {
      const before = queueState({
        page,
        totalPages,
        selectedKey: 'c',
        decided: { a: 'merged', b: 'not_duplicate' },
        actionError: 'action error',
        message: 'Saved.',
        confirmingCandidateKey: 'c',
      });
      const after = workReviewReducer(before, { type: action });
      assert(
        decidedKeys(after) === (clears ? '' : 'a b'),
        `${action}, ${name}: the decided rows ${clears ? 'clear' : 'stay'}, got "${decidedKeys(after)}"`,
      );
      if (!clears) {
        assert(after.decided === before.decided, `${action}, ${name}: the decided map is the very one it was`);
      }
      assert(after.candidates === before.candidates, `${action}, ${name}: the rows stay until a scan replaces them`);
      assert(after.selectedKey === 'c', `${action}, ${name}: the selection stays until a scan replaces the rows`);
      assert(after.page === expectedPage, `${action}, ${name}: the page is ${expectedPage}, got ${after.page}`);
      assert(
        after.actionError === null && after.message === null && after.confirmingCandidateKey === null,
        `${action}, ${name}: the feedback and the merge confirmation are cleared as before`,
      );
    }
  }
  console.log('✓ work review state: Previous at the first page and Next at the last keep the decided rows; a page step that rescans clears them');

  {
    // Two merges in a row: the second row comes back from the re-read with the catalog revision the
    // first merge advanced, so the second merge is not stale.
    let flow = workReviewReducer(initialWorkReviewState, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [rowAt('a'), rowAt('b'), rowAt('c')], total: 3 },
    });
    assert(flow.selectedKey === 'a', 'the scan selects the first candidate');
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'a', outcome: 'merged' });
    assert(flow.selectedKey === 'b' && flow.rereading, 'the first merge selects the next row and starts a re-read');
    flow = workReviewReducer(flow, {
      type: 'pageRefreshed',
      candidates: [rowAt('b', 8), rowAt('c', 8)],
      stats: listResponse.stats,
      total: 2,
      totalPages: 1,
    });
    const second = flow.candidates.find((row) => row.candidateKey === flow.selectedKey);
    assert(!flow.rereading, 'the re-read has landed');
    assert(second?.catalogRevision === 8, 'the row selected after a merge carries the re-read catalog revision');
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'b', outcome: 'merged' });
    flow = workReviewReducer(flow, {
      type: 'pageRefreshed',
      candidates: [rowAt('c', 9)],
      stats: listResponse.stats,
      total: 1,
      totalPages: 1,
    });
    assert(
      keysAndRevisions(flow.candidates) === 'a@7 b@8 c@9',
      `both merged rows stay as they were decided and the last row is fresh, got ${keysAndRevisions(flow.candidates)}`,
    );
    assert(flow.selectedKey === 'c', 'the selection follows the queue to the last undecided row');
  }
  console.log('✓ work review state: a second merge selects a row that carries the revision the re-read refreshed');
}

await main();

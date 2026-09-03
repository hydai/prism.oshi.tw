import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AuthUser,
  WorkMatchCandidate,
  WorkMatchCandidatesResponse,
} from '../../shared/types';

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
  const { getVisibleNavItems } = await import('../src/lib/navigation');
  const {
    default: GlobalWorkReview,
    MergeImpact,
  } = await import('../src/pages/GlobalWorkReview');
  const { default: WorkMatchCandidateCard } = await import(
    '../src/components/WorkMatchCandidateCard'
  );
  const {
    candidateReviewStateKey,
    selectMergeSourceWorkIds,
  } = await import('../src/lib/global-work-review');
  const {
    initialWorkReviewState,
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
    getVisibleNavItems(curator).some((item) => item.to === '/works/review'),
    'curators see the site-wide work review queue',
  );
  assert(
    !getVisibleNavItems(contributor).some((item) => item.to === '/works/review'),
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
}

await main();

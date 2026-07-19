import * as React from 'react';
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
      tags: [],
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
  const { getVisibleNavItems } = await import('../src/components/Layout');
  const { default: GlobalWorkReview, MergeImpact } = await import('../src/pages/GlobalWorkReview');

  await api.listWorkMatches({ filter: 'pending', page: 2, pageSize: 20 });
  await api.reviewWorkMatch({
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    workIds: candidate.works.map((work) => work.id),
    decision: 'needs_research',
    note: 'Verify official source',
  });
  await api.mergeWorkMatch({
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    canonicalWorkId: 'work-canonical',
    sourceWorkIds: ['work-source'],
  });

  assert(requests[0]?.url === '/api/work-matches?filter=pending&page=2&pageSize=20', 'scan API is site-wide and paginated');
  assert(!requests.some((request) => request.url.includes('streamer=')), 'work review never inherits the selected streamer');
  assert(requests[1]?.init?.method === 'POST', 'review decision uses an authenticated mutation request');
  assert(requests[2]?.init?.method === 'POST', 'global merge uses an authenticated mutation request');
  const mergeBody = JSON.parse(String(requests[2]?.init?.body)) as Record<string, unknown>;
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
  const impactHtml = renderToStaticMarkup(<MergeImpact candidate={candidate} />);
  assert(impactHtml.includes('Site-wide identity change'), 'confirmation states the global scope');
  assert(impactHtml.includes('performance IDs are preserved'), 'confirmation guarantees stable playback identities');
  assert(impactHtml.includes('No song or performance row is deleted'), 'confirmation states the non-destructive boundary');

  console.log('✓ work review UI is curator-only, site-wide, and explicit about preserved performances');
}

await main();

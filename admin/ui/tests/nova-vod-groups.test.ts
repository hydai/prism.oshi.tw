import type { NovaVodSubmission } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function makeVod(overrides: Partial<NovaVodSubmission>): NovaVodSubmission {
  return {
    id: 'vod',
    streamer_slug: 'a',
    video_id: 'abc',
    video_url: 'https://www.youtube.com/watch?v=abc',
    stream_title: 'Title',
    stream_date: '2026-01-01',
    thumbnail_url: '',
    submitter_note: '',
    status: 'approved',
    submitted_at: '2026-01-01T00:00:00Z',
    reviewed_at: null,
    reviewer_note: '',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const { groupVodsByStreamer } = await import('../src/lib/nova-vod-groups');

  assert(groupVodsByStreamer([]).length === 0, 'no submissions yields no groups');

  const groups = groupVodsByStreamer([
    makeVod({ id: 'a1', streamer_slug: 'a', submitted_at: '2026-01-01T00:00:00Z', status: 'approved' }),
    makeVod({ id: 'b1', streamer_slug: 'b', submitted_at: '2026-03-01T00:00:00Z', status: 'pending' }),
    makeVod({ id: 'a2', streamer_slug: 'a', submitted_at: '2026-02-01T00:00:00Z', status: 'pending' }),
  ]);

  assert(groups.length === 2, 'one group per streamer');
  assert(groups[0].slug === 'b' && groups[1].slug === 'a', 'groups are ordered by their newest submission first');
  assert(
    groups[1].vods.map((v) => v.id).join(',') === 'a1,a2',
    'submissions keep their incoming order inside a group',
  );
  assert(groups[0].pendingCount === 1 && groups[1].pendingCount === 1, 'pending counts only count pending submissions');

  console.log('✓ Nova VOD submissions group by streamer with newest groups first');
}

await main();

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NovaVodSubmission } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function makeVod(overrides: Partial<NovaVodSubmission> = {}): NovaVodSubmission {
  return {
    id: 'vod-test',
    streamer_slug: 'mizuki',
    video_id: 'pRy1JZ2jSi8',
    video_url: 'https://www.youtube.com/watch?v=pRy1JZ2jSi8',
    stream_title: '【歌枠】炎熱夏天的晚上唱給你聽',
    stream_date: '2026-08-22',
    thumbnail_url: 'https://i.ytimg.com/vi/pRy1JZ2jSi8/hqdefault.jpg',
    submitter_note: '',
    status: 'pending',
    submitted_at: '2026-08-22 23:10',
    reviewed_at: null,
    reviewer_note: '',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const { VodRow } = await import('../src/pages/NovaVodSubmissions');
  const render = (vod: NovaVodSubmission, opts: { expanded?: boolean; showStreamer?: boolean } = {}) =>
    renderToStaticMarkup(
      <table>
        <VodRow
          vod={vod}
          isCurator
          expanded={opts.expanded ?? false}
          showStreamer={opts.showStreamer ?? false}
          songs={[]}
          onToggle={() => undefined}
          rejectNote=""
          onRejectNoteChange={() => undefined}
          onAction={() => undefined}
          onDelete={() => undefined}
          actionLoading={false}
        />
      </table>,
    );

  const hostile = render(makeVod({ thumbnail_url: 'https://attacker.example/track-curator.png' }), { expanded: true });
  assert(!hostile.includes('attacker.example'), 'submitter-supplied thumbnail off the YouTube allowlist never becomes an img src');

  const safe = render(makeVod(), { expanded: true });
  assert(
    (safe.match(/src="https:\/\/i\.ytimg\.com\/vi\/pRy1JZ2jSi8\/hqdefault\.jpg"/g) ?? []).length === 2,
    'YouTube thumbnails render in the row and the expanded panel',
  );

  const grouped = render(makeVod());
  assert(!grouped.includes('>mizuki<'), 'grouped rows leave streamer attribution to the card heading');
  const timeline = render(makeVod(), { showStreamer: true });
  assert(timeline.includes('>mizuki<'), 'timeline rows carry the streamer slug');

  assert(timeline.includes('<tr class='), 'summary row is a native table row');
  assert((timeline.match(/<td /g) ?? []).length === 7, 'each grid column is a native table cell');
  assert(safe.includes('<table><tbody'), 'a submission with its detail panel is one native row group');
  assert(/<td colSpan="7"[^>]*id="nova-vod-details-vod-test"/.test(safe), 'the detail panel spans the row as one cell');

  console.log('✓ Nova VOD rows sanitise thumbnails, attribute streamers and expose table semantics');
}

await main();

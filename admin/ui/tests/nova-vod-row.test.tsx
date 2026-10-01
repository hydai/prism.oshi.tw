import { renderToStaticMarkup } from 'react-dom/server';
import type { NovaStatus, NovaVodSong, NovaVodSubmission } from '../../shared/types';
import { createRowDrafts } from '../src/hooks/useRowDrafts';
import { NO_ARBITRARY_HEX, NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoRawColour(html: string, what: string): void {
  assert(!NO_RAW_PALETTE.test(html), `${what} uses no raw palette classes`);
  assert(!NO_ARBITRARY_HEX.test(html), `${what} uses no arbitrary hex colours`);
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
    submitted_at: '2026-08-22 23:10:00',
    reviewed_at: null,
    reviewer_note: '',
    ...overrides,
  };
}

const SONGS: NovaVodSong[] = [
  {
    id: 'song-1',
    vod_submission_id: 'vod-test',
    song_title: 'Secret Base',
    original_artist: 'ZONE',
    start_timestamp: 65,
    end_timestamp: 310,
    sort_order: 0,
  },
  {
    id: 'song-2',
    vod_submission_id: 'vod-test',
    song_title: 'Lemon',
    original_artist: '',
    start_timestamp: 3725,
    end_timestamp: null,
    sort_order: 1,
  },
];

/** When the page "opened": the stored times only need it to leave out the current year. */
const TODAY = new Date('2026-09-15T00:00:00.000Z');

interface RenderOptions {
  expanded?: boolean;
  showStreamer?: boolean;
  isCurator?: boolean;
  songs?: NovaVodSong[];
  acting?: NovaStatus | 'delete';
}

async function main(): Promise<void> {
  const { VodRow } = await import('../src/pages/NovaVodSubmissions');
  const render = (vod: NovaVodSubmission, opts: RenderOptions = {}) =>
    renderToStaticMarkup(
      <table>
        <VodRow
          vod={vod}
          isCurator={opts.isCurator ?? true}
          expanded={opts.expanded ?? false}
          showStreamer={opts.showStreamer ?? false}
          songs={opts.songs ?? []}
          acting={opts.acting}
          today={TODAY}
          onToggle={() => undefined}
          onRetrySongs={() => undefined}
          drafts={createRowDrafts()}
          onAction={async () => true}
          onDelete={() => undefined}
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

  // Colours come from the tokens alone, in every state a row can be in: collapsed, open with its songs, a
  // reviewed one (which offers Revert), one with no date and no thumbnail, and a contributor's.
  const withSongs = render(makeVod({ submitter_note: 'Please check\nthe times', reviewer_note: 'Looks right' }), {
    expanded: true,
    songs: SONGS,
  });
  const reviewed = render(
    makeVod({ status: 'approved', reviewed_at: '2026-08-23T10:00:00.000Z', stream_date: '', thumbnail_url: '' }),
    { expanded: true, songs: SONGS, showStreamer: true },
  );
  const asContributor = render(makeVod(), { expanded: true, songs: SONGS, isCurator: false });
  const midRequest = render(makeVod(), { expanded: true, acting: 'approved' });
  for (const [what, html] of [
    ['a collapsed row', timeline],
    ['an open row', safe],
    ['an open row with its songs', withSongs],
    ['a reviewed row without a date or thumbnail', reviewed],
    ["a contributor's open row", asContributor],
    ['a row with a request out', midRequest],
  ] as const) {
    assertNoRawColour(html, what);
    assert(!html.includes('hover-row') && !html.includes('prism-gradient'), `${what} keeps nothing of the prism kit's CSS`);
  }

  // The detail panel is one column below 1024 px and has two from there up (its fields, its songs). A curator's
  // review card spans both below them until 1280 px and is the third column from there. At every width the
  // panel is as wide as the scroller shows (the table can be wider) and pinned to its left edge.
  assert(
    /<td colSpan="7"[^>]*class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[240px_minmax\(0,1fr\)\][^"]*\bxl:grid-cols-\[240px_minmax\(0,1fr\)_320px\]"/.test(safe),
    "a curator's detail panel is one column, two from 1024 px (240px / 1fr) and three from 1280 px (240px / 1fr / 320px)",
  );
  assert(
    /<td colSpan="7"[^>]*class="(?:[^"]* )?sticky left-0 w-\[100cqw\] /.test(safe),
    'the detail is as wide as the scroller shows and pinned to its left edge, at every width',
  );
  assert(safe.includes('lg:col-span-2 xl:col-span-1'), 'the review card spans both columns from 1024 px and is the third from 1280 px');
  assert(
    /<td colSpan="7"[^>]*class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[240px_minmax\(0,1fr\)\]"/.test(asContributor) &&
      !asContributor.includes('320px') &&
      !asContributor.includes('xl:grid-cols') &&
      !asContributor.includes('col-span'),
    "a contributor's detail panel has two columns from 1024 px, and no third column or review card",
  );

  // Times: the submitted time is a <time> (short form, the exact instant for machines); the stream's own date is as typed.
  assert(timeline.includes('<time dateTime="2026-08-22T23:10:00.000Z"'), 'the submitted time carries the exact instant');
  assert(timeline.includes('>2026-08-22<'), "the stream's own YYYY-MM-DD date stays as it is");
  assert(reviewed.includes('<time dateTime="2026-08-23T10:00:00.000Z"'), 'a reviewed time is a <time> too');
  assert(
    reviewed.includes('>No date<') && reviewed.includes('>No date provided<'),
    'a VOD with no date says so in the row and in the panel',
  );

  // Songs show in the row's own cell only while it is open, whatever it is handed; a VOD with no title is named by
  // its video id (and shows a dash).
  assert(!render(makeVod(), { songs: SONGS }).includes('2 songs'), 'a collapsed row shows no songs pill');
  const untitled = render(makeVod({ stream_title: '' }));
  assert(
    untitled.includes('aria-label="展開 pRy1JZ2jSi8"') && untitled.includes('>—</button>'),
    'a VOD with no title is named by its video id for assistive technology, and shows a dash',
  );

  // The songs: a numbered list with its start and end, a dash where there is no end; none says so.
  assert(
    withSongs.includes('Songs · 2') && withSongs.includes('Secret Base') && withSongs.includes('1:05') && withSongs.includes('5:10'),
    'the song list shows each title with its start and end',
  );
  assert(withSongs.includes('1:02:05'), 'a start past the first hour reads h:mm:ss');
  assert(safe.includes('No song timestamps submitted.'), 'an open VOD with no songs says so');

  // A request out: the button that sent it is busy (aria-busy, no `disabled`), the others unavailable.
  assert(
    /<button[^>]*aria-busy="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Approve<\/button>/.test(midRequest) &&
      !/<button[^>]*disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Approve<\/button>/.test(midRequest),
    'Approve is busy while its request is out, and is not disabled',
  );
  assert(
    /<button[^>]*aria-disabled="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Reject<\/button>/.test(midRequest),
    'Reject is unavailable beside it',
  );
  // (As attributes: every kit Button's class list names the aria-disabled: variant.)
  const idle = render(makeVod(), { expanded: true });
  assert(
    !/ aria-busy="/.test(idle) && !/ aria-disabled="/.test(idle),
    'a row with no request out has no busy or unavailable control',
  );
  const collapsedBusy = render(makeVod(), { acting: 'delete' });
  assert(
    (collapsedBusy.match(/aria-disabled="true"/g) ?? []).length === 3 && (collapsedBusy.match(/aria-busy="true"/g) ?? []).length === 1,
    'a collapsed row with a delete out: its three quick actions are unavailable, the Delete one busy',
  );

  console.log('✓ Nova VOD rows sanitise thumbnails, attribute streamers, expose table semantics and use no raw colour');
}

await main();

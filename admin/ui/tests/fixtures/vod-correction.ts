/**
 * The ichii correction of VOD VqAa6fUDZXI as `GET /api/nova/vods/:id/correction` returns it: seven rows on the
 * stream and six proposed, paired by the matcher. Six pairs, one current row left over (A Tender Moon Tempo, a
 * delete candidate), and a typo in the first title (Late Niqht Drive). Every pair's times moved by a few seconds.
 * Nova recorded no base for it (a submission stored before it kept one), so it is reviewed against the stream alone.
 * No revision confirmed a base for any view built here (`baseVerified` is false) but a `loaded` one, such as
 * `ichiiLoadedView`; a test that needs one sets it, or loads its view.
 *
 * A factory, so a test may edit what it gets without touching the next test's view (all but `countedReadsView`'s,
 * which is read-only: see there).
 *
 * `startOnlyCorrectionView` is a correction pasted as start times only, to fix one title (Snog C → Song C): Nova's
 * parser filled every end with the next row's start and left the last one empty, so none of the submitted ends is the
 * contributor's. The stream's own ends are curated, each before the next start.
 *
 * `correctionView` builds a review of the same submission from given rows, with a base: what the route returns for a
 * correction Nova compared against the public list. `loaded` makes any view one a revision confirmed, as from a
 * contributor who loaded the list before editing it.
 *
 * `countedReadsView` builds one of any size that counts what is read of it, for the tests that a function reads a view
 * once per call, not once per row.
 */
import type { NovaVodSubmission, Status } from '../../../shared/types';
import { matchCorrection, matchCorrectionWithBase } from '../../../shared/vod-correction';
import type {
  CorrectionBaseRow,
  CorrectionCurrentRow,
  CorrectionProposedRow,
  NovaVodCorrectionView,
} from '../../../shared/vod-correction';

export interface RowFields {
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp: number | null;
}

export const row = (title: string, originalArtist: string, timestamp: number, endTimestamp: number | null): RowFields =>
  ({ title, originalArtist, timestamp, endTimestamp });

const ICHII_CURRENT = [
  row('Late Night Drive', 'Unknown', 882, 1026), row('私奔到月球', '五月天', 1394, 1621),
  row('A Tender Moon Tempo', 'ヴィヴィ(八木海莉)', 1901, 2187), row('Moon Halo', 'Unknown', 2248, 2448),
  row('月の向こうの世界', 'Unknown', 2714, 2933), row('Fly Me To The Moon', 'Frank Sinatra', 3514, 3663),
  row('Moon River', 'Unknown', 5377, 5545),
];
const ICHII_PROPOSED = [
  row('Late Niqht Drive', 'Unknown', 881, 1024), row('私奔到月球', '五月天', 1394, 1617),
  row('Moon Halo', 'Unknown', 2247, 2445), row('月の向こうの世界', 'Unknown', 2714, 2945),
  row('Fly Me To The Moon', 'Frank Sinatra', 3512, 3658), row('Moon River', 'Unknown', 5368, 5472),
];

const START_ONLY_CURRENT = [
  row('Song A', 'Artist A', 100, 340), row('Song B', 'Artist B', 400, 640), row('Snog C', 'Artist C', 700, 940),
  row('Song D', 'Artist D', 1000, 1240), row('Song E', 'Artist E', 1300, 1540),
];
const START_ONLY_PROPOSED = [
  row('Song A', 'Artist A', 100, 400), row('Song B', 'Artist B', 400, 700), row('Song C', 'Artist C', 700, 1000),
  row('Song D', 'Artist D', 1000, 1300), row('Song E', 'Artist E', 1300, null),
];

/** A row of the stream as it is now: on the site when it and its song are approved. */
export function liveRow(
  performanceId: string,
  fields: RowFields,
  status: Status = 'approved',
  songStatus: Status = 'approved',
): CorrectionCurrentRow {
  return {
    ...fields,
    performanceId,
    songId: `s${performanceId.replace(/^p/, '')}`,
    status,
    songStatus,
    onSite: status === 'approved' && songStatus === 'approved',
    songPerformanceCount: 1,
  };
}

const currentRow = (fields: RowFields, index: number): CorrectionCurrentRow => liveRow(`p${index + 1}`, fields);

/**
 * The rows of a submission, given in the order it was submitted (`v1`, `v2`, …), as the view holds them: each with
 * what the route works out in that order (whether its end is the next row's start, and which row is next), then
 * sorted by start.
 */
export function submittedRows(rows: readonly RowFields[]): CorrectionProposedRow[] {
  const inOrder = rows.map((fields, index): CorrectionProposedRow => {
    const next = rows[index + 1];
    return {
      ...fields,
      id: `v${index + 1}`,
      endFilled: fields.endTimestamp !== null && fields.endTimestamp === next?.timestamp,
      nextSubmittedId: next ? `v${index + 2}` : null,
      existingSong: null,
    };
  });
  return inOrder.sort((left, right) => left.timestamp - right.timestamp);
}

/** A row of the list the contributor compared against. */
export const baseRow = (performanceId: string, fields: RowFields): CorrectionBaseRow => ({ ...fields, performanceId });

export function startOnlyCorrectionView(): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.current = START_ONLY_CURRENT.map(currentRow);
  view.proposed = submittedRows(START_ONLY_PROPOSED);
  view.match = matchCorrection(view.current, view.proposed);
  return view;
}

export function ichiiCorrectionView(): NovaVodCorrectionView {
  const current = ICHII_CURRENT.map(currentRow);
  const proposed = submittedRows(ICHII_PROPOSED);
  const submission: NovaVodSubmission = {
    id: 'vod-1',
    streamer_slug: 'ichii',
    video_id: 'VqAa6fUDZXI',
    video_url: 'https://www.youtube.com/watch?v=VqAa6fUDZXI',
    stream_title: '【中秋歌回🎤】玉兔搗藥，也在月亮上唱唱歌',
    stream_date: '2026-09-25',
    thumbnail_url: 'https://i.ytimg.com/vi/VqAa6fUDZXI/hqdefault.jpg',
    submitter_note: '',
    status: 'pending',
    submitted_at: '2026-11-14T00:00:00Z',
    reviewed_at: null,
    reviewer_note: '',
    kind: 'correction',
  };
  return {
    submission,
    stream: {
      id: 'stream-1',
      title: submission.stream_title,
      date: submission.stream_date,
      videoId: submission.video_id,
      status: 'approved',
    },
    base: null,
    baseVerified: false,
    current,
    proposed,
    match: matchCorrection(current, proposed),
    fingerprint: 'f'.repeat(64),
    otherPendingCount: 0,
    openApply: null,
  };
}

/**
 * `view` as a contributor who loaded the list before editing it sends it: a revision confirmed its base
 * (`baseVerified`). One with no base is given the stream's rows as they are now, every one of them by its performance
 * id (so none reads as a row the contributor never saw), and paired against that base as the worker pairs. The review
 * page ticks nothing by default where no revision confirmed a base, so a page test of what a review opens with
 * starts from here. It edits `view` and returns it.
 */
export function loaded(view: NovaVodCorrectionView): NovaVodCorrectionView {
  if (view.base === null) {
    view.base = view.current.map(({ performanceId, title, originalArtist, timestamp, endTimestamp }) =>
      baseRow(performanceId, row(title, originalArtist, timestamp, endTimestamp)));
    view.match = matchCorrectionWithBase(view.current, view.proposed, view.base);
  }
  view.baseVerified = true;
  return view;
}

/**
 * The ichii correction, loaded (`loaded`): pairs, ticks and operations are the plain one's, and it opens with the six
 * time edits ticked, as the plain one did before the guard, which finds nothing in it to hold back.
 */
export function ichiiLoadedView(): NovaVodCorrectionView {
  return loaded(ichiiCorrectionView());
}

/**
 * The review of the ichii submission's stream with these rows: `current` as the stream has them now (give them in
 * time order), `proposed` in the order they were submitted, and the base Nova recorded. Paired as the worker pairs:
 * the rows the base names by id first, the rest by title, then time.
 */
export function correctionView({ base, current, proposed }: {
  base: CorrectionBaseRow[] | null;
  current: CorrectionCurrentRow[];
  proposed: readonly RowFields[];
}): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.base = base;
  view.current = current;
  view.proposed = submittedRows(proposed);
  view.match = matchCorrectionWithBase(view.current, view.proposed, view.base);
  return view;
}

/** How often `countedReadsView` saw its facts read. */
export interface ReadCounts {
  /** `view.base`. */
  base: number;
  /** The title of the first base row. */
  baseTitle: number;
  /** The title of the first live row. */
  liveTitle: number;
}

/** `target[key]` as it is, with a call of `tally` for every read of it. */
function counted<T extends object>(target: T, key: keyof T, tally: () => void): void {
  const value = target[key];
  Object.defineProperty(target, key, {
    get: () => {
      tally();
      return value;
    },
    enumerable: true,
    configurable: true,
  });
}

/**
 * A review that counts what is read of it, for a test that a function reads a view once per call, not once per row. It
 * has `pairs` pairs, each a live row and a base row of one song with the submitted start and end both moved by 5 s (so
 * every pair suggests a time change and works out its end), and `gone` more submitted rows, moved the same way, whose
 * live performance is gone since: each is an add that stands for a base row, unticked, and read against the base.
 *
 * `view.base` counts its reads, and so do the title of the first base row and that of the first live row, which the
 * matcher's keys and the draft's comparisons read (`matchKey` once for every key it works out of a base row). A
 * function that works each of them out once per call reads all three as often for 40 rows as for 10; one that works
 * them out again for every row reads them more, the more rows there are. The starts an end is read against
 * (`referenceStarts`) read no title, so these counters do not watch them. The counters go in after the view is paired,
 * so building the view counts nothing; `reset` zeroes them.
 *
 * Its view is read-only. The counters are accessors with no setter, so assigning `view.base`, or the title of the
 * first base or live row, throws a TypeError (the suites run in strict mode): the one exception to the header's promise
 * that a test may edit what it gets.
 */
export function countedReadsView({ pairs, gone }: { pairs: number; gone: number }): {
  view: NovaVodCorrectionView;
  reads: () => ReadCounts;
  reset: () => void;
} {
  const startOf = (index: number): number => 100 + index * 300;
  const songs = Array.from({ length: pairs + gone }, (_, index) => ({
    was: row(`Song ${index}`, `Artist ${index}`, startOf(index), startOf(index) + 240),
    submitted: row(`Song ${index}`, `Artist ${index}`, startOf(index) + 5, startOf(index) + 245),
  }));
  const view = correctionView({
    base: songs.map(({ was }, index) => baseRow(`p${index + 1}`, was)),
    current: songs.slice(0, pairs).map(({ was }, index) => liveRow(`p${index + 1}`, was)),
    proposed: songs.map(({ submitted }) => submitted),
  });

  const counts: ReadCounts = { base: 0, baseTitle: 0, liveTitle: 0 };
  const firstBase = view.base?.[0];
  const firstLive = view.current[0];
  if (firstBase) counted(firstBase, 'title', () => { counts.baseTitle += 1; });
  if (firstLive) counted(firstLive, 'title', () => { counts.liveTitle += 1; });
  const base = view.base;
  Object.defineProperty(view, 'base', {
    get: () => {
      counts.base += 1;
      return base;
    },
    enumerable: true,
    configurable: true,
  });
  return {
    view,
    reads: () => ({ ...counts }),
    reset: () => {
      counts.base = 0;
      counts.baseTitle = 0;
      counts.liveTitle = 0;
    },
  };
}

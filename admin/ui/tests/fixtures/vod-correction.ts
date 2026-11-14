/**
 * The ichii correction of VOD VqAa6fUDZXI as `GET /api/nova/vods/:id/correction` returns it: seven rows on the
 * stream and six proposed, paired by the matcher. Six pairs, one current row left over (A Tender Moon Tempo, a
 * delete candidate), and a typo in the first title (Late Niqht Drive). Every pair's times moved by a few seconds.
 *
 * A factory, so a test may edit what it gets without touching the next test's view.
 *
 * `startOnlyCorrectionView` is a correction pasted as start times only, to fix one title (Snog C → Song C): Nova's
 * parser filled every end with the next row's start and left the last one empty, so none of the submitted ends is the
 * contributor's. The stream's own ends are curated, each before the next start.
 */
import type { NovaVodSubmission } from '../../../shared/types';
import { matchCorrection } from '../../../shared/vod-correction';
import type { CorrectionCurrentRow, CorrectionProposedRow, NovaVodCorrectionView } from '../../../shared/vod-correction';

const row = (title: string, originalArtist: string, timestamp: number, endTimestamp: number | null) => ({ title, originalArtist, timestamp, endTimestamp });

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

const currentRow = (fields: ReturnType<typeof row>, index: number): CorrectionCurrentRow => ({
  ...fields,
  performanceId: `p${index + 1}`,
  songId: `s${index + 1}`,
  status: 'approved',
  songStatus: 'approved',
  songPerformanceCount: 1,
});

const proposedRow = (fields: ReturnType<typeof row>, index: number): CorrectionProposedRow => ({
  ...fields,
  id: `v${index + 1}`,
  existingSong: null,
});

export function startOnlyCorrectionView(): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.current = START_ONLY_CURRENT.map(currentRow);
  view.proposed = START_ONLY_PROPOSED.map(proposedRow);
  view.match = matchCorrection(view.current, view.proposed);
  return view;
}

export function ichiiCorrectionView(): NovaVodCorrectionView {
  const current = ICHII_CURRENT.map(currentRow);
  const proposed = ICHII_PROPOSED.map(proposedRow);
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
    current,
    proposed,
    match: matchCorrection(current, proposed),
    fingerprint: 'f'.repeat(64),
    otherPendingCount: 0,
  };
}

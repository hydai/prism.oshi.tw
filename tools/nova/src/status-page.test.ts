import { renderStatusPage } from './status-page';
import type { AdminStreamSummary, SubmissionSummary, VodSubmissionSummary } from './types';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const XSS = '<script>alert(document.domain)</script>';

const submissions: SubmissionSummary[] = [
  {
    id: 'sub-1',
    slug: 'mizuki',
    display_name: '浠Mizuki',
    avatar_url: 'https://yt3.ggpht.com/avatar=s96',
    status: 'approved',
    submitted_at: '2025-11-04T10:12:00.000Z',
    reviewed_at: '2025-11-04T18:40:00.000Z',
    reviewer_note: '',
  },
  {
    id: 'sub-2',
    slug: 'test-channel',
    display_name: XSS,
    avatar_url: '',
    status: 'rejected',
    submitted_at: '2026-08-10T03:12:00.000Z',
    reviewed_at: '2026-08-10T09:00:00.000Z',
    reviewer_note: '不是 VTuber 頻道',
  },
];

const vods: VodSubmissionSummary[] = [
  {
    id: 'vod-1',
    streamer_slug: 'mizuki',
    video_id: 'pRy1JZ2jSi8',
    stream_title: '【歌枠】' + XSS,
    stream_date: '2026-08-22',
    status: 'pending',
    submitted_at: '2026-08-22T23:10:00.000Z',
    reviewed_at: null,
    reviewer_note: '',
    song_count: 19,
  },
  {
    id: 'vod-2',
    streamer_slug: 'mizuki',
    video_id: 'qgMiX4lw2TQ',
    stream_title: '【合唱歌枠】相遇的起點',
    stream_date: '2026-07-25',
    status: 'approved',
    submitted_at: '2026-07-26T10:05:00.000Z',
    reviewed_at: '2026-07-26T12:30:00.000Z',
    reviewer_note: '',
    song_count: 20,
  },
];

const vodsWithImportedPending: VodSubmissionSummary[] = [
  ...vods,
  {
    id: 'vod-3',
    streamer_slug: 'mizuki',
    video_id: 'T4ORfh2Iv8c',
    stream_title: '【突】酒後要唱歌',
    stream_date: '2026-08-11',
    status: 'pending',
    submitted_at: '2026-08-12T01:22:00.000Z',
    reviewed_at: null,
    reviewer_note: '',
    song_count: 13,
  },
];

const adminStreams: AdminStreamSummary[] = [
  {
    id: 'adm-3',
    streamer_id: 'mizuki',
    video_id: 'T4ORfh2Iv8c',
    title: '【突】酒後要唱歌',
    date: '2026-08-11',
    status: 'approved',
    created_at: '2026-08-12T09:00:00.000Z',
    song_count: 13,
  },
  {
    id: 'adm-1',
    streamer_id: 'mizuki',
    video_id: 'qgMiX4lw2TQ',
    title: '【合唱歌枠】相遇的起點',
    date: '2026-07-25',
    status: 'approved',
    created_at: '2026-07-26T12:30:00.000Z',
    song_count: 20,
  },
  {
    id: 'adm-2',
    streamer_id: 'gabu',
    video_id: '9eXXLAEhrNM',
    title: '🇯🇵【歌回】請告訴我大家喜歡的歌',
    date: '2025-12-20',
    status: 'approved',
    created_at: '2025-12-21T11:40:00.000Z',
    song_count: 16,
  },
];

function render(filters: { vtuber: 'all' | 'pending' | 'approved' | 'rejected'; vod: 'all' | 'pending' | 'approved' | 'rejected' | 'admin_done' } = { vtuber: 'all', vod: 'all' }): string {
  return String(renderStatusPage(submissions, vods, adminStreams, filters));
}

function testEscapesUserContent(): void {
  const html = render();
  assert(!html.includes(XSS), 'raw script payload must never be emitted');
  assert(html.includes('&lt;script&gt;alert(document.domain)&lt;/script&gt;'), 'display name and stream title are escaped');
  console.log('status page escapes user content');
}

function testFilterChips(): void {
  const html = render({ vtuber: 'pending', vod: 'all' });
  assert(
    html.includes('href="/status?vtuber=pending" class="chip active" aria-current="page"'),
    'active VTuber filter is a gradient chip marked aria-current',
  );
  assert(html.includes('href="/status" class="chip">全部</a>'), 'inactive VTuber filter keeps its href');
  assert(html.includes('href="/status?vtuber=pending&amp;vod=pending" class="chip">審核中</a>'), 'VOD chips preserve the other axis');
  console.log('status page renders filter chips with preserved hrefs');
}

function testGroupedVodCards(): void {
  const html = render();
  const cardStart = html.indexOf('<details class="prism-card vod-group" open>');
  assert(cardStart !== -1, 'a group with a pending VOD renders open');
  assert(html.includes('<summary class="prism-card-head">'), 'group summary uses the prism card head');
  assert(html.includes('badge badge-pending">審核中</span>'), 'pending VOD renders the 審核中 pill');
  assert(html.includes('badge badge-admin_done">已收錄</span>'), 'admin-approved match renders the 已收錄 pill');
  assert(html.includes('https://i.ytimg.com/vi/pRy1JZ2jSi8/mqdefault.jpg'), 'valid video ids render a YouTube thumbnail');
  assert(html.includes('class="badge badge-pink">19 首</span>'), 'song count renders as a pink pill');
  assert(html.includes('<details class="prism-card vod-group">'), 'admin-only group without pending VODs renders collapsed');
  console.log('status page groups VODs into prism cards');
}

function testPendingCountUsesEffectiveStatus(): void {
  const html = String(renderStatusPage(submissions, vodsWithImportedPending, adminStreams, { vtuber: 'all', vod: 'all' }));
  const card = html.slice(html.indexOf('<details class="prism-card vod-group" open>'), html.indexOf('</details>'));
  assert(card.includes('<span class="badge badge-pending">1 審核中</span>'), 'a pending VOD already imported by admin is not counted as 審核中');
  const rows = card.split('class="prism-row vod-row"').slice(1);
  assert(rows.length === 3, 'the group renders all three VOD rows');
  assert(rows.filter((row) => row.includes('badge-admin_done')).length === 2, 'both imported VODs render the 已收錄 pill');
  console.log('status page counts pending VODs by their effective status');
}

function testVodIdentitySurvivesVtuberFilter(): void {
  const html = String(renderStatusPage(submissions, vods, adminStreams, { vtuber: 'rejected', vod: 'all' }));
  assert(!html.includes('<div class="cell-title">浠Mizuki</div>\n            <span class="mono">mizuki</span>\n            <div class="cell-meta only-mobile">'), 'VTuber list only shows rejected submissions');
  assert(html.includes('src="https://yt3.ggpht.com/avatar=s96"'), 'VOD group keeps the streamer avatar even when the VTuber filter hides that submission');
  assert(html.includes('<div class="cell-title">浠Mizuki</div>'), 'VOD group keeps the display name even when the VTuber filter hides that submission');
  assert(html.includes('<span class="badge badge-pink">2 筆</span>'), 'VTuber section count stays the total, not the filtered count');
  console.log('status page keeps VOD identity metadata under a VTuber filter');
}

function testRejectionReason(): void {
  const html = render();
  assert(html.includes('原因：不是 VTuber 頻道'), 'rejected rows show the reviewer note');
  console.log('status page shows rejection reasons');
}

function testEmptyState(): void {
  const html = String(renderStatusPage([], [], [], { vtuber: 'rejected', vod: 'all' }));
  assert(html.includes('沒有符合「已拒絕」的 VTuber 提交'), 'filtered empty state keeps its text');
  assert(html.includes('href="/status"') && html.includes('清除篩選'), 'empty state links back to the unfiltered page');
  assert(html.includes('尚無 VOD 提交紀錄'), 'unfiltered empty VOD section keeps its text');
  console.log('status page keeps its empty states');
}

try {
  testEscapesUserContent();
  testFilterChips();
  testGroupedVodCards();
  testRejectionReason();
  testPendingCountUsesEffectiveStatus();
  testVodIdentitySurvivesVtuberFilter();
  testEmptyState();
  console.log('status-page.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

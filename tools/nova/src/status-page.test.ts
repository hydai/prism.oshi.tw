import { renderStatusPage, type VodFilter } from './status-page';
import type { AdminStreamSummary, SubmissionSummary, VodSubmissionKind, VodSubmissionSummary } from './types';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
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
    kind: 'new',
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
    kind: 'new',
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
    kind: 'new',
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

const NONCE = 'test-nonce-value';

function render(filters: { vtuber: 'all' | 'pending' | 'approved' | 'rejected'; vod: 'all' | 'pending' | 'approved' | 'rejected' | 'admin_done' } = { vtuber: 'all', vod: 'all' }): string {
  return String(renderStatusPage(submissions, vods, adminStreams, filters, NONCE));
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
  const html = String(renderStatusPage(submissions, vodsWithImportedPending, adminStreams, { vtuber: 'all', vod: 'all' }, NONCE));
  const card = html.slice(html.indexOf('<details class="prism-card vod-group" open>'), html.indexOf('</details>'));
  assert(card.includes('<span class="badge badge-pending">1 審核中</span>'), 'a pending VOD already imported by admin is not counted as 審核中');
  const rows = card.split('class="prism-row vod-row"').slice(1);
  assert(rows.length === 3, 'the group renders all three VOD rows');
  assert(rows.filter((row) => row.includes('badge-admin_done')).length === 2, 'both imported VODs render the 已收錄 pill');
  console.log('status page counts pending VODs by their effective status');
}

function testVodIdentitySurvivesVtuberFilter(): void {
  const html = String(renderStatusPage(submissions, vods, adminStreams, { vtuber: 'rejected', vod: 'all' }, NONCE));
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

function testCarriesTheNonce(): void {
  const html = render();
  const inlineTags = html.match(/<(?:script|style)(?:\s[^>]*)?>/g) ?? [];
  assert(inlineTags.length >= 3, `page still ships its inline tags (found ${inlineTags.length})`);
  for (const tag of inlineTags) {
    assert(tag.includes(`nonce="${NONCE}"`), `inline tag carries the nonce — ${tag.slice(0, 60)}`);
  }
  console.log('status page stamps the nonce on every inline tag');
}

function testImageFallbacksAreScripted(): void {
  const html = render();
  assert(!/ on[a-z]+="/.test(html), 'no inline event-handler attribute survives (the CSP blocks them)');
  assert(/<img class="avatar[^>]*data-fallback/.test(html), 'avatars are marked data-fallback');
  assert(/<img class="thumb"[^>]*data-fallback/.test(html), 'thumbnails are marked data-fallback');
  assert(html.includes("addEventListener('error'"), 'one delegated listener replaces the per-row handlers');
  assert(html.includes('dataset.fallback'), 'the listener only touches images that opted in');
  console.log('status page falls back to gradient tiles from one delegated listener');
}

function testEmptyState(): void {
  const html = String(renderStatusPage([], [], [], { vtuber: 'rejected', vod: 'all' }, NONCE));
  assert(html.includes('沒有符合「已拒絕」的 VTuber 提交'), 'filtered empty state keeps its text');
  assert(html.includes('href="/status"') && html.includes('清除篩選'), 'empty state links back to the unfiltered page');
  assert(html.includes('尚無 VOD 提交紀錄'), 'unfiltered empty VOD section keeps its text');
  console.log('status page keeps its empty states');
}

// --- Corrections -----------------------------------------------------------
// A correction resubmits the song list of a VOD the admin already archived. These
// cases use a streamer and a video of their own, and give the admin stream and the
// submission different titles, so a row is told apart by what it is rather than by
// where it sits. The page prints every status label in its filter chips, so rows
// are checked through their own markup — `includes('已收錄')` would always pass.

const ARCHIVED_VIDEO = 'Archived_V1';
const ARCHIVED_TITLE = '已收錄的歌枠';
const SUBMITTED_TITLE = '歌枠（投稿版）';
const SUMMARY_DOT = ' <span class="dot">·</span> ';

const archivedStream: AdminStreamSummary = {
  id: 'adm-archived',
  streamer_id: 'demo-streamer',
  video_id: ARCHIVED_VIDEO,
  title: ARCHIVED_TITLE,
  date: '2026-06-01',
  status: 'approved',
  created_at: '2026-06-02T09:00:00.000Z',
  song_count: 7,
};

function submissionOnArchivedVod(
  kind: VodSubmissionKind,
  overrides: Partial<VodSubmissionSummary> = {},
): VodSubmissionSummary {
  return {
    id: 'vod-on-archived',
    streamer_slug: 'demo-streamer',
    video_id: ARCHIVED_VIDEO,
    stream_title: SUBMITTED_TITLE,
    stream_date: '2026-06-01',
    status: 'pending',
    submitted_at: '2026-11-10T08:00:00.000Z',
    reviewed_at: null,
    reviewer_note: '',
    kind,
    song_count: 6,
    ...overrides,
  };
}

function renderVodSection(
  vodSubmissions: VodSubmissionSummary[],
  streams: AdminStreamSummary[],
  vod: VodFilter = 'all',
): string {
  return String(renderStatusPage([], vodSubmissions, streams, { vtuber: 'all', vod }, NONCE));
}

/** Each VOD row's markup in page order; a row ends where the next begins, or at its group card. */
function vodRows(html: string): string[] {
  return html
    .split('class="prism-row vod-row"')
    .slice(1)
    .map((chunk) => chunk.split('</details>')[0]);
}

function rowTitled(html: string, title: string): string {
  const row = vodRows(html).find((candidate) => candidate.includes(`<div class="cell-title">${title}</div>`));
  if (row === undefined) throw new Error(`no VOD row is titled ${title}`);
  return row;
}

/** The row's status pill as "badge-class label". A row prints it twice (mobile and desktop), identically. */
function statusPillOf(row: string): string {
  const match = row.match(/<span class="badge (badge-(?:pending|approved|rejected|admin_done))">([^<]*)<\/span>/);
  if (match === null) throw new Error('the row has no status pill');
  return `${match[1]} ${match[2]}`;
}

/** The VOD section's own 筆 badge, read beside its title: each group card wears the same badge for its rows. */
function vodSectionCount(html: string): number {
  const match = html.match(/<span class="prism-section-title">VOD 提交<\/span>\s*<span class="badge badge-pink">(\d+) 筆<\/span>/);
  if (match === null) throw new Error('the VOD section has no count badge');
  return Number(match[1]);
}

/** The hero's 場 figure: how many VODs the page covers. */
function heroVodCount(html: string): number {
  const match = html.match(/<strong>\d+ 位 VTuber、(\d+) 場 VOD<\/strong>/);
  if (match === null) throw new Error('the hero has no VOD count');
  return Number(match[1]);
}

function songCountOf(row: string): number {
  const match = row.match(/<span class="badge badge-pink">(\d+) 首<\/span>/);
  if (match === null) throw new Error('the row has no song count');
  return Number(match[1]);
}

function testNewSubmissionStillTakesTheArchivedRow(): void {
  // Unchanged behaviour, pinned from both sides: a kind 'new' submission matched
  // by an approved stream is promoted to 已收錄, reads the stream's song count and
  // is the only row — the admin-only row is not listed a second time. The counts
  // differ (3 vs 7) so a count taken from the wrong side would show.
  const html = renderVodSection([submissionOnArchivedVod('new', { status: 'approved', song_count: 3 })], [archivedStream]);
  const rows = vodRows(html);
  assertEqual(rows.length, 1, 'the submission takes over the archived VOD row');
  assertEqual(statusPillOf(rows[0]), 'badge-admin_done 已收錄', 'the new submission is promoted to 已收錄');
  assertEqual(songCountOf(rows[0]), 7, "the new submission reads the admin stream's song count");
  assert(rows[0].includes(`<div class="cell-title">${SUBMITTED_TITLE}</div>`), 'the surviving row is the submission, not the admin-only row');
  console.log('status page keeps a new submission as the single 已收錄 row');
}

function testCorrectionKeepsTheArchivedRow(): void {
  const html = renderVodSection([submissionOnArchivedVod('correction', { song_count: 6 })], [archivedStream]);
  assertEqual(vodRows(html).length, 2, 'the archived VOD keeps its row beside the correction');

  const archived = rowTitled(html, ARCHIVED_TITLE);
  assertEqual(statusPillOf(archived), 'badge-admin_done 已收錄', 'the archived row stays 已收錄');
  assertEqual(songCountOf(archived), 7, "the archived row reads the stream's song count");

  const correction = rowTitled(html, SUBMITTED_TITLE);
  assertEqual(statusPillOf(correction), 'badge-pending 修正審核中', 'a pending correction reads 修正審核中, never 已收錄');
  assertEqual(songCountOf(correction), 6, "the correction reads its own song count, not the stream's");
  console.log('status page keeps the archived row beside a pending correction');
}

function testCorrectionLabelsKeepTheirBaseBadgeClass(): void {
  // Label per status, the CSS class of the base status, the reviewer note only on
  // a rejected row (an approved correction's note is the auto summary), and the
  // base-status filter that lists the row. admin_done must list the archived row.
  const cases = [
    { status: 'pending', pill: 'badge-pending 修正審核中', note: '', reviewedAt: null, showsNote: false },
    { status: 'approved', pill: 'badge-approved 修正已通過', note: '套用 6 項（時間 6）', reviewedAt: '2026-11-11T08:00:00.000Z', showsNote: false },
    { status: 'rejected', pill: 'badge-rejected 修正未採用', note: '歌單與影片不符', reviewedAt: '2026-11-11T08:00:00.000Z', showsNote: true },
  ] as const;

  for (const { status, pill, note, reviewedAt, showsNote } of cases) {
    const correction = submissionOnArchivedVod('correction', { status, reviewer_note: note, reviewed_at: reviewedAt });
    const html = renderVodSection([correction], [archivedStream]);
    const row = rowTitled(html, SUBMITTED_TITLE);
    assertEqual(statusPillOf(row), pill, `a ${status} correction`);
    assertEqual(songCountOf(row), 6, `a ${status} correction reads its own song count`);
    assertEqual(note !== '' && row.includes(note), showsNote, `a ${status} correction ${showsNote ? 'shows' : 'does not publish'} its reviewer note`);
    if (showsNote) assert(row.includes(`原因：${note}`), 'a rejected correction labels its reviewer note 原因');

    const underOwnFilter = vodRows(renderVodSection([correction], [archivedStream], status));
    assertEqual(underOwnFilter.length, 1, `?vod=${status} lists only the ${status} correction`);
    assertEqual(statusPillOf(underOwnFilter[0]), pill, `?vod=${status} lists the correction`);

    const underArchived = vodRows(renderVodSection([correction], [archivedStream], 'admin_done'));
    assertEqual(underArchived.length, 1, `?vod=admin_done lists one row beside a ${status} correction`);
    assertEqual(statusPillOf(underArchived[0]), 'badge-admin_done 已收錄', `?vod=admin_done lists the archived row beside a ${status} correction`);
  }
  console.log('status page labels corrections by status and files them under the base filters');
}

function testVodFiltersPlaceCorrectionsByBaseStatus(): void {
  const vodSubmissions = [submissionOnArchivedVod('correction')];

  // Today the promoted correction shows up here as 已收錄 and the admin-only row is
  // hidden, so a bare "an 已收錄 row exists" would pass; the title tells them apart.
  const archivedRows = vodRows(renderVodSection(vodSubmissions, [archivedStream], 'admin_done'));
  assertEqual(archivedRows.length, 1, '?vod=admin_done lists one row');
  assert(archivedRows[0].includes(`<div class="cell-title">${ARCHIVED_TITLE}</div>`), '?vod=admin_done lists the archived VOD itself');
  assertEqual(songCountOf(archivedRows[0]), 7, '?vod=admin_done reads the stream song count');

  const pendingRows = vodRows(renderVodSection(vodSubmissions, [archivedStream], 'pending'));
  assertEqual(pendingRows.length, 1, '?vod=pending lists one row');
  assert(pendingRows[0].includes(`<div class="cell-title">${SUBMITTED_TITLE}</div>`), '?vod=pending lists the correction');
  assertEqual(statusPillOf(pendingRows[0]), 'badge-pending 修正審核中', '?vod=pending shows the correction label');

  const approvedHtml = renderVodSection(vodSubmissions, [archivedStream], 'approved');
  assertEqual(vodRows(approvedHtml).length, 0, '?vod=approved lists neither the pending correction nor the archived row');
  assert(approvedHtml.includes('沒有符合「已通過」的 VOD 提交'), '?vod=approved falls back to its empty state');
  console.log('status page files corrections under the pending, approved and rejected filters');
}

function testCorrectionDoesNotDropTheArchivedVodFromTheCounts(): void {
  // The first correction on an archived VOD with no earlier submission must not
  // take it out of the 已收錄 count: both rows are counted.
  const pending = renderVodSection([submissionOnArchivedVod('correction')], [archivedStream]);
  assertEqual(vodSectionCount(pending), 2, 'the VOD section counts the correction and the archived VOD');
  assertEqual(heroVodCount(pending), 1, 'the hero counts one VOD: a correction is not another VOD');
  assert(
    pending.includes(['1 審核中', '0 已通過', '0 已拒絕', '1 已收錄'].join(SUMMARY_DOT)),
    'the summary counts a pending correction as 審核中 and still counts the archived VOD as 已收錄',
  );
  assert(pending.includes('<details class="prism-card vod-group" open>'), 'a pending correction opens its group');
  assert(pending.includes('<span class="badge badge-pending">1 審核中</span>'), "the group's pill counts the pending correction");

  const applied = renderVodSection([submissionOnArchivedVod('correction', { status: 'approved' })], [archivedStream]);
  assert(
    applied.includes(['0 審核中', '1 已通過', '0 已拒絕', '1 已收錄'].join(SUMMARY_DOT)),
    'an applied correction is counted as 已通過 and the archived VOD still as 已收錄',
  );
  assert(applied.includes('<details class="prism-card vod-group">'), 'a group with no pending row stays collapsed');
  console.log('status page counts the archived VOD and its correction together');
}

function testCorrectionSitsBesideAnEarlierNewSubmission(): void {
  // Only a kind 'new' submission takes over the admin-only row. Here one already
  // did, so the correction adds a row and the archived VOD is still listed once.
  const earlier = submissionOnArchivedVod('new', {
    id: 'vod-earlier',
    stream_title: '歌枠（首次投稿）',
    status: 'approved',
    submitted_at: '2026-06-01T08:00:00.000Z',
    reviewed_at: '2026-06-01T12:00:00.000Z',
    song_count: 3,
  });
  const html = renderVodSection([earlier, submissionOnArchivedVod('correction')], [archivedStream]);
  assertEqual(vodRows(html).length, 2, 'the earlier submission and the correction are the two rows');
  assertEqual(vodSectionCount(html), 2, 'the VOD section counts both rows');
  assertEqual(heroVodCount(html), 1, 'the hero still counts one VOD');
  assert(!html.includes(`<div class="cell-title">${ARCHIVED_TITLE}</div>`), 'the admin-only row stays hidden while a new submission matches');

  const earlierRow = rowTitled(html, '歌枠（首次投稿）');
  assertEqual(statusPillOf(earlierRow), 'badge-admin_done 已收錄', 'the earlier submission is the 已收錄 row');
  assertEqual(songCountOf(earlierRow), 7, "the earlier submission reads the stream's song count");
  const correctionRow = rowTitled(html, SUBMITTED_TITLE);
  assertEqual(statusPillOf(correctionRow), 'badge-pending 修正審核中', 'the correction is not promoted');
  assertEqual(songCountOf(correctionRow), 6, 'the correction reads its own song count');

  const archivedRows = vodRows(renderVodSection([earlier, submissionOnArchivedVod('correction')], [archivedStream], 'admin_done'));
  assertEqual(archivedRows.length, 1, '?vod=admin_done lists the earlier submission only');
  assert(archivedRows[0].includes('歌枠（首次投稿）'), '?vod=admin_done lists the row that stands for the archived VOD');
  const pendingRows = vodRows(renderVodSection([earlier, submissionOnArchivedVod('correction')], [archivedStream], 'pending'));
  assertEqual(pendingRows.length, 1, '?vod=pending lists the correction only');
  assert(pendingRows[0].includes(`<div class="cell-title">${SUBMITTED_TITLE}</div>`), '?vod=pending lists the correction');
  console.log('status page lists a correction beside the earlier submission of an archived VOD');
}

try {
  testEscapesUserContent();
  testFilterChips();
  testGroupedVodCards();
  testRejectionReason();
  testPendingCountUsesEffectiveStatus();
  testVodIdentitySurvivesVtuberFilter();
  testCarriesTheNonce();
  testImageFallbacksAreScripted();
  testEmptyState();
  testNewSubmissionStillTakesTheArchivedRow();
  testCorrectionKeepsTheArchivedRow();
  testCorrectionLabelsKeepTheirBaseBadgeClass();
  testVodFiltersPlaceCorrectionsByBaseStatus();
  testCorrectionDoesNotDropTheArchivedVodFromTheCounts();
  testCorrectionSitsBesideAnEarlierNewSubmission();
  console.log('status-page.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

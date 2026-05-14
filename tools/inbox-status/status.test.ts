import * as assert from 'node:assert/strict';

import {
  buildReport,
  exitCodeForReport,
  formatReport,
  parseWranglerResults,
  PENDING_CRYSTAL_SQL,
  PENDING_STREAMERS_SQL,
  PENDING_VODS_SQL,
  type CrystalTicketRow,
  type StatusCountRow,
  type StreamerSubmissionRow,
  type VodSubmissionRow,
} from './status';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test('parseWranglerResults returns the first result set rows', () => {
  const raw = JSON.stringify([
    {
      results: [{ id: 'row-1' }, { id: 'row-2' }],
      success: true,
    },
  ]);

  assert.deepEqual(parseWranglerResults<{ id: string }>(raw), [{ id: 'row-1' }, { id: 'row-2' }]);
});

test('buildReport combines Nova and Crystal counts by inbox', () => {
  const counts: StatusCountRow[] = [
    { inbox: 'streamer', status: 'approved', total: 31, latest_submitted_at: '2026-04-17 13:37:09' },
    { inbox: 'vod', status: 'pending', total: 2, latest_submitted_at: '2026-05-12 16:07:03' },
    { inbox: 'vod', status: 'approved', total: 100, latest_submitted_at: '2026-05-11 11:46:27' },
    { inbox: 'crystal', status: 'pending', total: 1, latest_submitted_at: '2026-05-04 15:49:15' },
  ];

  const report = buildReport({
    counts,
    pendingStreamers: [],
    pendingVods: [],
    pendingCrystalTickets: [],
    latestStreamers: [],
    latestVods: [],
    latestCrystalTickets: [],
  });

  assert.equal(report.inboxes.streamer.pending, 0);
  assert.equal(report.inboxes.vod.pending, 2);
  assert.equal(report.inboxes.vod.statuses.approved, 100);
  assert.equal(report.inboxes.crystal.pending, 1);
  assert.equal(exitCodeForReport(report), 1);
});

test('formatReport prints pending details for streamers, VODs, and Crystal tickets', () => {
  const pendingStreamers: StreamerSubmissionRow[] = [
    {
      id: 'sub-new',
      slug: 'newslug',
      display_name: '新的 VTuber',
      youtube_channel_url: 'https://youtube.example/channel',
      submitted_at: '2026-05-13 12:00:00',
    },
  ];
  const pendingVods: VodSubmissionRow[] = [
    {
      id: 'vod-new',
      streamer_slug: 'nagi',
      video_id: 'abc123',
      video_url: 'https://youtu.be/abc123',
      stream_title: '歌回',
      stream_date: '2026-05-12',
      submitter_note: 'timestamps inside',
      submitted_at: '2026-05-13 13:00:00',
      song_count: 5,
    },
  ];
  const pendingCrystalTickets: CrystalTicketRow[] = [
    {
      id: 'crys-new',
      type: 'feat',
      title: '希望新增功能',
      body: '內容',
      nickname: 'tester',
      contact: 'tester@example.com',
      is_public_reply_allowed: 1,
      context_url: 'https://prism.oshi.tw/nagi',
      submitted_at: '2026-05-13 14:00:00',
    },
  ];

  const report = buildReport({
    counts: [
      { inbox: 'streamer', status: 'pending', total: 1, latest_submitted_at: '2026-05-13 12:00:00' },
      { inbox: 'vod', status: 'pending', total: 1, latest_submitted_at: '2026-05-13 13:00:00' },
      { inbox: 'crystal', status: 'pending', total: 1, latest_submitted_at: '2026-05-13 14:00:00' },
    ],
    pendingStreamers,
    pendingVods,
    pendingCrystalTickets,
    latestStreamers: pendingStreamers,
    latestVods: pendingVods,
    latestCrystalTickets: pendingCrystalTickets,
  });

  const output = formatReport(report);

  assert.match(output, /Streamer\s+1/);
  assert.match(output, /VOD\s+1/);
  assert.match(output, /Crystal\s+1/);
  assert.match(output, /sub-new pending newslug/);
  assert.match(output, /vod-new pending nagi\/abc123 \(5 songs\)/);
  assert.match(output, /crys-new pending feat/);
  assert.match(output, /需要處理/);
});

test('pending detail queries fetch all pending rows instead of silently capping results', () => {
  for (const sql of [PENDING_STREAMERS_SQL, PENDING_VODS_SQL, PENDING_CRYSTAL_SQL]) {
    assert.doesNotMatch(sql, /\bLIMIT\b/i);
  }
});

test('formatReport reports a clean inbox and exits zero when no pending rows exist', () => {
  const report = buildReport({
    counts: [
      { inbox: 'streamer', status: 'approved', total: 31, latest_submitted_at: '2026-04-17 13:37:09' },
      { inbox: 'vod', status: 'approved', total: 100, latest_submitted_at: '2026-05-12 16:07:03' },
      { inbox: 'crystal', status: 'replied', total: 13, latest_submitted_at: '2026-05-04 15:49:15' },
    ],
    pendingStreamers: [],
    pendingVods: [],
    pendingCrystalTickets: [],
    latestStreamers: [],
    latestVods: [],
    latestCrystalTickets: [],
  });

  const output = formatReport(report);

  assert.match(output, /✓ no pending inbox items/);
  assert.equal(exitCodeForReport(report), 0);
});

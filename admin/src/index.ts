import { Hono } from 'hono';
import { requireAuth, requireCurator } from './auth';
import {
  listSongs,
  getSongById,
  insertSong,
  updateSong,
  updateSongStatus,
  generateSongId,
  listPerformances,
  insertPerformance,
  getPerformanceStatus as db_getPerformanceStatus,
  updatePerformanceStatus,
  generatePerformanceId,
  listStreams,
  getStreamById,
  insertStream,
  updateStreamStatus,
  generateStreamId,
  generateStreamIdFallback,
  streamIdExists,
  videoIdExists,
  getDashboardStats,
  exportSongs,
  exportStreams,
  listPerformancesForStream,
  createSongAndPerformance,
  updatePerformanceTimestamps,
  updatePerformanceSongDetails,
  deletePerformanceAndOrphanSong,
  listStreamsWithPendingCounts,
  getStampStats,
  clearAllEndTimestamps,
  getPerformanceWithSong,
  bulkCreatePerformances,
  getStreamDetail,
  updatePerformanceNote,
} from './db';
import { fetchItunesDuration } from './itunes';
import { parseTextToSongs } from '../shared/parse';
import { discoverStreams, getVideoDetails, fetchComments, findCandidateComment, countTimestamps } from './youtube';
import type {
  AuthUser,
  CreateSongBody,
  UpdateSongBody,
  CreatePerformanceBody,
  CreateStreamBody,
  StatusUpdateBody,
  CreateStampPerformanceBody,
  UpdateTimestampsBody,
  UpdateSongDetailsBody,
  FetchDurationResponse,
  PasteImportBody,
  PasteImportResponse,
  DiscoverStreamsResponse,
  DiscoveredStream,
  ImportStreamsBody,
  ImportStreamsResponse,
  ExtractResponse,
  ExtractImportBody,
  ExtractImportResponse,
  NovaSubmission,
  NovaStatus,
} from '../shared/types';

type StreamerChannelConfig = {
  channelId: string;
};

type Bindings = {
  DB: D1Database;
  NOVA_DB: D1Database;
  CURATOR_EMAILS: string;
  STREAMER_CONFIG: string; // JSON: Record<slug, StreamerChannelConfig>
  YOUTUBE_API_KEY: string;
};

type Variables = {
  user: AuthUser;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** Extract streamer slug from ?streamer= query param, default 'mizuki'. */
function getStreamerId(c: { req: { query: (key: string) => string | undefined } }): string {
  return c.req.query('streamer') || 'mizuki';
}

/** Look up a streamer's YouTube channel ID from STREAMER_CONFIG env var. */
function getChannelId(configJson: string, streamerId: string): string | null {
  try {
    const config: Record<string, StreamerChannelConfig> = JSON.parse(configJson);
    return config[streamerId]?.channelId ?? null;
  } catch {
    return null;
  }
}

// --- Status transition rules ---

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'excluded', 'extracted']);

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  pending:   new Set(['approved', 'rejected', 'excluded', 'extracted']),
  extracted: new Set(['approved', 'rejected', 'excluded', 'pending']),
  approved:  new Set(['extracted', 'pending']),  // unapprove
  rejected:  new Set(['pending', 'excluded']),
  excluded:  new Set(['pending']),               // restore from excluded
};

function isValidTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

// All routes require authentication
app.use('/api/*', requireAuth);

// --- Auth info ---

app.get('/api/me', async (c) => {
  return c.json(c.get('user'));
});

// --- Songs ---

app.get('/api/songs', async (c) => {
  const streamerId = getStreamerId(c);
  const status = c.req.query('status');
  const songs = await listSongs(c.env.DB, streamerId, status);
  return c.json({ data: songs, total: songs.length });
});

app.get('/api/songs/:id', async (c) => {
  const song = await getSongById(c.env.DB, c.req.param('id'));
  if (!song) return c.json({ error: 'Song not found' }, 404);
  return c.json(song);
});

app.post('/api/songs', async (c) => {
  const streamerId = getStreamerId(c);
  const body = await c.req.json<CreateSongBody>();
  if (!body.title || !body.originalArtist) {
    return c.json({ error: 'title and originalArtist are required' }, 400);
  }

  const user = c.get('user');
  const id = generateSongId();
  await insertSong(c.env.DB, streamerId, id, body.title, body.originalArtist, body.tags || [], user.email);

  // If inline performances are provided, insert them too
  if (body.performances && body.performances.length > 0) {
    for (const perf of body.performances) {
      const perfId = generatePerformanceId();
      await insertPerformance(
        c.env.DB,
        streamerId,
        perfId,
        id,
        perf.streamId,
        perf.date,
        perf.streamTitle,
        perf.videoId,
        perf.timestamp,
        perf.endTimestamp ?? null,
        perf.note ?? '',
        user.email,
      );
    }
  }

  const song = await getSongById(c.env.DB, id);
  return c.json(song, 201);
});

app.put('/api/songs/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  const existing = await getSongById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Song not found' }, 404);

  // Contributors can only edit their own pending entries
  if (user.role !== 'curator') {
    if (existing.status !== 'pending') {
      return c.json({ error: 'Can only edit pending songs' }, 403);
    }
    if (existing.submittedBy !== user.email) {
      return c.json({ error: 'Can only edit your own submissions' }, 403);
    }
  }

  const body = await c.req.json<UpdateSongBody>();
  await updateSong(c.env.DB, id, {
    title: body.title,
    originalArtist: body.originalArtist,
    tags: body.tags,
  });

  const updated = await getSongById(c.env.DB, id);
  return c.json(updated);
});

app.patch('/api/songs/:id/status', requireCurator, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<StatusUpdateBody>();

  if (!VALID_STATUSES.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}` }, 400);
  }

  const existing = await getSongById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Song not found' }, 404);

  if (!isValidTransition(existing.status, body.status)) {
    return c.json({ error: `Cannot transition from ${existing.status} to ${body.status}` }, 400);
  }

  const user = c.get('user');
  await updateSongStatus(c.env.DB, id, body.status, user.email);
  const song = await getSongById(c.env.DB, id);
  return c.json(song);
});

// --- Performances ---

app.get('/api/performances', async (c) => {
  const streamerId = getStreamerId(c);
  const songId = c.req.query('songId');
  const status = c.req.query('status');
  const performances = await listPerformances(c.env.DB, streamerId, songId, status);
  return c.json({ data: performances, total: performances.length });
});

app.post('/api/performances', async (c) => {
  const streamerId = getStreamerId(c);
  const body = await c.req.json<CreatePerformanceBody>();
  if (!body.songId || !body.streamId || !body.date || !body.streamTitle || !body.videoId || body.timestamp === undefined) {
    return c.json({ error: 'songId, streamId, date, streamTitle, videoId, and timestamp are required' }, 400);
  }

  const user = c.get('user');
  const id = generatePerformanceId();
  await insertPerformance(
    c.env.DB,
    streamerId,
    id,
    body.songId,
    body.streamId,
    body.date,
    body.streamTitle,
    body.videoId,
    body.timestamp,
    body.endTimestamp ?? null,
    body.note ?? '',
    user.email,
  );

  return c.json({ id, status: 'pending' }, 201);
});

app.patch('/api/performances/:id/status', requireCurator, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<StatusUpdateBody>();

  if (!VALID_STATUSES.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}` }, 400);
  }

  // Get current status for transition check
  const current = await db_getPerformanceStatus(c.env.DB, id);
  if (!current) return c.json({ error: 'Performance not found' }, 404);

  if (!isValidTransition(current, body.status)) {
    return c.json({ error: `Cannot transition from ${current} to ${body.status}` }, 400);
  }

  await updatePerformanceStatus(c.env.DB, id, body.status);
  return c.json({ id, status: body.status });
});

// --- Streams ---

app.get('/api/streams', async (c) => {
  const streamerId = getStreamerId(c);
  const status = c.req.query('status');
  const streams = await listStreams(c.env.DB, streamerId, status);
  return c.json({ data: streams, total: streams.length });
});

app.post('/api/streams', async (c) => {
  const streamerId = getStreamerId(c);
  const body = await c.req.json<CreateStreamBody>();
  if (!body.title || !body.date || !body.videoId || !body.youtubeUrl) {
    return c.json({ error: 'title, date, videoId, and youtubeUrl are required' }, 400);
  }

  const user = c.get('user');

  // Generate stream ID: prefer date-based, fallback to UUID if collision
  let id = generateStreamId(body.date);
  if (await streamIdExists(c.env.DB, id)) {
    id = generateStreamIdFallback();
  }

  await insertStream(
    c.env.DB,
    streamerId,
    id,
    body.title,
    body.date,
    body.videoId,
    body.youtubeUrl,
    JSON.stringify(body.credit || {}),
    user.email,
  );

  return c.json({ id, status: 'pending' }, 201);
});

app.patch('/api/streams/:id/status', requireCurator, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<StatusUpdateBody>();

  if (!VALID_STATUSES.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}` }, 400);
  }

  const existing = await getStreamById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Stream not found' }, 404);

  if (!isValidTransition(existing.status, body.status)) {
    return c.json({ error: `Cannot transition from ${existing.status} to ${body.status}` }, 400);
  }

  const user = c.get('user');
  await updateStreamStatus(c.env.DB, id, body.status, user.email);
  return c.json({ id, status: body.status });
});

// --- Stamp editor ---

app.get('/api/streams/:streamId/performances', async (c) => {
  const streamId = c.req.param('streamId');
  const performances = await listPerformancesForStream(c.env.DB, streamId);
  return c.json({ data: performances, total: performances.length });
});

app.post('/api/streams/:streamId/performances', async (c) => {
  const streamerId = getStreamerId(c);
  const streamId = c.req.param('streamId');
  const body = await c.req.json<CreateStampPerformanceBody>();
  if (!body.title || !body.originalArtist || body.timestamp === undefined) {
    return c.json({ error: 'title, originalArtist, and timestamp are required' }, 400);
  }

  const stream = await getStreamById(c.env.DB, streamId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const user = c.get('user');
  const result = await createSongAndPerformance(
    c.env.DB,
    streamerId,
    streamId,
    stream.date,
    stream.title,
    stream.videoId,
    body.title,
    body.originalArtist,
    body.timestamp,
    body.endTimestamp ?? null,
    body.note ?? '',
    user.email,
  );

  return c.json(result, 201);
});

app.patch('/api/performances/:id/timestamps', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateTimestampsBody>();
  const updated = await updatePerformanceTimestamps(c.env.DB, id, {
    timestamp: body.timestamp,
    endTimestamp: body.endTimestamp,
  });
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

app.patch('/api/performances/:id/details', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateSongDetailsBody>();
  const updated = await updatePerformanceSongDetails(c.env.DB, id, {
    title: body.title,
    originalArtist: body.originalArtist,
  });
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

app.delete('/api/performances/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deletePerformanceAndOrphanSong(c.env.DB, id);
  if (!deleted) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

// --- Stamp: streams with pending counts ---

app.get('/api/stamp/streams', async (c) => {
  const streamerId = getStreamerId(c);
  const streams = await listStreamsWithPendingCounts(c.env.DB, streamerId);
  return c.json({ data: streams, total: streams.length });
});

// --- Stamp: stats ---

app.get('/api/stamp/stats', async (c) => {
  const streamerId = getStreamerId(c);
  const stats = await getStampStats(c.env.DB, streamerId);
  return c.json(stats);
});

// --- Stream detail ---

app.get('/api/streams/:streamId/detail', async (c) => {
  const streamId = c.req.param('streamId');
  const detail = await getStreamDetail(c.env.DB, streamId);
  if (!detail) return c.json({ error: 'Stream not found' }, 404);
  return c.json(detail);
});

// --- Performance note update ---

app.patch('/api/performances/:id/note', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ note: string }>();
  if (body.note === undefined) {
    return c.json({ error: 'note is required' }, 400);
  }
  const updated = await updatePerformanceNote(c.env.DB, id, body.note);
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

// --- Stamp: paste import ---

app.post('/api/streams/:streamId/paste-import', async (c) => {
  const streamerId = getStreamerId(c);
  const streamId = c.req.param('streamId');
  const body = await c.req.json<PasteImportBody>();
  if (!body.text || !body.text.trim()) {
    return c.json({ error: 'text is required' }, 400);
  }

  const stream = await getStreamById(c.env.DB, streamId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const parsed = parseTextToSongs(body.text);
  if (parsed.length === 0) {
    return c.json<PasteImportResponse>({
      ok: false,
      parsed: 0,
      created: 0,
      replaced: false,
      errors: ['No valid song lines found in the pasted text'],
    });
  }

  const user = c.get('user');
  const songs = parsed.map((s) => ({
    songName: s.songName,
    artist: s.artist,
    startSeconds: s.startSeconds,
    endSeconds: s.endSeconds,
  }));

  const { created } = await bulkCreatePerformances(
    c.env.DB,
    streamerId,
    streamId,
    stream.date,
    stream.title,
    stream.videoId,
    songs,
    user.email,
    body.replace ?? false,
  );

  return c.json<PasteImportResponse>({
    ok: true,
    parsed: parsed.length,
    created,
    replaced: body.replace ?? false,
    errors: [],
  });
});

// --- Stamp: clear all end timestamps ---

app.delete('/api/streams/:streamId/end-timestamps', async (c) => {
  const streamId = c.req.param('streamId');
  const cleared = await clearAllEndTimestamps(c.env.DB, streamId);
  return c.json({ ok: true, cleared });
});

// --- Stamp: fetch duration from iTunes ---

app.post('/api/performances/:id/fetch-duration', async (c) => {
  const id = c.req.param('id');
  const perf = await getPerformanceWithSong(c.env.DB, id);
  if (!perf) return c.json({ error: 'Performance not found' }, 404);

  const { durationSec, matchConfidence } = await fetchItunesDuration(
    perf.originalArtist,
    perf.title,
  );

  let endTimestamp: number | null = null;
  if (durationSec && perf.endTimestamp === null) {
    endTimestamp = perf.timestamp + durationSec;
    await updatePerformanceTimestamps(c.env.DB, id, { endTimestamp });
  }

  const resp: FetchDurationResponse = {
    ok: true,
    durationSec,
    endTimestamp,
    matchConfidence,
  };
  return c.json(resp);
});

// --- Export (fan-site format) ---

app.get('/api/export/songs', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const songs = await exportSongs(c.env.DB, streamerId);
  return c.json(songs);
});

app.get('/api/export/streams', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const streams = await exportStreams(c.env.DB, streamerId);
  return c.json(streams);
});

// --- Pipeline: Discover streams from YouTube ---

app.post('/api/pipeline/discover', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured. Add it to .dev.vars for local dev or use wrangler secret put for production.' }, 500);
  }

  const channelId = getChannelId(c.env.STREAMER_CONFIG, streamerId);
  if (!channelId) {
    return c.json({ error: `No channel configured for streamer: ${streamerId}` }, 400);
  }

  let videos;
  try {
    videos = await discoverStreams(apiKey, channelId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown YouTube API error';
    return c.json({ error: msg }, 502);
  }

  // Check which videos already exist in D1 for this streamer (by video_id)
  const existing = await c.env.DB
    .prepare('SELECT id, video_id, status FROM streams WHERE streamer_id = ?')
    .bind(streamerId)
    .all<{ id: string; video_id: string; status: string }>();

  const existingByVideoId = new Map(
    existing.results.map((r) => [r.video_id, { id: r.id, status: r.status }]),
  );

  const streams: DiscoveredStream[] = videos.map((v) => {
    const ex = existingByVideoId.get(v.videoId);
    return {
      videoId: v.videoId,
      title: v.title,
      date: v.date,
      isNew: !ex,
      existingStreamId: ex?.id,
      existingStatus: ex?.status as DiscoveredStream['existingStatus'],
    };
  });

  // Sort: new first, then by date desc
  streams.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return b.date.localeCompare(a.date);
  });

  return c.json<DiscoverStreamsResponse>({ streams, total: streams.length });
});

// --- Pipeline: Import selected streams to D1 ---

app.post('/api/pipeline/import-streams', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const body = await c.req.json<ImportStreamsBody>();
  if (!body.videoIds || body.videoIds.length === 0) {
    return c.json({ error: 'videoIds is required' }, 400);
  }

  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  let videos;
  try {
    videos = await getVideoDetails(apiKey, body.videoIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown YouTube API error';
    return c.json({ error: msg }, 502);
  }

  const user = c.get('user');
  const streamIds: string[] = [];

  try {
    for (const v of videos) {
      if (await videoIdExists(c.env.DB, v.videoId)) {
        continue; // already imported, skip
      }

      let id = generateStreamId(v.date);
      if (await streamIdExists(c.env.DB, id)) {
        id = generateStreamIdFallback();
      }

      await insertStream(
        c.env.DB,
        streamerId,
        id,
        v.title,
        v.date,
        v.videoId,
        `https://www.youtube.com/watch?v=${v.videoId}`,
        '{}',
        user.email,
      );

      streamIds.push(id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Database error';
    return c.json({ error: `Failed to import streams: ${msg}` }, 500);
  }

  return c.json<ImportStreamsResponse>({ created: streamIds.length, streamIds });
});

// --- Pipeline: Extract timestamps from YouTube comments/description ---

app.post('/api/pipeline/extract', requireCurator, async (c) => {
  const { streamId } = await c.req.json<{ streamId: string }>();
  if (!streamId) {
    return c.json({ error: 'streamId is required' }, 400);
  }

  const stream = await getStreamById(c.env.DB, streamId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  // Stage 1: Try comments
  let comments: Awaited<ReturnType<typeof fetchComments>> = [];
  try {
    comments = await fetchComments(apiKey, stream.videoId);
  } catch (err) {
    // If quota exceeded, propagate; otherwise fall through to description
    if (err instanceof Error && err.message.includes('quota')) {
      return c.json({ error: err.message }, 429);
    }
    // Comments disabled or other error — fall through
  }

  const candidate = findCandidateComment(comments);
  const allCandidates = comments
    .filter((cc) => cc.timestampCount >= 3)
    .sort((a, b) => {
      const pd = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
      if (pd !== 0) return pd;
      const ld = b.likes - a.likes;
      if (ld !== 0) return ld;
      return b.timestampCount - a.timestampCount;
    });

  if (candidate) {
    const parsed = parseTextToSongs(candidate.text);
    const credit = {
      author: candidate.author,
      commentUrl: `https://www.youtube.com/watch?v=${stream.videoId}&lc=${candidate.commentId}`,
    };
    return c.json<ExtractResponse>({
      source: 'comment',
      candidateComment: candidate,
      allCandidates,
      parsedSongs: parsed,
      credit,
    });
  }

  // Stage 2: Try video description
  try {
    const details = await getVideoDetails(apiKey, [stream.videoId]);
    const desc = details[0]?.description ?? '';
    const descTimestamps = countTimestamps(desc);

    if (descTimestamps >= 3) {
      const parsed = parseTextToSongs(desc);
      return c.json<ExtractResponse>({
        source: 'description',
        candidateComment: null,
        allCandidates,
        parsedSongs: parsed,
        credit: null,
      });
    }
  } catch {
    // Fall through to "no timestamps found"
  }

  // Stage 3: No timestamps found
  return c.json<ExtractResponse>({
    source: null,
    candidateComment: null,
    allCandidates,
    parsedSongs: [],
    credit: null,
  });
});

// --- Pipeline: Import extracted songs to D1 ---

app.post('/api/pipeline/extract-import', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const body = await c.req.json<ExtractImportBody>();
  if (!body.streamId || !body.songs || body.songs.length === 0) {
    return c.json({ error: 'streamId and songs are required' }, 400);
  }

  const stream = await getStreamById(c.env.DB, body.streamId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const user = c.get('user');

  // Update stream credit if provided
  if (body.credit) {
    await c.env.DB
      .prepare('UPDATE streams SET credit = ? WHERE id = ?')
      .bind(JSON.stringify(body.credit), body.streamId)
      .run();
  }

  const { created } = await bulkCreatePerformances(
    c.env.DB,
    streamerId,
    body.streamId,
    stream.date,
    stream.title,
    stream.videoId,
    body.songs,
    user.email,
    body.replace ?? false,
  );

  return c.json<ExtractImportResponse>({ ok: true, created });
});

// --- Nova submissions (separate D1: NOVA_DB) ---

app.get('/api/nova/submissions', requireCurator, async (c) => {
  const status = c.req.query('status');
  let query = 'SELECT * FROM submissions';
  const binds: string[] = [];
  if (status) {
    query += ' WHERE status = ?';
    binds.push(status);
  }
  query += ' ORDER BY submitted_at DESC';

  const result = await c.env.NOVA_DB
    .prepare(query)
    .bind(...binds)
    .all<NovaSubmission>();

  return c.json({ data: result.results, total: result.results.length });
});

app.get('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = c.req.param('id');
  const result = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();

  if (!result) return c.json({ error: 'Submission not found' }, 404);
  return c.json(result);
});

app.put('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.NOVA_DB
    .prepare('SELECT id FROM submissions WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  const body = await c.req.json<Partial<Omit<NovaSubmission, 'id' | 'status' | 'submitted_at' | 'reviewed_at'>>>();

  const fields: string[] = [];
  const values: string[] = [];
  const editable = [
    'youtube_channel_url', 'slug', 'brand_name', 'display_name', 'description',
    'avatar_url', 'subscriber_count', 'link_youtube', 'link_twitter',
    'link_facebook', 'link_instagram', 'link_twitch', 'reviewer_note',
  ] as const;

  for (const key of editable) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(body[key] as string);
    }
  }

  if (fields.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  values.push(id);
  await c.env.NOVA_DB
    .prepare(`UPDATE submissions SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();

  return c.json(updated);
});

app.patch('/api/nova/submissions/:id/status', requireCurator, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status: NovaStatus; reviewer_note?: string }>();

  const validStatuses = new Set<string>(['approved', 'rejected']);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}. Must be 'approved' or 'rejected'` }, 400);
  }

  const existing = await c.env.NOVA_DB
    .prepare('SELECT id, status FROM submissions WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  await c.env.NOVA_DB
    .prepare('UPDATE submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?')
    .bind(body.status, new Date().toISOString(), body.reviewer_note ?? '', id)
    .run();

  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();

  return c.json(updated);
});

// --- Stats ---

app.get('/api/stats', async (c) => {
  const streamerId = getStreamerId(c);
  const stats = await getDashboardStats(c.env.DB, streamerId);
  return c.json(stats);
});

// Static assets (admin UI) are served automatically by the [assets]
// binding in wrangler.toml for non-API routes.
export default app;

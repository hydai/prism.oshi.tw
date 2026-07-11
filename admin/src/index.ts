import { Hono } from 'hono';
import { requireApiRequestAuthenticity, requireAuth, requireCurator } from './auth';
import { getRouteParam, getStreamerId } from './http';
import { canHardDeleteStream, isValidTransition, shouldImportVod, VALID_STATUSES } from './status';
import {
  listSongs,
  listSongsPaginated,
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
  updateStream,
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
  bulkApproveStream,
  bulkUnapproveStream,
  deleteStreamCascade,
  getStreamDetail,
  updatePerformanceNote,
  importVodToAdminDb,
  getSongSimilarityGroups,
  getArtistSimilarityGroups,
  batchUpdateSongs,
} from './db';
import { fetchItunesDuration } from './itunes';
import { parseTextToSongs } from '../shared/parse';
import { formatSubscriberCount } from '../shared/format';
import { feedbackEmbedForSubmission, feedbackEmbedForVod, postDiscord } from '../shared/discord';
import { sanitizeNovaUrl, type NovaUrlProvider } from '../shared/nova-url-safety';
import { discoverStreams, getVideoDetails, fetchComments, findCandidateComment, countTimestamps, fetchChannelInfo, verifyChannelId } from './youtube';
import {
  downloadVodExportCandidate,
  generateVodExportPreviewApi,
  getVodExportCandidateApi,
  getVodExportRepairRecord,
  normalizeVodExportError,
  vodExportPreviewApiResponse,
} from './vod-export/api';
import {
  getVodExportStatus,
  inspectVodExportControlRecoveryState,
  manuallyRecoverVodExportControl,
  publishVodExportCandidate,
  reconcileVodExportPublication,
  requireExporterBuildId,
} from './vod-export/publication';
import { runVodExportMaintenance } from './vod-export/maintenance';
import type {
  AuthUser,
  CreateSongBody,
  UpdateSongBody,
  CreatePerformanceBody,
  CreateStreamBody,
  StatusUpdateBody,
  CreateStampPerformanceBody,
  UpdateTimestampsBody,
  UpdateStreamBody,
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
  BulkApproveResponse,
  DeleteStreamResponse,
  HarmonizeSongsResponse,
  HarmonizeArtistsResponse,
  HarmonizeApplyBody,
  HarmonizeMatchType,
  NovaSubmission,
  NovaStatus,
  NovaVodSubmission,
  NovaVodSong,
  StreamerInfo,
  CrystalTicket,
  CrystalTicketStatus,
  BulkFetchSubscribersResult,
  BulkFetchSubscribersResponse,
} from '../shared/types';

type Bindings = {
  DB: D1Database;
  NOVA_DB: D1Database;
  CRYSTAL_DB: D1Database;
  CURATOR_EMAILS: string;
  YOUTUBE_API_KEY: string;
  DISCORD_WEBHOOK_FEEDBACK?: string; // optional: feature no-ops when the secret is unset
  VOD_EXPORT_PUBLIC: R2Bucket;
  VOD_EXPORT_PRIVATE: R2Bucket;
  VOD_EXPORT_DB_ID: string;
  VOD_EXPORT_NOVA_DB_ID: string;
  CF_VERSION_METADATA: WorkerVersionMetadata;
};

type Variables = {
  user: AuthUser;
};

type NovaUpdateBody = Partial<Omit<
  NovaSubmission,
  | 'id'
  | 'status'
  | 'submitted_at'
  | 'reviewed_at'
  | 'youtube_channel_verified_id'
  | 'youtube_channel_verified_at'
>>;

const novaUrlFields = [
  ['youtube_channel_url', 'youtube'],
  ['avatar_url', 'image'],
  ['link_youtube', 'youtube'],
  ['link_twitter', 'twitter'],
  ['link_facebook', 'facebook'],
  ['link_instagram', 'instagram'],
  ['link_twitch', 'twitch'],
] as const satisfies ReadonlyArray<readonly [keyof NovaUpdateBody, NovaUrlProvider]>;

function validateNovaUrlUpdates(body: NovaUpdateBody): string | null {
  for (const [field, provider] of novaUrlFields) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      return `Invalid ${field}: expected a URL string`;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      body[field] = '';
      continue;
    }

    const safeUrl = sanitizeNovaUrl(trimmed, provider);
    if (!safeUrl) {
      return `Invalid ${field}: URL must use HTTPS and an allowed ${provider} host`;
    }

    body[field] = safeUrl;
  }

  return null;
}

function isNovaUpdateBody(value: unknown): value is NovaUpdateBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCurrentChannelVerification(value: {
  youtube_channel_id: string;
  youtube_channel_verified_id: string | null;
  youtube_channel_verified_at: string | null;
}): boolean {
  if (
    value.youtube_channel_verified_id !== value.youtube_channel_id
    || value.youtube_channel_verified_at === null
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.youtube_channel_verified_at)
  ) return false;
  const parsed = Date.parse(value.youtube_channel_verified_at);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value.youtube_channel_verified_at;
}

function vodExportErrorResponse(error: unknown): Response {
  const normalized = normalizeVodExportError(error);
  return new Response(JSON.stringify(normalized.body), {
    status: normalized.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All routes require authentication, and state-changing requests must carry an
// app-issued authenticity header (CSRF defense). See admin/shared/csrf.ts.
app.use('/api/*', requireAuth);
app.use('/api/*', requireApiRequestAuthenticity);

// --- Auth info ---

app.get('/api/me', async (c) => {
  return c.json(c.get('user'));
});

// --- Streamers (from NOVA DB) ---

app.get('/api/streamers', async (c) => {
  const result = await c.env.NOVA_DB
    .prepare('SELECT slug, display_name FROM submissions WHERE status = ? AND enabled = 1 ORDER BY display_order ASC')
    .bind('approved')
    .all<{ slug: string; display_name: string }>();

  const data: StreamerInfo[] = result.results.map((r) => ({
    slug: r.slug,
    displayName: r.display_name,
  }));

  return c.json({ data });
});

// --- Songs ---

app.get('/api/songs', async (c) => {
  const streamerId = getStreamerId(c);
  const status = c.req.query('status');
  const search = c.req.query('search');
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = parseInt(c.req.query('pageSize') || '50', 10);
  const sortBy = c.req.query('sortBy');
  const sortDir = c.req.query('sortDir') as 'asc' | 'desc' | undefined;

  const { songs, total } = await listSongsPaginated(c.env.DB, streamerId, {
    status,
    search,
    page,
    pageSize,
    sortBy,
    sortDir,
  });

  const totalPages = Math.ceil(total / pageSize);
  return c.json({ data: songs, total, page, pageSize, totalPages });
});

app.get('/api/songs/:id', async (c) => {
  const song = await getSongById(c.env.DB, getRouteParam(c, 'id'));
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
  const id = getRouteParam(c, 'id');
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
  const id = getRouteParam(c, 'id');
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
  const id = getRouteParam(c, 'id');
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
  const search = c.req.query('search');
  const streams = await listStreams(c.env.DB, streamerId, status, search);
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
  const id = getRouteParam(c, 'id');
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

app.patch('/api/streams/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<UpdateStreamBody>();

  if (!body.title && !body.date && !body.videoId && !body.youtubeUrl) {
    return c.json({ error: 'At least one field (title, date, videoId, youtubeUrl) is required' }, 400);
  }

  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400);
  }

  const existing = await getStreamById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Stream not found' }, 404);

  const updated = await updateStream(c.env.DB, id, {
    title: body.title,
    date: body.date,
    videoId: body.videoId,
    youtubeUrl: body.youtubeUrl,
  });

  return c.json(updated);
});

// --- Stamp editor ---

app.get('/api/streams/:streamId/performances', async (c) => {
  const streamId = getRouteParam(c, 'streamId');
  const performances = await listPerformancesForStream(c.env.DB, streamId);
  return c.json({ data: performances, total: performances.length });
});

app.post('/api/streams/:streamId/performances', async (c) => {
  const streamerId = getStreamerId(c);
  const streamId = getRouteParam(c, 'streamId');
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

// Bulk approve all pending songs + performances for a stream
app.post('/api/streams/:streamId/approve-all', requireCurator, async (c) => {
  const streamId = getRouteParam(c, 'streamId');
  const stream = await getStreamById(c.env.DB, streamId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const user = c.get('user');
  const { songs, performances } = await bulkApproveStream(c.env.DB, streamId, user.email);
  return c.json({ ok: true, songs, performances } satisfies BulkApproveResponse);
});

// Bulk unapprove all approved songs + performances for a stream
app.post('/api/streams/:streamId/unapprove-all', requireCurator, async (c) => {
  const streamId = getRouteParam(c, 'streamId');
  const stream = await getStreamById(c.env.DB, streamId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const { songs, performances } = await bulkUnapproveStream(c.env.DB, streamId);
  return c.json({ ok: true, songs, performances } satisfies BulkApproveResponse);
});

// Hard-delete a stream with all its performances and orphaned songs.
// Approved (live) streams are blocked — unapprove first.
app.delete('/api/streams/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const stream = await getStreamById(c.env.DB, id);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  if (!canHardDeleteStream(stream.status)) {
    return c.json({ error: 'Cannot delete an approved stream — unapprove it first' }, 409);
  }

  const { songs, performances } = await deleteStreamCascade(c.env.DB, id);
  return c.json({ ok: true, songs, performances } satisfies DeleteStreamResponse);
});

app.patch('/api/performances/:id/timestamps', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<UpdateTimestampsBody>();
  const updated = await updatePerformanceTimestamps(c.env.DB, id, {
    timestamp: body.timestamp,
    endTimestamp: body.endTimestamp,
  });
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

app.patch('/api/performances/:id/details', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<UpdateSongDetailsBody>();
  const updated = await updatePerformanceSongDetails(c.env.DB, id, {
    title: body.title,
    originalArtist: body.originalArtist,
  });
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

app.delete('/api/performances/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
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
  const streamId = getRouteParam(c, 'streamId');
  const detail = await getStreamDetail(c.env.DB, streamId);
  if (!detail) return c.json({ error: 'Stream not found' }, 404);
  return c.json(detail);
});

// --- Performance note update ---

app.patch('/api/performances/:id/note', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ note: string }>();
  if (body.note === undefined) {
    return c.json({ error: 'note is required' }, 400);
  }
  const updated = await updatePerformanceNote(c.env.DB, id, body.note);
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

// --- Stamp: paste import ---

app.post('/api/streams/:streamId/paste-import', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const streamId = getRouteParam(c, 'streamId');
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

app.delete('/api/streams/:streamId/end-timestamps', requireCurator, async (c) => {
  const streamId = getRouteParam(c, 'streamId');
  const cleared = await clearAllEndTimestamps(c.env.DB, streamId);
  return c.json({ ok: true, cleared });
});

// --- Stamp: fetch duration from iTunes ---

app.post('/api/performances/:id/fetch-duration', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
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

// --- VOD snapshot publication workflow (all operations remain curator-only) ---

app.use('/api/vod-export/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
});

app.get('/api/vod-export/status', requireCurator, async (c) => {
  try {
    const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
    return c.json(await getVodExportStatus(c.env, buildId));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.post('/api/vod-export/preview', requireCurator, async (c) => {
  try {
    const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
    return vodExportPreviewApiResponse(await generateVodExportPreviewApi(c.env, buildId));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.get('/api/vod-export/candidates/:id/download', requireCurator, async (c) => {
  try {
    return await downloadVodExportCandidate(c.env, getRouteParam(c, 'id'));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.get('/api/vod-export/candidates/:id', requireCurator, async (c) => {
  try {
    const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
    return vodExportPreviewApiResponse(
      await getVodExportCandidateApi(c.env, getRouteParam(c, 'id'), buildId),
    );
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.get('/api/vod-export/repair/:entity/:rowId', requireCurator, async (c) => {
  try {
    const entity = getRouteParam(c, 'entity');
    if (entity !== 'performance' && entity !== 'song' && entity !== 'vod' && entity !== 'streamer') {
      return c.json({ error: 'Repair record not found', code: 'VOD_EXPORT_REPAIR_RECORD_NOT_FOUND' }, 404);
    }
    const rowIdText = getRouteParam(c, 'rowId');
    if (!/^[1-9][0-9]*$/.test(rowIdText)) {
      return c.json({ error: 'Repair record not found', code: 'VOD_EXPORT_REPAIR_RECORD_NOT_FOUND' }, 404);
    }
    return c.json(await getVodExportRepairRecord(c.env, entity, Number(rowIdText)));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.post('/api/vod-export/candidates/:id/publish', requireCurator, async (c) => {
  try {
    const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
    const result = await publishVodExportCandidate(
      c.env,
      getRouteParam(c, 'id'),
      buildId,
      c.get('user').email,
    );
    return c.json(result);
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.post('/api/vod-export/reconcile', requireCurator, async (c) => {
  try {
    return c.json(await reconcileVodExportPublication(c.env));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.get('/api/vod-export/control-recovery', requireCurator, async (c) => {
  try {
    return c.json(await inspectVodExportControlRecoveryState(c.env.VOD_EXPORT_PRIVATE));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.post('/api/vod-export/control-recovery', requireCurator, async (c) => {
  try {
    const body = await c.req.json<unknown>().catch(() => null);
    return c.json(await manuallyRecoverVodExportControl(
      c.env,
      body,
      c.get('user').email,
    ));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

app.post('/api/vod-export/maintenance', requireCurator, async (c) => {
  try {
    return c.json(await runVodExportMaintenance(c.env));
  } catch (error) {
    return vodExportErrorResponse(error);
  }
});

// --- Pipeline: Discover streams from YouTube ---

app.post('/api/pipeline/discover', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured. Add it to .dev.vars for local dev or use wrangler secret put for production.' }, 500);
  }

  const row = await c.env.NOVA_DB
    .prepare('SELECT youtube_channel_id FROM submissions WHERE slug = ? AND status = ?')
    .bind(streamerId, 'approved')
    .first<{ youtube_channel_id: string }>();
  const channelId = row?.youtube_channel_id;
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
      if (await videoIdExists(c.env.DB, v.videoId, streamerId)) {
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

  const existingPerfs = await listPerformancesForStream(c.env.DB, body.streamId);
  if (existingPerfs.length > 0 && !body.replace) {
    return c.json({
      error: `This stream already has ${existingPerfs.length} song(s) imported. Use replace mode to overwrite.`,
      existingCount: existingPerfs.length,
    }, 409);
  }

  const user = c.get('user');

  // Update stream credit if provided
  if (body.credit) {
    await c.env.DB
      .prepare("UPDATE streams SET credit = ?, updated_at = datetime('now') WHERE id = ?")
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

// --- Harmonizer ---

app.get('/api/harmonize/songs', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const mode = (c.req.query('mode') || 'exact') as HarmonizeMatchType;
  const threshold = parseFloat(c.req.query('threshold') || '0.85');

  const groups = await getSongSimilarityGroups(c.env.DB, streamerId, mode, threshold);
  const affectedSongs = groups.reduce((sum, g) => sum + g.items.length, 0);

  return c.json<HarmonizeSongsResponse>({
    groups,
    stats: {
      totalSongs: affectedSongs,
      groupCount: groups.length,
      affectedSongs,
    },
  });
});

app.get('/api/harmonize/artists', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const mode = (c.req.query('mode') || 'exact') as HarmonizeMatchType;
  const threshold = parseFloat(c.req.query('threshold') || '0.85');

  const groups = await getArtistSimilarityGroups(c.env.DB, streamerId, mode, threshold);
  const affectedEntries = groups.reduce((sum, g) => sum + g.items.length, 0);

  return c.json<HarmonizeArtistsResponse>({
    groups,
    stats: {
      totalArtists: affectedEntries,
      groupCount: groups.length,
      affectedEntries,
    },
  });
});

app.post('/api/harmonize/apply', requireCurator, async (c) => {
  const body = await c.req.json<HarmonizeApplyBody>();
  if (!body.updates || body.updates.length === 0) {
    return c.json({ error: 'updates array is required' }, 400);
  }

  const updated = await batchUpdateSongs(c.env.DB, body.updates);
  return c.json({ ok: true, updated });
});

// --- Nova submissions (separate D1: NOVA_DB) ---

app.get('/api/nova/submissions', requireCurator, async (c) => {
  const status = c.req.query('status');
  const search = c.req.query('search');
  let query = 'SELECT * FROM submissions';
  const conditions: string[] = [];
  const binds: string[] = [];
  if (status) {
    conditions.push('status = ?');
    binds.push(status);
  }
  if (search) {
    conditions.push('(id LIKE ? OR slug LIKE ? OR display_name LIKE ? OR youtube_channel_id LIKE ?)');
    const pattern = `%${search}%`;
    binds.push(pattern, pattern, pattern, pattern);
  }
  if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY submitted_at DESC';

  const result = await c.env.NOVA_DB
    .prepare(query)
    .bind(...binds)
    .all<NovaSubmission>();

  return c.json({ data: result.results, total: result.results.length });
});

// POST /api/nova/submissions/fetch-all-subscribers — bulk fetch for all approved streamers
// Must be registered before /:id routes to avoid Hono matching "fetch-all-subscribers" as :id
app.post('/api/nova/submissions/fetch-all-subscribers', requireCurator, async (c) => {
  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  const { results: subs } = await c.env.NOVA_DB
    .prepare("SELECT id, display_name, youtube_channel_id FROM submissions WHERE status = 'approved' AND youtube_channel_id != ''")
    .all<{ id: string; display_name: string; youtube_channel_id: string }>();

  const results: BulkFetchSubscribersResult[] = [];
  let updated = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      const info = await fetchChannelInfo(apiKey, sub.youtube_channel_id);
      if (info === null) {
        results.push({ id: sub.id, display_name: sub.display_name, subscriber_count: null, avatar_url: null, error: 'Hidden or not found' });
        failed++;
        continue;
      }
      if (info.channelId !== sub.youtube_channel_id) {
        results.push({ id: sub.id, display_name: sub.display_name, subscriber_count: null, avatar_url: null, error: 'Channel identity mismatch' });
        failed++;
        continue;
      }
      const formatted = formatSubscriberCount(info.subscriberCount);
      const verifiedAt = new Date().toISOString();
      const update = await c.env.NOVA_DB
        .prepare(`
          UPDATE submissions
          SET subscriber_count = ?, avatar_url = ?,
              youtube_channel_verified_id = ?, youtube_channel_verified_at = ?
          WHERE id = ? AND youtube_channel_id = ?
        `)
        .bind(formatted, info.avatarUrl, info.channelId, verifiedAt, sub.id, sub.youtube_channel_id)
        .run();
      if ((update.meta.changes ?? 0) !== 1) {
        results.push({ id: sub.id, display_name: sub.display_name, subscriber_count: null, avatar_url: null, error: 'Channel ID changed during refresh' });
        failed++;
        continue;
      }
      results.push({ id: sub.id, display_name: sub.display_name, subscriber_count: formatted, avatar_url: info.avatarUrl });
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      results.push({ id: sub.id, display_name: sub.display_name, subscriber_count: null, avatar_url: null, error: msg });
      failed++;
    }
  }

  return c.json<BulkFetchSubscribersResponse>({ updated, failed, results });
});

// POST /api/nova/submissions/:id/verify-youtube-channel — verify an existing
// migrated ID without requiring a meaningless edit to that opaque value.
app.post('/api/nova/submissions/:id/verify-youtube-channel', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const sub = await c.env.NOVA_DB
    .prepare('SELECT id, youtube_channel_id FROM submissions WHERE id = ?')
    .bind(id)
    .first<{ id: string; youtube_channel_id: string }>();
  if (!sub) return c.json({ error: 'Submission not found' }, 404);
  if (!sub.youtube_channel_id || sub.youtube_channel_id.trim().length === 0) {
    return c.json({ error: 'Set a YouTube channel ID before verification' }, 400);
  }
  if (!c.env.YOUTUBE_API_KEY) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured for channel verification' }, 503);
  }

  let verifiedId: string | null;
  try {
    verifiedId = await verifyChannelId(c.env.YOUTUBE_API_KEY, sub.youtube_channel_id);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'nova_youtube_channel_verification_failed',
      submissionId: id,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
    return c.json({ error: 'YouTube channel verification is temporarily unavailable' }, 502);
  }
  if (verifiedId !== sub.youtube_channel_id) {
    return c.json({ error: 'YouTube did not return the exact requested channel ID' }, 400);
  }

  const verifiedAt = new Date().toISOString();
  const result = await c.env.NOVA_DB
    .prepare(`
      UPDATE submissions
      SET youtube_channel_verified_id = ?, youtube_channel_verified_at = ?
      WHERE id = ? AND youtube_channel_id = ?
    `)
    .bind(verifiedId, verifiedAt, id, sub.youtube_channel_id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    return c.json({ error: 'YouTube channel ID changed during verification; retry the operation' }, 409);
  }
  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();
  return c.json(updated);
});

app.get('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const result = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();

  if (!result) return c.json({ error: 'Submission not found' }, 404);
  return c.json(result);
});

app.put('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const existing = await c.env.NOVA_DB
    .prepare(`
      SELECT id, youtube_channel_id, youtube_channel_verified_id,
             youtube_channel_verified_at
      FROM submissions
      WHERE id = ?
    `)
    .bind(id)
    .first<{
      id: string;
      youtube_channel_id: string;
      youtube_channel_verified_id: string | null;
      youtube_channel_verified_at: string | null;
    }>();
  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  const parsedBody = await c.req.json<unknown>();
  if (!isNovaUpdateBody(parsedBody)) {
    return c.json({ error: 'Request body must be an object' }, 400);
  }

  const body = parsedBody;
  const urlError = validateNovaUrlUpdates(body);
  if (urlError) {
    return c.json({ error: urlError }, 400);
  }

  let verifiedChannelId: string | null | undefined;
  let channelVerifiedAt: string | null | undefined;
  if (body.youtube_channel_id !== undefined) {
    if (typeof body.youtube_channel_id !== 'string') {
      return c.json({ error: 'youtube_channel_id must be a string' }, 400);
    }
    if (body.youtube_channel_id.trim().length === 0) {
      body.youtube_channel_id = '';
      verifiedChannelId = null;
      channelVerifiedAt = null;
    } else {
      const verificationIsCurrent = body.youtube_channel_id === existing.youtube_channel_id
        && hasCurrentChannelVerification(existing);
      if (!verificationIsCurrent) {
        if (!c.env.YOUTUBE_API_KEY) {
          return c.json({ error: 'YOUTUBE_API_KEY not configured for channel verification' }, 503);
        }
        try {
          verifiedChannelId = await verifyChannelId(c.env.YOUTUBE_API_KEY, body.youtube_channel_id);
        } catch (error) {
          console.error(JSON.stringify({
            event: 'nova_youtube_channel_verification_failed',
            submissionId: id,
            error: error instanceof Error ? error.message : 'Unknown error',
          }));
          return c.json({ error: 'YouTube channel verification is temporarily unavailable' }, 502);
        }
        if (verifiedChannelId !== body.youtube_channel_id) {
          return c.json({ error: 'YouTube did not return the exact requested channel ID' }, 400);
        }
        channelVerifiedAt = new Date().toISOString();
      }
    }
  }

  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  const editable = [
    'youtube_channel_url', 'youtube_channel_id', 'slug', 'brand_name', 'display_name', 'description',
    'avatar_url', 'subscriber_count', 'link_youtube', 'link_twitter',
    'link_facebook', 'link_instagram', 'link_twitch', 'reviewer_note',
    'group', 'theme_json', 'enabled', 'display_order', 'external_url',
  ] as const;

  for (const key of editable) {
    if (body[key] !== undefined) {
      // Quote column name to handle SQL reserved words like "group"
      fields.push(`"${key}" = ?`);
      values.push(body[key] as string | number);
    }
  }

  // Keep normalized URL in sync when youtube_channel_url changes
  if (body.youtube_channel_url !== undefined) {
    fields.push('"youtube_channel_url_normalized" = ?');
    values.push(body.youtube_channel_url.trim().toLowerCase());
  }

  if (verifiedChannelId !== undefined && channelVerifiedAt !== undefined) {
    fields.push('"youtube_channel_verified_id" = ?', '"youtube_channel_verified_at" = ?');
    values.push(verifiedChannelId, channelVerifiedAt);
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
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ status: NovaStatus; reviewer_note?: string }>();

  const validStatuses = new Set<string>(['approved', 'rejected', 'pending']);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}. Must be 'approved', 'rejected', or 'pending'` }, 400);
  }

  const existing = await c.env.NOVA_DB
    .prepare('SELECT id, status FROM submissions WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  const reviewedAt = body.status === 'pending' ? null : new Date().toISOString();
  const reviewerNote = body.status === 'pending' ? null : (body.reviewer_note ?? '');

  await c.env.NOVA_DB
    .prepare('UPDATE submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?')
    .bind(body.status, reviewedAt, reviewerNote, id)
    .run();

  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();

  const feedbackEmbed = updated ? feedbackEmbedForSubmission(existing.status, body.status, updated) : null;
  if (feedbackEmbed) {
    c.executionCtx.waitUntil(
      postDiscord(c.env.DISCORD_WEBHOOK_FEEDBACK, [feedbackEmbed]).catch((err) =>
        console.error('discord feedback notify failed', err),
      ),
    );
  }

  return c.json(updated);
});

// DELETE /api/nova/submissions/:id — permanently delete a streamer submission
app.delete('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const existing = await c.env.NOVA_DB
    .prepare('SELECT id FROM submissions WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  await c.env.NOVA_DB
    .prepare('DELETE FROM submissions WHERE id = ?')
    .bind(id)
    .run();

  return c.json({ ok: true });
});

// POST /api/nova/submissions/:id/fetch-subscribers — fetch subscriber count from YouTube
app.post('/api/nova/submissions/:id/fetch-subscribers', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');

  const sub = await c.env.NOVA_DB
    .prepare('SELECT id, youtube_channel_id FROM submissions WHERE id = ?')
    .bind(id)
    .first<{ id: string; youtube_channel_id: string }>();
  if (!sub) return c.json({ error: 'Submission not found' }, 404);
  if (!sub.youtube_channel_id) {
    return c.json({ error: 'No youtube_channel_id set for this submission. Please add a channel ID first.' }, 400);
  }

  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  let info: Awaited<ReturnType<typeof fetchChannelInfo>>;
  try {
    info = await fetchChannelInfo(apiKey, sub.youtube_channel_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown YouTube API error';
    return c.json({ error: msg }, 502);
  }

  if (info === null) {
    return c.json({ error: 'Subscriber count is hidden or channel not found' }, 404);
  }
  if (info.channelId !== sub.youtube_channel_id) {
    return c.json({ error: 'YouTube returned a different channel identity' }, 409);
  }

  const formatted = formatSubscriberCount(info.subscriberCount);
  const verifiedAt = new Date().toISOString();

  const update = await c.env.NOVA_DB
    .prepare(`
      UPDATE submissions
      SET subscriber_count = ?, avatar_url = ?,
          youtube_channel_verified_id = ?, youtube_channel_verified_at = ?
      WHERE id = ? AND youtube_channel_id = ?
    `)
    .bind(formatted, info.avatarUrl, info.channelId, verifiedAt, id, sub.youtube_channel_id)
    .run();
  if ((update.meta.changes ?? 0) !== 1) {
    return c.json({ error: 'YouTube channel ID changed during refresh; retry the operation' }, 409);
  }

  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmission>();

  return c.json(updated);
});

// --- Nova VOD submissions (NOVA_DB) ---

app.get('/api/nova/vods', requireCurator, async (c) => {
  const status = c.req.query('status');
  const streamer = c.req.query('streamer');

  let query = 'SELECT * FROM vod_submissions';
  const conditions: string[] = [];
  const binds: string[] = [];

  if (status) {
    conditions.push('status = ?');
    binds.push(status);
  }
  if (streamer) {
    conditions.push('streamer_slug = ?');
    binds.push(streamer);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY submitted_at DESC';

  const result = await c.env.NOVA_DB
    .prepare(query)
    .bind(...binds)
    .all<NovaVodSubmission>();

  return c.json({ data: result.results, total: result.results.length });
});

app.get('/api/nova/vods/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const vod = await c.env.NOVA_DB
    .prepare('SELECT * FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first<NovaVodSubmission>();

  if (!vod) return c.json({ error: 'VOD submission not found' }, 404);

  const { results: songs } = await c.env.NOVA_DB
    .prepare('SELECT * FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order ASC')
    .bind(id)
    .all<NovaVodSong>();

  return c.json({ ...vod, songs: songs ?? [] });
});

app.patch('/api/nova/vods/:id/status', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ status: NovaStatus; reviewer_note?: string }>();

  const validStatuses = new Set<string>(['approved', 'rejected', 'pending']);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}. Must be 'approved', 'rejected', or 'pending'` }, 400);
  }

  const existing = await c.env.NOVA_DB
    .prepare('SELECT id, status FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!existing) return c.json({ error: 'VOD submission not found' }, 404);

  const reviewedAt = body.status === 'pending' ? null : new Date().toISOString();
  const reviewerNote = body.status === 'pending' ? null : (body.reviewer_note ?? '');

  await c.env.NOVA_DB
    .prepare('UPDATE vod_submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?')
    .bind(body.status, reviewedAt, reviewerNote, id)
    .run();

  // Fetch the full updated row once and reuse it for the import gate, the Discord embed,
  // and the response — avoids a second identical SELECT * on vod_submissions.
  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first<NovaVodSubmission>();

  // Import VOD songs into the admin DB as pending records when approved. The gate is
  // shouldImportVod, keyed on whether the video already exists in the admin DB
  // (videoIdExists) rather than the Nova status transition: that keeps a failed import
  // retryable (absent → import) while a re-approve of an already-imported VOD won't
  // delete/recreate its curated performances (present → skip). importVodToAdminDb writes
  // via an atomic db.batch(), so a failed import leaves no admin rows and the next retry
  // re-imports cleanly. vod_songs is fetched only once we know we're importing, so a
  // re-approval (common under this existence gate) costs no extra NOVA_DB read.
  if (body.status === 'approved' && updated) {
    if (shouldImportVod(body.status, await videoIdExists(c.env.DB, updated.video_id, updated.streamer_slug))) {
      const { results: vodSongs } = await c.env.NOVA_DB
        .prepare('SELECT * FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order')
        .bind(id)
        .all<NovaVodSong>();

      if (vodSongs.length > 0) {
        const user = c.get('user');
        await importVodToAdminDb(c.env.DB, updated, vodSongs, user.email);
      }
    }
  }

  const feedbackEmbed = updated ? feedbackEmbedForVod(existing.status, body.status, updated) : null;
  if (feedbackEmbed) {
    c.executionCtx.waitUntil(
      postDiscord(c.env.DISCORD_WEBHOOK_FEEDBACK, [feedbackEmbed]).catch((err) =>
        console.error('discord feedback notify failed', err),
      ),
    );
  }

  return c.json(updated);
});

app.put('/api/nova/vods/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const existing = await c.env.NOVA_DB
    .prepare('SELECT id FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'VOD submission not found' }, 404);

  const body = await c.req.json<Partial<Pick<NovaVodSubmission, 'stream_title' | 'stream_date' | 'submitter_note' | 'reviewer_note'>>>();

  const fields: string[] = [];
  const values: string[] = [];
  const editable = ['stream_title', 'stream_date', 'submitter_note', 'reviewer_note'] as const;

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
    .prepare(`UPDATE vod_submissions SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.NOVA_DB
    .prepare('SELECT * FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first<NovaVodSubmission>();

  return c.json(updated);
});

// DELETE /api/nova/vods/:id — permanently delete a VOD submission (cascades to vod_songs)
app.delete('/api/nova/vods/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const existing = await c.env.NOVA_DB
    .prepare('SELECT id FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) return c.json({ error: 'VOD submission not found' }, 404);

  await c.env.NOVA_DB
    .prepare('DELETE FROM vod_submissions WHERE id = ?')
    .bind(id)
    .run();

  return c.json({ ok: true });
});

// --- Crystal tickets (separate D1: CRYSTAL_DB) ---

app.get('/api/crystal/tickets', requireCurator, async (c) => {
  const status = c.req.query('status');
  const type = c.req.query('type');

  let query = 'SELECT * FROM tickets';
  const conditions: string[] = [];
  const binds: string[] = [];

  if (status) {
    conditions.push('status = ?');
    binds.push(status);
  }
  if (type) {
    conditions.push('type = ?');
    binds.push(type);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY submitted_at DESC';

  const result = await c.env.CRYSTAL_DB
    .prepare(query)
    .bind(...binds)
    .all<CrystalTicket>();

  return c.json({ data: result.results, total: result.results.length });
});

app.get('/api/crystal/tickets/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const result = await c.env.CRYSTAL_DB
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(id)
    .first<CrystalTicket>();

  if (!result) return c.json({ error: 'Ticket not found' }, 404);
  return c.json(result);
});

app.post('/api/crystal/tickets/:id/reply', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ admin_reply: string }>();

  if (!body.admin_reply || !body.admin_reply.trim()) {
    return c.json({ error: 'admin_reply is required' }, 400);
  }

  const existing = await c.env.CRYSTAL_DB
    .prepare('SELECT id FROM tickets WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) return c.json({ error: 'Ticket not found' }, 404);

  await c.env.CRYSTAL_DB
    .prepare('UPDATE tickets SET admin_reply = ?, status = ?, replied_at = ? WHERE id = ?')
    .bind(body.admin_reply.trim(), 'replied', new Date().toISOString(), id)
    .run();

  const updated = await c.env.CRYSTAL_DB
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(id)
    .first<CrystalTicket>();

  return c.json(updated);
});

app.patch('/api/crystal/tickets/:id/status', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ status: CrystalTicketStatus }>();

  const validStatuses = new Set<string>(['pending', 'replied', 'closed']);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}` }, 400);
  }

  const existing = await c.env.CRYSTAL_DB
    .prepare('SELECT id FROM tickets WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) return c.json({ error: 'Ticket not found' }, 404);

  const updates: string[] = ['status = ?'];
  const values: string[] = [body.status];

  if (body.status === 'closed') {
    updates.push('closed_at = ?');
    values.push(new Date().toISOString());
  }

  values.push(id);
  await c.env.CRYSTAL_DB
    .prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.CRYSTAL_DB
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(id)
    .first<CrystalTicket>();

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

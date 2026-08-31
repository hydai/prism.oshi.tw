import { Hono, type Context } from 'hono';
import { requireApiRequestAuthenticity, requireAuth, requireCurator } from './auth';
import { getRouteParam, getStreamerId } from './http';
import { canHardDeleteStream, isValidTransition, shouldImportVod, VALID_STATUSES } from './status';
import {
  listSongsPaginated,
  listGlobalWorksPaginated,
  getSongById,
  songBelongsToStreamer,
  insertSong,
  updateSong,
  updateSongStatus,
  generateSongId,
  listPerformances,
  insertPerformance,
  insertPerformances,
  type PerformanceInsert,
  getPerformanceStatus as db_getPerformanceStatus,
  updatePerformanceStatus,
  generatePerformanceId,
  listStreams,
  getStreamById,
  insertStream,
  insertStreams,
  type StreamInsert,
  findExistingStreamImportKeys,
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
  appendStreamPerformances,
  replaceStreamPerformances,
  bulkApproveStream,
  bulkUnapproveStream,
  deleteStreamCascade,
  getStreamDetail,
  updatePerformanceNote,
  importVodToAdminDb,
  getSongSimilarityGroups,
  getArtistSimilarityGroups,
  batchUpdateSongs,
  mergeSongs,
  SongMergeError,
} from './db';
import { fetchItunesDuration } from './itunes';
import { parseTextToSongs } from '../shared/parse';
import { formatSubscriberCount } from '../shared/format';
import { feedbackEmbedForSubmission, feedbackEmbedForVod, postDiscord } from '../shared/discord';
import type { DiscordEmbed } from '../shared/discord';
import { sanitizeNovaUrl, type NovaUrlProvider } from '../shared/nova-url-safety';
import { discoverStreams, getVideoDetails, fetchComments, findCandidateComment, countTimestamps, fetchChannelInfo, verifyChannelId } from './youtube';
import { refreshSubscriberCounts } from './subscriber-refresh';
import {
  listSubmissions,
  getSubmissionById,
  getSubmissionForUpdate,
  getSubmissionChannelId,
  getSubmissionStatus,
  submissionExists,
  deleteSubmission,
  NOVA_SUBMISSION_EDITABLE_FIELDS,
  type NovaEditableField,
  updateSubmissionFields,
  updateSubmissionStatus,
  updateSubmissionVerification,
  updateSubmissionSubscriberInfo,
  listApprovedSubmissionsWithChannel,
  listVods,
  getVodById,
  getVodStatus,
  vodExists,
  deleteVod,
  listVodSongs,
  updateVodStatus,
  updateVodFields,
} from './nova-db';
import {
  listTickets,
  getTicketById,
  ticketExists,
  replyToTicket,
  updateTicketStatus,
} from './crystal-db';
import { NOVA_STATUSES, CRYSTAL_TICKET_STATUSES } from '../shared/types';
import {
  parseCreateSongBody,
  parseUpdateSongBody,
  parseCreatePerformanceBody,
  parseUpdateTimestampsBody,
  parseUpdateSongDetailsBody,
  parseNoteBody,
  parseCreateStreamBody,
  parseUpdateStreamBody,
  parseImportStreamsBody,
  parseNovaSubmissionUpdateBody,
  type NovaSubmissionUpdateFields,
  parseNovaVodUpdateBody,
  parseCrystalReplyBody,
} from './parse';
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
import {
  listWorkMatchCandidates,
  mergeWorkMatchCandidate,
  reviewWorkMatchCandidate,
  WorkMatchError,
} from './work-review';
import type {
  AuthUser,
  StatusUpdateBody,
  CreateStampPerformanceBody,
  FetchDurationResponse,
  PasteImportBody,
  PasteImportResponse,
  DiscoverStreamsResponse,
  DiscoveredStream,
  ImportStreamsResponse,
  ExtractResponse,
  ExtractImportBody,
  ExtractImportResponse,
  BulkApproveResponse,
  DeleteStreamResponse,
  HarmonizeSongsResponse,
  HarmonizeArtistsResponse,
  HarmonizeApplyBody,
  HarmonizeMergeBody,
  HarmonizeMergeResponse,
  HarmonizeMatchType,
  NovaSubmission,
  NovaStatus,
  StreamerInfo,
  CrystalTicketStatus,
  BulkFetchSubscribersResponse,
  GlobalWorksResponse,
  WorkMatchCandidatesResponse,
  WorkMatchFilter,
  WorkMatchMergeBody,
  WorkMatchReviewBody,
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

const novaUrlFields = [
  ['youtube_channel_url', 'youtube'],
  ['avatar_url', 'image'],
  ['link_youtube', 'youtube'],
  ['link_twitter', 'twitter'],
  ['link_facebook', 'facebook'],
  ['link_instagram', 'instagram'],
  ['link_twitch', 'twitch'],
] as const satisfies ReadonlyArray<readonly [keyof NovaSubmissionUpdateFields, NovaUrlProvider]>;

function validateNovaUrlUpdates(body: NovaSubmissionUpdateFields): string | null {
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

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHarmonizeMergeBody(value: unknown): HarmonizeMergeBody | null {
  if (!isUnknownRecord(value)) return null;
  const body = value;
  if (
    typeof body.canonicalSongId !== 'string'
    || body.canonicalSongId.trim().length === 0
    || !Array.isArray(body.sourceSongIds)
    || body.sourceSongIds.length === 0
    || !body.sourceSongIds.every(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    )
    || 'mergeGlobalWorks' in body
  ) return null;

  let workMergeConfirmation: HarmonizeMergeBody['workMergeConfirmation'];
  if (body.workMergeConfirmation !== undefined) {
    if (!isUnknownRecord(body.workMergeConfirmation)) return null;
    const confirmation = body.workMergeConfirmation;
    if (
      typeof confirmation.canonicalWorkId !== 'string'
      || confirmation.canonicalWorkId.trim().length === 0
      || !Array.isArray(confirmation.sourceWorkIds)
      || confirmation.sourceWorkIds.length === 0
      || !confirmation.sourceWorkIds.every(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      )
    ) return null;

    const canonicalWorkId = confirmation.canonicalWorkId.trim();
    const sourceWorkIds = confirmation.sourceWorkIds.map((id) => id.trim());
    if (
      new Set(sourceWorkIds).size !== sourceWorkIds.length
      || sourceWorkIds.includes(canonicalWorkId)
    ) return null;

    workMergeConfirmation = { canonicalWorkId, sourceWorkIds };
  }

  return {
    canonicalSongId: body.canonicalSongId.trim(),
    sourceSongIds: body.sourceSongIds.map((id) => id.trim()),
    ...(workMergeConfirmation === undefined ? {} : { workMergeConfirmation }),
  };
}

function parseWorkMatchReviewBody(value: unknown): WorkMatchReviewBody | null {
  if (!isUnknownRecord(value)) return null;
  if (
    typeof value.candidateKey !== 'string'
    || typeof value.fingerprint !== 'string'
    || !Array.isArray(value.workIds)
    || value.workIds.length < 2
    || !value.workIds.every((id): id is string => typeof id === 'string' && id.trim().length > 0)
    || (value.decision !== 'not_duplicate' && value.decision !== 'needs_research')
    || (value.expectedReviewVersion !== null && (
      typeof value.expectedReviewVersion !== 'number'
      || !Number.isSafeInteger(value.expectedReviewVersion)
      || value.expectedReviewVersion < 1
    ))
    || (value.note !== undefined && typeof value.note !== 'string')
  ) return null;

  const workIds = value.workIds.map((id) => id.trim());
  if (new Set(workIds).size !== workIds.length) return null;
  return {
    candidateKey: value.candidateKey.trim(),
    fingerprint: value.fingerprint.trim(),
    workIds,
    decision: value.decision,
    expectedReviewVersion: value.expectedReviewVersion,
    ...(value.note === undefined ? {} : { note: value.note }),
  };
}

function parseWorkMatchMergeBody(value: unknown): WorkMatchMergeBody | null {
  if (!isUnknownRecord(value)) return null;
  if (
    typeof value.candidateKey !== 'string'
    || typeof value.fingerprint !== 'string'
    || typeof value.catalogRevision !== 'number'
    || !Number.isSafeInteger(value.catalogRevision)
    || value.catalogRevision < 0
    || (value.expectedReviewVersion !== null && (
      typeof value.expectedReviewVersion !== 'number'
      || !Number.isSafeInteger(value.expectedReviewVersion)
      || value.expectedReviewVersion < 1
    ))
    || typeof value.canonicalWorkId !== 'string'
    || value.canonicalWorkId.trim().length === 0
    || !Array.isArray(value.sourceWorkIds)
    || value.sourceWorkIds.length === 0
    || !value.sourceWorkIds.every(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    )
    || (value.note !== undefined && typeof value.note !== 'string')
  ) return null;

  const canonicalWorkId = value.canonicalWorkId.trim();
  const sourceWorkIds = value.sourceWorkIds.map((id) => id.trim());
  if (
    new Set(sourceWorkIds).size !== sourceWorkIds.length
    || sourceWorkIds.includes(canonicalWorkId)
  ) return null;
  return {
    candidateKey: value.candidateKey.trim(),
    fingerprint: value.fingerprint.trim(),
    catalogRevision: value.catalogRevision,
    expectedReviewVersion: value.expectedReviewVersion,
    canonicalWorkId,
    sourceWorkIds,
    ...(value.note === undefined ? {} : { note: value.note }),
  };
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

// Nova submission/VOD status transitions both fire a best-effort Discord
// notification, built by a different embed function per entity but posted
// through this one waitUntil block (audit 4.3): a null embed (no real status
// transition, or a transition that isn't approved/rejected) is a no-op.
function notifyDiscordFeedback(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  embed: DiscordEmbed | null,
): void {
  if (!embed) return;
  c.executionCtx.waitUntil(
    postDiscord(c.env.DISCORD_WEBHOOK_FEEDBACK, [embed]).catch((err) =>
      console.error('discord feedback notify failed', err),
    ),
  );
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

// --- Global works (cross-streamer) ---

app.get('/api/works', requireCurator, async (c) => {
  const search = c.req.query('search')?.trim() || undefined;
  const page = Number.parseInt(c.req.query('page') || '1', 10);
  const pageSize = Number.parseInt(c.req.query('pageSize') || '50', 10);
  const sortBy = c.req.query('sortBy');
  const sortDir = c.req.query('sortDir') as 'asc' | 'desc' | undefined;
  const sharedOnlyValue = c.req.query('sharedOnly');
  const sharedOnly = sharedOnlyValue === 'true' || sharedOnlyValue === '1';

  const result = await listGlobalWorksPaginated(c.env.DB, {
    search,
    sharedOnly,
    page,
    pageSize,
    sortBy,
    sortDir,
  });
  const response: GlobalWorksResponse = {
    data: result.works,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: Math.ceil(result.total / result.pageSize),
    stats: result.stats,
  };
  return c.json(response);
});

// --- Global work duplicate review (site-wide) ---

app.get('/api/work-matches', requireCurator, async (c) => {
  const requestedFilter = c.req.query('filter') ?? 'pending';
  const allowedFilters = new Set<WorkMatchFilter>([
    'pending',
    'not_duplicate',
    'needs_research',
    'all',
  ]);
  if (!allowedFilters.has(requestedFilter as WorkMatchFilter)) {
    return c.json({ error: 'Invalid work-match filter' }, 400);
  }
  const page = Number.parseInt(c.req.query('page') || '1', 10);
  const pageSize = Number.parseInt(c.req.query('pageSize') || '25', 10);
  const result = await listWorkMatchCandidates(c.env.DB, {
    filter: requestedFilter as WorkMatchFilter,
    page,
    pageSize,
  });
  const response: WorkMatchCandidatesResponse = {
    ...result,
    totalPages: Math.ceil(result.total / result.pageSize),
  };
  return c.json(response);
});

app.post('/api/work-matches/review', requireCurator, async (c) => {
  const body = parseWorkMatchReviewBody(await c.req.json<unknown>());
  if (!body) return c.json({ error: 'Invalid global work review request' }, 400);

  try {
    await reviewWorkMatchCandidate(c.env.DB, body, c.get('user').email);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkMatchError) {
      const status = error.code === 'work_match_stale' ? 409 : 400;
      return c.json({ error: error.message, code: error.code }, status);
    }
    throw error;
  }
});

app.post('/api/work-matches/merge', requireCurator, async (c) => {
  const body = parseWorkMatchMergeBody(await c.req.json<unknown>());
  if (!body) return c.json({ error: 'Invalid global work merge request' }, 400);

  try {
    const result = await mergeWorkMatchCandidate(c.env.DB, body, c.get('user').email);
    return c.json(result);
  } catch (error) {
    if (error instanceof WorkMatchError) {
      const status = error.code === 'work_match_stale' ? 409 : 400;
      return c.json({ error: error.message, code: error.code }, status);
    }
    throw error;
  }
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
  const parsedBody = parseCreateSongBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const body = parsedBody;
  const inline = body.performances ?? [];

  // Inline performances copy stream_title/date/video_id from the stream row, never
  // from the body, and the streamer-scoped lookup rejects another streamer's stream.
  const streamIds = [...new Set(inline.map((perf) => perf.streamId))];
  const streams = await Promise.all(streamIds.map((streamId) => getStreamById(c.env.DB, streamId, streamerId)));
  const streamsById = new Map(streams.flatMap((stream) => (stream ? [[stream.id, stream] as const] : [])));
  const inserts: PerformanceInsert[] = [];
  for (const perf of inline) {
    const stream = streamsById.get(perf.streamId);
    if (!stream) return c.json({ error: `Stream not found: ${perf.streamId}` }, 404);
    inserts.push({
      id: generatePerformanceId(),
      streamId: stream.id,
      date: stream.date,
      streamTitle: stream.title,
      videoId: stream.videoId,
      timestamp: perf.timestamp,
      endTimestamp: perf.endTimestamp ?? null,
      note: perf.note ?? '',
    });
  }

  const user = c.get('user');
  const id = generateSongId();
  await insertSong(c.env.DB, streamerId, id, body.title, body.originalArtist, body.tags || [], user.email);
  await insertPerformances(c.env.DB, streamerId, id, inserts, user.email);

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

  const parsedBody = parseUpdateSongBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const body = parsedBody;
  await updateSong(c.env.DB, id, {
    title: body.title,
    originalArtist: body.originalArtist,
    tags: body.tags,
  }, user.email);

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
  const parsedBody = parseCreatePerformanceBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const body = parsedBody;

  const stream = await getStreamById(c.env.DB, body.streamId, streamerId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);
  // The FK only proves the song exists; the performance must not bind this streamer's
  // stream to another streamer's song (stream-level bulk approve/delete would follow it).
  if (!(await songBelongsToStreamer(c.env.DB, body.songId, streamerId))) {
    return c.json({ error: 'Song not found' }, 404);
  }

  const user = c.get('user');
  const id = generatePerformanceId();
  await insertPerformance(c.env.DB, {
    streamerId,
    id,
    songId: body.songId,
    streamId: body.streamId,
    date: stream.date,
    streamTitle: stream.title,
    videoId: stream.videoId,
    timestamp: body.timestamp,
    endTimestamp: body.endTimestamp ?? null,
    note: body.note ?? '',
    submittedBy: user.email,
  });

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
  const parsedBody = parseCreateStreamBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const body = parsedBody;

  // The UNIQUE(streamer_id, video_id) constraint would otherwise surface this
  // as an opaque 500 from insertStream below.
  if (await videoIdExists(c.env.DB, body.videoId, streamerId)) {
    return c.json({ error: 'A stream with this video already exists', code: 'STREAM_EXISTS' }, 409);
  }

  const user = c.get('user');

  // Generate stream ID: prefer date-based, fallback to UUID if collision
  let id = generateStreamId(body.date);
  if (await streamIdExists(c.env.DB, id)) {
    id = generateStreamIdFallback();
  }

  await insertStream(c.env.DB, {
    streamerId,
    id,
    title: body.title,
    date: body.date,
    videoId: body.videoId,
    youtubeUrl: body.youtubeUrl,
    credit: JSON.stringify(body.credit || {}),
    submittedBy: user.email,
  });

  return c.json({ id, status: 'pending' }, 201);
});

app.patch('/api/streams/:id/status', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<StatusUpdateBody>();

  if (!VALID_STATUSES.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}` }, 400);
  }

  const existing = await getStreamById(c.env.DB, id, streamerId);
  if (!existing) return c.json({ error: 'Stream not found' }, 404);

  if (!isValidTransition(existing.status, body.status)) {
    return c.json({ error: `Cannot transition from ${existing.status} to ${body.status}` }, 400);
  }

  const user = c.get('user');
  await updateStreamStatus(c.env.DB, id, body.status, user.email);
  return c.json({ id, status: body.status });
});

app.patch('/api/streams/:id', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const id = getRouteParam(c, 'id');
  const parsedBody = parseUpdateStreamBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const body = parsedBody;

  const existing = await getStreamById(c.env.DB, id, streamerId);
  if (!existing) return c.json({ error: 'Stream not found' }, 404);

  const updated = await updateStream(c.env.DB, id, streamerId, {
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

  const stream = await getStreamById(c.env.DB, streamId, streamerId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const user = c.get('user');
  const result = await createSongAndPerformance(c.env.DB, {
    streamerId,
    streamId,
    date: stream.date,
    streamTitle: stream.title,
    videoId: stream.videoId,
    title: body.title,
    originalArtist: body.originalArtist,
    timestamp: body.timestamp,
    endTimestamp: body.endTimestamp ?? null,
    note: body.note ?? '',
    submittedBy: user.email,
  });

  return c.json(result, 201);
});

// Bulk approve all pending songs + performances for a stream
app.post('/api/streams/:streamId/approve-all', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const streamId = getRouteParam(c, 'streamId');
  const stream = await getStreamById(c.env.DB, streamId, streamerId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const user = c.get('user');
  const { songs, performances } = await bulkApproveStream(c.env.DB, streamId, user.email);
  return c.json({ ok: true, songs, performances } satisfies BulkApproveResponse);
});

// Bulk unapprove all approved songs + performances for a stream
app.post('/api/streams/:streamId/unapprove-all', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const streamId = getRouteParam(c, 'streamId');
  const stream = await getStreamById(c.env.DB, streamId, streamerId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  const { songs, performances } = await bulkUnapproveStream(c.env.DB, streamId);
  return c.json({ ok: true, songs, performances } satisfies BulkApproveResponse);
});

// Hard-delete a stream with all its performances and orphaned songs.
// Approved (live) streams are blocked — unapprove first.
app.delete('/api/streams/:id', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const id = getRouteParam(c, 'id');
  const stream = await getStreamById(c.env.DB, id, streamerId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);

  if (!canHardDeleteStream(stream.status)) {
    return c.json({ error: 'Cannot delete an approved stream — unapprove it first' }, 409);
  }

  const { songs, performances } = await deleteStreamCascade(c.env.DB, id);
  return c.json({ ok: true, songs, performances } satisfies DeleteStreamResponse);
});

app.patch('/api/performances/:id/timestamps', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const parsedBody = parseUpdateTimestampsBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const updated = await updatePerformanceTimestamps(c.env.DB, id, {
    timestamp: parsedBody.timestamp,
    endTimestamp: parsedBody.endTimestamp,
  });
  if (!updated) return c.json({ error: 'Performance not found' }, 404);
  return c.json({ ok: true });
});

app.patch('/api/performances/:id/details', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const parsedBody = parseUpdateSongDetailsBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const updated = await updatePerformanceSongDetails(c.env.DB, id, {
    title: parsedBody.title,
    originalArtist: parsedBody.originalArtist,
  }, c.get('user').email);
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
  const streamerId = getStreamerId(c);
  const streamId = getRouteParam(c, 'streamId');
  const detail = await getStreamDetail(c.env.DB, streamId, streamerId);
  if (!detail) return c.json({ error: 'Stream not found' }, 404);
  return c.json(detail);
});

// --- Performance note update ---

app.patch('/api/performances/:id/note', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const parsedBody = parseNoteBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  const updated = await updatePerformanceNote(c.env.DB, id, parsedBody.note);
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

  const stream = await getStreamById(c.env.DB, streamId, streamerId);
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

  const importPerformances = body.replace ? replaceStreamPerformances : appendStreamPerformances;
  const { created } = await importPerformances(c.env.DB, {
    streamerId,
    streamId,
    date: stream.date,
    streamTitle: stream.title,
    videoId: stream.videoId,
    songs,
    submittedBy: user.email,
  });

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
  const streamerId = getStreamerId(c);
  const streamId = getRouteParam(c, 'streamId');
  const stream = await getStreamById(c.env.DB, streamId, streamerId);
  if (!stream) return c.json({ error: 'Stream not found' }, 404);
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
  const parsedBody = parseImportStreamsBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);
  // A repeated id would put two identical inserts into the batch below and fail
  // the whole request on UNIQUE(streamer_id, video_id) — the preflight only knows
  // DB state, not in-request repeats. parseImportStreamsBody already de-dupes
  // (and is the tested source of truth for it); this stays as a defense-in-depth
  // belt rather than trusting the parser's output alone.
  const videoIds = [...new Set(parsedBody.videoIds)];

  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  let videos;
  try {
    videos = await getVideoDetails(apiKey, videoIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown YouTube API error';
    return c.json({ error: msg }, 502);
  }

  const user = c.get('user');
  const db = c.env.DB;

  // Deterministic date-based candidate id per video, computed up front so the
  // existence preflight below can check both video ids and candidate stream ids in
  // one round trip, before any row is written.
  const candidateIdByVideoId = new Map(videos.map((v) => [v.videoId, generateStreamId(v.date)] as const));

  try {
    const { existingVideoIds, existingStreamIds } = await findExistingStreamImportKeys(
      db,
      streamerId,
      videos.map((v) => v.videoId),
      [...candidateIdByVideoId.values()],
    );

    const imported: string[] = [];
    const skippedExisting: string[] = [];
    // Seeds with the DB's existing ids so a candidate colliding with an already-stored
    // stream falls back too, then grows as candidates are claimed so two videos on the
    // same date within this same request don't collide with each other either.
    const usedStreamIds = new Set(existingStreamIds);
    const streamsToInsert: StreamInsert[] = [];

    for (const v of videos) {
      if (existingVideoIds.has(v.videoId)) {
        skippedExisting.push(v.videoId);
        continue;
      }

      let id = candidateIdByVideoId.get(v.videoId)!;
      if (usedStreamIds.has(id)) {
        id = generateStreamIdFallback();
      }
      usedStreamIds.add(id);

      streamsToInsert.push({
        streamerId,
        id,
        title: v.title,
        date: v.date,
        videoId: v.videoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
        credit: '{}',
        submittedBy: user.email,
      });
      imported.push(id);
    }

    // All-or-nothing: every stream insert lands in one batch, so a mid-import failure
    // can no longer leave some streams imported and others silently dropped.
    await insertStreams(db, streamsToInsert);

    return c.json<ImportStreamsResponse>({ created: imported.length, imported, skippedExisting });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Database error';
    return c.json({ error: `Failed to import streams: ${msg}` }, 500);
  }
});

// --- Pipeline: Extract timestamps from YouTube comments/description ---

app.post('/api/pipeline/extract', requireCurator, async (c) => {
  const streamerId = getStreamerId(c);
  const { streamId } = await c.req.json<{ streamId: string }>();
  if (!streamId) {
    return c.json({ error: 'streamId is required' }, 400);
  }

  const stream = await getStreamById(c.env.DB, streamId, streamerId);
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

  const stream = await getStreamById(c.env.DB, body.streamId, streamerId);
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

  const importPerformances = body.replace ? replaceStreamPerformances : appendStreamPerformances;
  const { created } = await importPerformances(c.env.DB, {
    streamerId,
    streamId: body.streamId,
    date: stream.date,
    streamTitle: stream.title,
    videoId: stream.videoId,
    songs: body.songs,
    submittedBy: user.email,
  });

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

app.post('/api/harmonize/merge', requireCurator, async (c) => {
  const body = parseHarmonizeMergeBody(await c.req.json<unknown>());
  if (!body) return c.json({ error: 'Invalid Harmonizer merge request' }, 400);

  const streamerId = getStreamerId(c);
  const user = c.get('user');
  try {
    const result = await mergeSongs(
      c.env.DB,
      streamerId,
      body.canonicalSongId,
      body.sourceSongIds,
      user.email,
      body.workMergeConfirmation,
    );
    return c.json<HarmonizeMergeResponse>({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SongMergeError) {
      const body = { error: error.message, code: error.code };
      if (error.code === 'song_not_found') return c.json(body, 404);
      if (
        error.code === 'work_not_linked'
        || error.code === 'work_merge_required'
        || error.code === 'work_merge_stale'
      ) {
        return c.json(body, 409);
      }
      return c.json(body, 400);
    }
    throw error;
  }
});

app.post('/api/harmonize/apply', requireCurator, async (c) => {
  const body = await c.req.json<HarmonizeApplyBody>();
  if (!body.updates || body.updates.length === 0) {
    return c.json({ error: 'updates array is required' }, 400);
  }

  const updated = await batchUpdateSongs(c.env.DB, body.updates, c.get('user').email);
  return c.json({ ok: true, updated });
});

// --- Nova submissions (separate D1: NOVA_DB) ---

app.get('/api/nova/submissions', requireCurator, async (c) => {
  const status = c.req.query('status');
  const search = c.req.query('search');
  const data = await listSubmissions(c.env.NOVA_DB, { status, search });
  return c.json({ data, total: data.length });
});

// POST /api/nova/submissions/fetch-all-subscribers — bulk fetch for all approved streamers
// Must be registered before /:id routes to avoid Hono matching "fetch-all-subscribers" as :id
app.post('/api/nova/submissions/fetch-all-subscribers', requireCurator, async (c) => {
  const apiKey = c.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  const subs = await listApprovedSubmissionsWithChannel(c.env.NOVA_DB);

  const response = await refreshSubscriberCounts(c.env.NOVA_DB, apiKey, subs);
  return c.json<BulkFetchSubscribersResponse>(response);
});

// POST /api/nova/submissions/:id/verify-youtube-channel — verify an existing
// migrated ID without requiring a meaningless edit to that opaque value.
app.post('/api/nova/submissions/:id/verify-youtube-channel', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const sub = await getSubmissionChannelId(c.env.NOVA_DB, id);
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
  const ok = await updateSubmissionVerification(c.env.NOVA_DB, id, sub.youtube_channel_id, verifiedId, verifiedAt);
  if (!ok) {
    return c.json({ error: 'YouTube channel ID changed during verification; retry the operation' }, 409);
  }
  const updated = await getSubmissionById(c.env.NOVA_DB, id);
  return c.json(updated);
});

app.get('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const result = await getSubmissionById(c.env.NOVA_DB, id);

  if (!result) return c.json({ error: 'Submission not found' }, 404);
  return c.json(result);
});

app.put('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const existing = await getSubmissionForUpdate(c.env.NOVA_DB, id);
  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  const parsedBody = parseNovaSubmissionUpdateBody(await c.req.json<unknown>());
  if ('error' in parsedBody) {
    return c.json({ error: parsedBody.error }, 400);
  }

  const body: NovaSubmissionUpdateFields = parsedBody;
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

  const fields: Partial<Record<NovaEditableField, string | number>> = {};
  for (const key of NOVA_SUBMISSION_EDITABLE_FIELDS) {
    if (body[key] !== undefined) {
      fields[key] = body[key] as string | number;
    }
  }

  const verification = (verifiedChannelId !== undefined && channelVerifiedAt !== undefined)
    ? { channelId: verifiedChannelId, verifiedAt: channelVerifiedAt }
    : undefined;

  const updatedAny = await updateSubmissionFields(c.env.NOVA_DB, id, fields, verification);
  if (!updatedAny) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  const updated = await getSubmissionById(c.env.NOVA_DB, id);
  return c.json(updated);
});

app.patch('/api/nova/submissions/:id/status', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ status: NovaStatus; reviewer_note?: string }>();

  const validStatuses = new Set<string>(NOVA_STATUSES);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}. Must be 'approved', 'rejected', or 'pending'` }, 400);
  }

  const existing = await getSubmissionStatus(c.env.NOVA_DB, id);
  if (!existing) return c.json({ error: 'Submission not found' }, 404);

  await updateSubmissionStatus(c.env.NOVA_DB, id, body.status, body.reviewer_note);

  const updated = await getSubmissionById(c.env.NOVA_DB, id);

  const feedbackEmbed = updated ? feedbackEmbedForSubmission(existing.status, body.status, updated) : null;
  notifyDiscordFeedback(c, feedbackEmbed);

  return c.json(updated);
});

// DELETE /api/nova/submissions/:id — permanently delete a streamer submission
app.delete('/api/nova/submissions/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  if (!(await submissionExists(c.env.NOVA_DB, id))) return c.json({ error: 'Submission not found' }, 404);

  await deleteSubmission(c.env.NOVA_DB, id);

  return c.json({ ok: true });
});

// POST /api/nova/submissions/:id/fetch-subscribers — fetch subscriber count from YouTube
app.post('/api/nova/submissions/:id/fetch-subscribers', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');

  const sub = await getSubmissionChannelId(c.env.NOVA_DB, id);
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

  const ok = await updateSubmissionSubscriberInfo(c.env.NOVA_DB, id, sub.youtube_channel_id, {
    subscriberCount: formatted,
    avatarUrl: info.avatarUrl,
    verifiedChannelId: info.channelId,
    verifiedAt,
  });
  if (!ok) {
    return c.json({ error: 'YouTube channel ID changed during refresh; retry the operation' }, 409);
  }

  const updated = await getSubmissionById(c.env.NOVA_DB, id);

  return c.json(updated);
});

// --- Nova VOD submissions (NOVA_DB) ---

app.get('/api/nova/vods', requireCurator, async (c) => {
  const status = c.req.query('status');
  const streamer = c.req.query('streamer');
  const data = await listVods(c.env.NOVA_DB, { status, streamer });
  return c.json({ data, total: data.length });
});

app.get('/api/nova/vods/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const vod = await getVodById(c.env.NOVA_DB, id);

  if (!vod) return c.json({ error: 'VOD submission not found' }, 404);

  const songs = await listVodSongs(c.env.NOVA_DB, id);

  return c.json({ ...vod, songs });
});

app.patch('/api/nova/vods/:id/status', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ status: NovaStatus; reviewer_note?: string }>();

  const validStatuses = new Set<string>(NOVA_STATUSES);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}. Must be 'approved', 'rejected', or 'pending'` }, 400);
  }

  const existing = await getVodStatus(c.env.NOVA_DB, id);

  if (!existing) return c.json({ error: 'VOD submission not found' }, 404);

  await updateVodStatus(c.env.NOVA_DB, id, body.status, body.reviewer_note);

  // Fetch the full updated row once and reuse it for the import gate, the Discord embed,
  // and the response — avoids a second identical SELECT * on vod_submissions.
  const updated = await getVodById(c.env.NOVA_DB, id);

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
      const vodSongs = await listVodSongs(c.env.NOVA_DB, id);

      if (vodSongs.length > 0) {
        const user = c.get('user');
        await importVodToAdminDb(c.env.DB, updated, vodSongs, user.email);
      }
    }
  }

  const feedbackEmbed = updated ? feedbackEmbedForVod(existing.status, body.status, updated) : null;
  notifyDiscordFeedback(c, feedbackEmbed);

  return c.json(updated);
});

app.put('/api/nova/vods/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  if (!(await vodExists(c.env.NOVA_DB, id))) return c.json({ error: 'VOD submission not found' }, 404);

  const parsedBody = parseNovaVodUpdateBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);

  const updatedAny = await updateVodFields(c.env.NOVA_DB, id, parsedBody);
  if (!updatedAny) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  const updated = await getVodById(c.env.NOVA_DB, id);

  return c.json(updated);
});

// DELETE /api/nova/vods/:id — permanently delete a VOD submission (cascades to vod_songs)
app.delete('/api/nova/vods/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  if (!(await vodExists(c.env.NOVA_DB, id))) return c.json({ error: 'VOD submission not found' }, 404);

  await deleteVod(c.env.NOVA_DB, id);

  return c.json({ ok: true });
});

// --- Crystal tickets (separate D1: CRYSTAL_DB) ---

app.get('/api/crystal/tickets', requireCurator, async (c) => {
  const status = c.req.query('status');
  const type = c.req.query('type');
  const data = await listTickets(c.env.CRYSTAL_DB, { status, type });
  return c.json({ data, total: data.length });
});

app.get('/api/crystal/tickets/:id', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const result = await getTicketById(c.env.CRYSTAL_DB, id);

  if (!result) return c.json({ error: 'Ticket not found' }, 404);
  return c.json(result);
});

app.post('/api/crystal/tickets/:id/reply', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const parsedBody = parseCrystalReplyBody(await c.req.json<unknown>());
  if ('error' in parsedBody) return c.json({ error: parsedBody.error }, 400);

  if (!(await ticketExists(c.env.CRYSTAL_DB, id))) return c.json({ error: 'Ticket not found' }, 404);

  await replyToTicket(c.env.CRYSTAL_DB, id, parsedBody.admin_reply);

  const updated = await getTicketById(c.env.CRYSTAL_DB, id);

  return c.json(updated);
});

app.patch('/api/crystal/tickets/:id/status', requireCurator, async (c) => {
  const id = getRouteParam(c, 'id');
  const body = await c.req.json<{ status: CrystalTicketStatus }>();

  const validStatuses = new Set<string>(CRYSTAL_TICKET_STATUSES);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: `Invalid status: ${body.status}` }, 400);
  }

  if (!(await ticketExists(c.env.CRYSTAL_DB, id))) return c.json({ error: 'Ticket not found' }, 404);

  await updateTicketStatus(c.env.CRYSTAL_DB, id, body.status);

  const updated = await getTicketById(c.env.CRYSTAL_DB, id);

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

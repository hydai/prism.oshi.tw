import { VOD_EXPORT_LIMITS, VOD_EXPORT_SCHEMA_VERSION } from './constants';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  SqliteIntegerSource,
  VodExportSourceData,
} from './types';

const TRIGGER_SCHEMA_VERSION = 1;

// D1 rejects an individual bound TEXT/BLOB value above 2,000,000 bytes. Keep
// packed scope values below that platform limit and bind an unusually large
// individual slug directly. The fixed-width byte-length framing avoids JSON's
// potentially 6x escaping expansion for invalid source slugs.
const D1_MAX_BOUND_VALUE_BYTES = 2_000_000;
const STREAMER_SCOPE_BLOB_TARGET_BYTES = 1_900_000;
const STREAMER_SCOPE_LENGTH_PREFIX_BYTES = 8;
const D1_MAX_BOUND_PARAMETERS = 100;
const DB_SOURCE_LIMIT_BOUND_PARAMETERS = 6;
const textEncoder = new TextEncoder();

const ADMIN_REVISION_TRIGGERS = [
  'vod_export_streams_insert_revision',
  'vod_export_streams_delete_revision',
  'vod_export_streams_update_revision',
  'vod_export_songs_insert_revision',
  'vod_export_songs_delete_revision',
  'vod_export_songs_update_revision',
  'vod_export_performances_insert_revision',
  'vod_export_performances_delete_revision',
  'vod_export_performances_update_revision',
] as const;

const NOVA_REVISION_TRIGGERS = [
  'vod_export_submissions_insert_revision',
  'vod_export_submissions_delete_revision',
  'vod_export_submissions_update_revision',
] as const;

export interface VodExportSourceBindings {
  DB: D1Database;
  NOVA_DB: D1Database;
  VOD_EXPORT_DB_ID: string;
  VOD_EXPORT_NOVA_DB_ID: string;
}

export interface VodExportSourceFingerprint {
  dbId: string;
  dbRevision: string;
  novaDbId: string;
  novaRevision: string;
  schemaVersion: typeof VOD_EXPORT_SCHEMA_VERSION;
  exporterBuildId: string;
}

export interface VodExportSourceRead {
  data: VodExportSourceData;
  fingerprint: VodExportSourceFingerprint;
  sourceRows: number;
  sourceTextBytes: number;
}

export type VodExportSourceErrorCode =
  | 'EXPORT_SOURCE_GUARD_MISSING'
  | 'EXPORT_SOURCE_GUARD_MISMATCH'
  | 'EXPORT_SOURCE_REVISION_INVALID'
  | 'EXPORT_SOURCE_ROW_ID_INVALID'
  | 'EXPORT_LIMIT_EXCEEDED';

export class VodExportSourceError extends Error {
  constructor(
    readonly code: VodExportSourceErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Readonly<Record<string, string | number>>,
  ) {
    super(message);
    this.name = 'VodExportSourceError';
  }
}

interface StateRow {
  revision: string | number | null;
  trigger_schema_version: number | string | null;
}

interface StreamerStatsRow {
  streamer_count: number | string | null;
  source_text_bytes: number | string | null;
}

interface NovaStreamerRow {
  submission_id: string;
  slug: string | null;
  display_name: string | null;
  youtube_channel_id: string | null;
  youtube_channel_verified_id: string | null;
  youtube_channel_verified_at: string | null;
  avatar_url: string | null;
  group_name: string | null;
  link_youtube: string | null;
  link_twitter: string | null;
  link_facebook: string | null;
  link_instagram: string | null;
  link_twitch: string | null;
  enabled: number | string | null;
  status: string;
}

interface VodRow {
  stream_id: string;
  streamer_id: string;
  title: string | null;
  date: string | null;
  video_id: string | null;
  status: string;
}

interface SongRow {
  row_id: string | number;
  song_id: string | null;
  streamer_id: string;
  title: string | null;
  original_artist: string | null;
  status: string;
}

interface PerformanceRow {
  row_id: string | number;
  performance_id: string | null;
  streamer_id: string;
  song_id: string;
  stream_id: string;
  start_storage_class: string;
  start_decimal_text: string | number | null;
  end_storage_class: string;
  end_decimal_text: string | number | null;
  status: string;
}

interface AdminSourceQueryRow {
  row_kind: 'stats' | 'vod' | 'song' | 'performance';
  source_rows: number | string | null;
  source_text_bytes: number | string | null;
  row_id: string | number | null;
  entity_id: string | null;
  streamer_id: string | null;
  title: string | null;
  secondary_text: string | null;
  relation_id: string | null;
  stream_id: string | null;
  start_storage_class: string | null;
  start_decimal_text: string | number | null;
  end_storage_class: string | null;
  end_decimal_text: string | number | null;
  status: string | null;
}

interface StreamerScopeBinding {
  kind: 'blob' | 'direct';
  value: Uint8Array | string;
}

interface StreamerScope {
  cteSql: string;
  bindings: readonly (Uint8Array | string)[];
}

const STATE_SQL = `
  SELECT CAST(revision AS TEXT) AS revision, trigger_schema_version
  FROM vod_export_state
  WHERE id = 1
`;

function triggerGuardSql(triggerNames: readonly string[]): string {
  const quotedNames = triggerNames.map((name) => `'${name}'`).join(', ');
  return `
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger' AND name IN (${quotedNames})
    ORDER BY name
  `;
}

const NOVA_SCOPED_CTE = `
  WITH scoped AS (
    SELECT
      id,
      slug,
      display_name,
      youtube_channel_id,
      youtube_channel_verified_id,
      youtube_channel_verified_at,
      avatar_url,
      "group" AS group_name,
      link_youtube,
      link_twitter,
      link_facebook,
      link_instagram,
      link_twitch,
      enabled,
      status
    FROM submissions
    WHERE status = 'approved' AND enabled = 1
  ),
  stats AS (
    SELECT
      COUNT(*) AS streamer_count,
      COALESCE(SUM(
        length(CAST(COALESCE(id, '') AS BLOB)) +
        length(CAST(COALESCE(slug, '') AS BLOB)) +
        length(CAST(COALESCE(display_name, '') AS BLOB)) +
        length(CAST(COALESCE(youtube_channel_id, '') AS BLOB)) +
        length(CAST(COALESCE(youtube_channel_verified_id, '') AS BLOB)) +
        length(CAST(COALESCE(youtube_channel_verified_at, '') AS BLOB)) +
        length(CAST(COALESCE(avatar_url, '') AS BLOB)) +
        length(CAST(COALESCE(group_name, '') AS BLOB)) +
        length(CAST(COALESCE(link_youtube, '') AS BLOB)) +
        length(CAST(COALESCE(link_twitter, '') AS BLOB)) +
        length(CAST(COALESCE(link_facebook, '') AS BLOB)) +
        length(CAST(COALESCE(link_instagram, '') AS BLOB)) +
        length(CAST(COALESCE(link_twitch, '') AS BLOB)) +
        length(CAST(COALESCE(status, '') AS BLOB))
      ), 0) AS source_text_bytes
    FROM scoped
  )
`;

const NOVA_STATS_SQL = `${NOVA_SCOPED_CTE}
  SELECT streamer_count, source_text_bytes FROM stats
`;

const NOVA_ROWS_SQL = `${NOVA_SCOPED_CTE}
  SELECT
    id AS submission_id,
    slug,
    display_name,
    youtube_channel_id,
    youtube_channel_verified_id,
    youtube_channel_verified_at,
    avatar_url,
    group_name,
    link_youtube,
    link_twitter,
    link_facebook,
    link_instagram,
    link_twitch,
    enabled,
    status
  FROM scoped
  WHERE (SELECT streamer_count <= ? AND source_text_bytes <= ? FROM stats)
  ORDER BY id
`;

const DB_SCOPED_CTE_SUFFIX = `,
  scoped_performances AS (
    SELECT p.rowid AS source_row_id, p.*
    FROM performances p
    WHERE p.status = 'approved'
      AND p.streamer_id IN (SELECT streamer_id FROM selected_streamers)
  ),
  scoped_streams AS (
    SELECT s.rowid AS source_row_id, s.*
    FROM streams s
    WHERE (
      s.status = 'approved'
      AND s.streamer_id IN (SELECT streamer_id FROM selected_streamers)
    ) OR EXISTS (
      SELECT 1 FROM scoped_performances p WHERE p.stream_id = s.id
    )
  ),
  scoped_songs AS (
    SELECT s.rowid AS source_row_id, s.*
    FROM songs s
    WHERE (
      s.status = 'approved'
      AND s.streamer_id IN (SELECT streamer_id FROM selected_streamers)
    ) OR EXISTS (
      SELECT 1 FROM scoped_performances p WHERE p.song_id = s.id
    )
  ),
  stats AS (
    SELECT
      (
        (SELECT COUNT(*) FROM scoped_streams) +
        (SELECT COUNT(*) FROM scoped_songs) +
        (SELECT COUNT(*) FROM scoped_performances)
      ) AS source_rows,
      (
        COALESCE((SELECT SUM(
          length(CAST(COALESCE(id, '') AS BLOB)) +
          length(CAST(COALESCE(streamer_id, '') AS BLOB)) +
          length(CAST(COALESCE(title, '') AS BLOB)) +
          length(CAST(COALESCE(date, '') AS BLOB)) +
          length(CAST(COALESCE(video_id, '') AS BLOB)) +
          length(CAST(COALESCE(status, '') AS BLOB))
        ) FROM scoped_streams), 0) +
        COALESCE((SELECT SUM(
          length(CAST(COALESCE(id, '') AS BLOB)) +
          length(CAST(COALESCE(streamer_id, '') AS BLOB)) +
          length(CAST(COALESCE(title, '') AS BLOB)) +
          length(CAST(COALESCE(original_artist, '') AS BLOB)) +
          length(CAST(COALESCE(status, '') AS BLOB))
        ) FROM scoped_songs), 0) +
        COALESCE((SELECT SUM(
          length(CAST(COALESCE(id, '') AS BLOB)) +
          length(CAST(COALESCE(streamer_id, '') AS BLOB)) +
          length(CAST(COALESCE(song_id, '') AS BLOB)) +
          length(CAST(COALESCE(stream_id, '') AS BLOB)) +
          length(CAST(COALESCE(timestamp, '') AS BLOB)) +
          length(CAST(COALESCE(end_timestamp, '') AS BLOB)) +
          length(CAST(COALESCE(status, '') AS BLOB))
        ) FROM scoped_performances), 0)
      ) AS source_text_bytes
  )
`;

function dbSourceSql(scopeCte: string): string {
  return `${scopeCte}${DB_SCOPED_CTE_SUFFIX}
    SELECT
      'stats' AS row_kind,
      source_rows,
      source_text_bytes,
      NULL AS row_id,
      NULL AS entity_id,
      NULL AS streamer_id,
      NULL AS title,
      NULL AS secondary_text,
      NULL AS relation_id,
      NULL AS stream_id,
      NULL AS start_storage_class,
      NULL AS start_decimal_text,
      NULL AS end_storage_class,
      NULL AS end_decimal_text,
      NULL AS status,
      0 AS sort_group,
      '' AS sort_key,
      '' AS sort_row_id
    FROM stats
    UNION ALL
    SELECT
      'vod', NULL, NULL, NULL, id, streamer_id, title, date, video_id, NULL,
      NULL, NULL, NULL, NULL, status,
      1, COALESCE(id, ''), CAST(source_row_id AS TEXT)
    FROM scoped_streams
    WHERE (SELECT source_rows <= ? AND source_text_bytes <= ? FROM stats)
    UNION ALL
    SELECT
      'song', NULL, NULL, CAST(source_row_id AS TEXT), id, streamer_id, title,
      original_artist, NULL, NULL, NULL, NULL, NULL, NULL, status,
      2, COALESCE(id, ''), CAST(source_row_id AS TEXT)
    FROM scoped_songs
    WHERE (SELECT source_rows <= ? AND source_text_bytes <= ? FROM stats)
    UNION ALL
    SELECT
      'performance', NULL, NULL, CAST(source_row_id AS TEXT), id, streamer_id, NULL,
      NULL, song_id, stream_id, typeof(timestamp), CAST(timestamp AS TEXT),
      typeof(end_timestamp), CAST(end_timestamp AS TEXT), status,
      3, COALESCE(id, ''), CAST(source_row_id AS TEXT)
    FROM scoped_performances
    WHERE (SELECT source_rows <= ? AND source_text_bytes <= ? FROM stats)
    ORDER BY sort_group, sort_key, sort_row_id
  `;
}

function buildStreamerScope(streamerIds: readonly string[]): StreamerScope {
  const encodedBindings: StreamerScopeBinding[] = [];
  let pendingEntries: Uint8Array[] = [];
  let pendingBytes = 0;

  const flushBlob = (): void => {
    if (pendingBytes === 0) return;
    const payload = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const entry of pendingEntries) {
      payload.set(entry, offset);
      offset += entry.byteLength;
    }
    encodedBindings.push({ kind: 'blob', value: payload });
    pendingEntries = [];
    pendingBytes = 0;
  };

  for (const streamerId of streamerIds) {
    const valueBytes = textEncoder.encode(streamerId);
    if (valueBytes.byteLength > D1_MAX_BOUND_VALUE_BYTES) {
      throw new VodExportSourceError(
        'EXPORT_SOURCE_GUARD_MISMATCH',
        'A streamer scope key exceeds the D1 bound-value limit',
        503,
      );
    }

    const lengthText = String(valueBytes.byteLength).padStart(
      STREAMER_SCOPE_LENGTH_PREFIX_BYTES,
      '0',
    );
    if (lengthText.length !== STREAMER_SCOPE_LENGTH_PREFIX_BYTES) {
      throw new VodExportSourceError(
        'EXPORT_SOURCE_GUARD_MISMATCH',
        'A streamer scope key cannot be framed safely',
        503,
      );
    }
    const prefix = textEncoder.encode(lengthText);
    const entry = new Uint8Array(prefix.byteLength + valueBytes.byteLength);
    entry.set(prefix, 0);
    entry.set(valueBytes, prefix.byteLength);

    // The framing bytes can push an otherwise legal D1 string over the BLOB
    // limit. Bind that one original string directly instead.
    if (entry.byteLength > STREAMER_SCOPE_BLOB_TARGET_BYTES) {
      flushBlob();
      encodedBindings.push({ kind: 'direct', value: streamerId });
      continue;
    }
    if (pendingBytes + entry.byteLength > STREAMER_SCOPE_BLOB_TARGET_BYTES) flushBlob();
    pendingEntries.push(entry);
    pendingBytes += entry.byteLength;
  }
  flushBlob();

  if (encodedBindings.length + DB_SOURCE_LIMIT_BOUND_PARAMETERS > D1_MAX_BOUND_PARAMETERS) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISMATCH',
      'Streamer scope requires too many D1 bound parameters',
      503,
    );
  }

  const sourceSelects = encodedBindings.length === 0
    ? ['SELECT NULL AS payload, NULL AS direct_value WHERE 0']
    : encodedBindings.map((binding) => binding.kind === 'blob'
      ? 'SELECT CAST(? AS BLOB) AS payload, NULL AS direct_value'
      : 'SELECT NULL AS payload, CAST(? AS TEXT) AS direct_value');
  const byteLength = (expression: string): string =>
    `CAST(CAST(substr(${expression}, 1, ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER)`;
  const firstLength = byteLength('payload');
  const nextLength = byteLength('rest');

  return {
    cteSql: `
      WITH RECURSIVE
      scope_sources(payload, direct_value) AS (
        ${sourceSelects.join('\n        UNION ALL\n        ')}
      ),
      decoded_scope(streamer_id, rest) AS (
        SELECT
          CAST(substr(payload, ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES + 1}, ${firstLength}) AS TEXT),
          substr(payload, ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES + 1} + ${firstLength})
        FROM scope_sources
        WHERE payload IS NOT NULL AND length(payload) >= ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES}
        UNION ALL
        SELECT
          CAST(substr(rest, ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES + 1}, ${nextLength}) AS TEXT),
          substr(rest, ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES + 1} + ${nextLength})
        FROM decoded_scope
        WHERE length(rest) >= ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES}
      ),
      selected_streamers(streamer_id) AS (
        SELECT streamer_id FROM decoded_scope
        UNION ALL
        SELECT direct_value FROM scope_sources WHERE direct_value IS NOT NULL
      )
    `,
    bindings: encodedBindings.map((binding) => binding.value),
  };
}

function numberFromAggregate(value: number | string | null, field: string): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_REVISION_INVALID',
      `Invalid aggregate value for ${field}`,
      500,
    );
  }
  return numeric;
}

function parseState(row: StateRow | null, database: 'DB' | 'NOVA_DB'): string {
  if (row === null) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISSING',
      `${database} export revision state is missing`,
      503,
      { database },
    );
  }

  if (Number(row.trigger_schema_version) !== TRIGGER_SCHEMA_VERSION) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISMATCH',
      `${database} export trigger schema version does not match`,
      503,
      { database, expected: TRIGGER_SCHEMA_VERSION },
    );
  }

  const revision = String(row.revision ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(revision)) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_REVISION_INVALID',
      `${database} export revision is invalid`,
      503,
      { database },
    );
  }

  try {
    if (BigInt(revision) > 9_223_372_036_854_775_807n) throw new Error('overflow');
  } catch {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_REVISION_INVALID',
      `${database} export revision is outside signed 64-bit range`,
      503,
      { database },
    );
  }

  return revision;
}

function assertRequiredTriggers(
  rows: readonly { name: string }[],
  expected: readonly string[],
  database: 'DB' | 'NOVA_DB',
): void {
  const found = new Set(rows.map((row) => row.name));
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISSING',
      `${database} export revision triggers are missing`,
      503,
      { database, missingCount: missing.length },
    );
  }
}

function parsePrivateRowId(value: string | number, entity: 'song' | 'performance'): number {
  const text = String(value);
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_ROW_ID_INVALID',
      `${entity} private row locator is invalid`,
      500,
      { entity },
    );
  }
  const rowId = Number(text);
  if (!Number.isSafeInteger(rowId)) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_ROW_ID_INVALID',
      `${entity} private row locator is outside the safe integer range`,
      500,
      { entity },
    );
  }
  return rowId;
}

function sqliteInteger(storageClass: string, decimalText: string | number | null): SqliteIntegerSource {
  return {
    storageClass,
    decimalText: decimalText === null ? null : String(decimalText),
  };
}

function requireFirstRow<T>(result: D1Result<T>, description: string): T {
  const row = result.results[0];
  if (row === undefined) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISSING',
      `${description} query returned no row`,
      503,
    );
  }
  return row;
}

async function readNovaSource(db: D1Database): Promise<{
  revision: string;
  streamers: ExportSourceStreamer[];
  sourceTextBytes: number;
}> {
  const session = db.withSession('first-primary');
  const results = await session.batch<unknown>([
    session.prepare(STATE_SQL),
    session.prepare(triggerGuardSql(NOVA_REVISION_TRIGGERS)),
    session.prepare(NOVA_STATS_SQL),
    session.prepare(NOVA_ROWS_SQL).bind(
      VOD_EXPORT_LIMITS.streamers,
      VOD_EXPORT_LIMITS.sourceTextBytes,
    ),
  ]);

  const state = requireFirstRow(results[0] as D1Result<StateRow>, 'NOVA_DB state');
  assertRequiredTriggers(
    (results[1] as D1Result<{ name: string }>).results,
    NOVA_REVISION_TRIGGERS,
    'NOVA_DB',
  );
  const stats = requireFirstRow(results[2] as D1Result<StreamerStatsRow>, 'NOVA_DB source stats');
  const streamerCount = numberFromAggregate(stats.streamer_count, 'streamers');
  const sourceTextBytes = numberFromAggregate(stats.source_text_bytes, 'sourceTextBytes');

  if (streamerCount > VOD_EXPORT_LIMITS.streamers) {
    // Every approved+enabled NOVA row belongs to the intended emitted scope;
    // validation errors block publication rather than omitting that streamer.
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Streamer source limit exceeded',
      422,
      { resource: 'streamers', actual: streamerCount, limit: VOD_EXPORT_LIMITS.streamers },
    );
  }
  if (sourceTextBytes > VOD_EXPORT_LIMITS.sourceTextBytes) {
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Source text byte limit exceeded',
      422,
      { resource: 'sourceTextBytes', actual: sourceTextBytes, limit: VOD_EXPORT_LIMITS.sourceTextBytes },
    );
  }

  const rows = (results[3] as D1Result<NovaStreamerRow>).results;
  if (rows.length !== streamerCount) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISMATCH',
      'NOVA_DB gated source row count does not match its preflight count',
      503,
    );
  }

  const streamers: ExportSourceStreamer[] = rows.map((row) => ({
    submissionId: row.submission_id,
    slug: row.slug,
    displayName: row.display_name,
    youtubeChannelId: row.youtube_channel_id,
    verifiedYoutubeChannelId: row.youtube_channel_verified_id,
    youtubeChannelVerifiedAt: row.youtube_channel_verified_at,
    avatarUrl: row.avatar_url,
    group: row.group_name,
    socialLinks: {
      youtube: row.link_youtube,
      twitter: row.link_twitter,
      facebook: row.link_facebook,
      instagram: row.link_instagram,
      twitch: row.link_twitch,
    },
    enabled: Number(row.enabled) === 1,
    status: row.status,
  }));

  return { revision: parseState(state, 'NOVA_DB'), streamers, sourceTextBytes };
}

async function readAdminSource(
  db: D1Database,
  streamerIds: readonly string[],
  remainingTextBytes: number,
): Promise<{
  revision: string;
  vods: ExportSourceVod[];
  songs: ExportSourceSong[];
  performances: ExportSourcePerformance[];
  sourceRows: number;
  sourceTextBytes: number;
}> {
  const streamerScope = buildStreamerScope(streamerIds);
  const session = db.withSession('first-primary');
  const results = await session.batch<unknown>([
    session.prepare(STATE_SQL),
    session.prepare(triggerGuardSql(ADMIN_REVISION_TRIGGERS)),
    session.prepare(dbSourceSql(streamerScope.cteSql)).bind(
      ...streamerScope.bindings,
      VOD_EXPORT_LIMITS.sourceRows,
      remainingTextBytes,
      VOD_EXPORT_LIMITS.sourceRows,
      remainingTextBytes,
      VOD_EXPORT_LIMITS.sourceRows,
      remainingTextBytes,
    ),
  ]);

  const state = requireFirstRow(results[0] as D1Result<StateRow>, 'DB state');
  assertRequiredTriggers(
    (results[1] as D1Result<{ name: string }>).results,
    ADMIN_REVISION_TRIGGERS,
    'DB',
  );
  const sourceQueryRows = (results[2] as D1Result<AdminSourceQueryRow>).results;
  const stats = sourceQueryRows.find((row) => row.row_kind === 'stats') ?? null;
  if (stats === null) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISSING',
      'DB source stats query returned no row',
      503,
    );
  }
  const sourceRows = numberFromAggregate(stats.source_rows, 'sourceRows');
  const sourceTextBytes = numberFromAggregate(stats.source_text_bytes, 'sourceTextBytes');

  if (sourceRows > VOD_EXPORT_LIMITS.sourceRows) {
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Content source row limit exceeded',
      422,
      { resource: 'sourceRows', actual: sourceRows, limit: VOD_EXPORT_LIMITS.sourceRows },
    );
  }
  if (sourceTextBytes > remainingTextBytes) {
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Aggregate source text byte limit exceeded',
      422,
      {
        resource: 'sourceTextBytes',
        actual: VOD_EXPORT_LIMITS.sourceTextBytes - remainingTextBytes + sourceTextBytes,
        limit: VOD_EXPORT_LIMITS.sourceTextBytes,
      },
    );
  }

  const vodRows: VodRow[] = [];
  const songRows: SongRow[] = [];
  const performanceRows: PerformanceRow[] = [];
  for (const row of sourceQueryRows) {
    switch (row.row_kind) {
      case 'stats':
        break;
      case 'vod':
        vodRows.push({
          stream_id: row.entity_id as string,
          streamer_id: row.streamer_id as string,
          title: row.title,
          date: row.secondary_text,
          video_id: row.relation_id,
          status: row.status as string,
        });
        break;
      case 'song':
        songRows.push({
          row_id: row.row_id as string | number,
          song_id: row.entity_id,
          streamer_id: row.streamer_id as string,
          title: row.title,
          original_artist: row.secondary_text,
          status: row.status as string,
        });
        break;
      case 'performance':
        performanceRows.push({
          row_id: row.row_id as string | number,
          performance_id: row.entity_id,
          streamer_id: row.streamer_id as string,
          song_id: row.relation_id as string,
          stream_id: row.stream_id as string,
          start_storage_class: row.start_storage_class as string,
          start_decimal_text: row.start_decimal_text,
          end_storage_class: row.end_storage_class as string,
          end_decimal_text: row.end_decimal_text,
          status: row.status as string,
        });
        break;
      default: {
        const exhaustive: never = row.row_kind;
        throw new VodExportSourceError(
          'EXPORT_SOURCE_GUARD_MISMATCH',
          `Unexpected DB source row kind: ${String(exhaustive)}`,
          503,
        );
      }
    }
  }
  if (vodRows.length + songRows.length + performanceRows.length !== sourceRows) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISMATCH',
      'DB gated source row count does not match its preflight count',
      503,
    );
  }

  return {
    revision: parseState(state, 'DB'),
    sourceRows,
    sourceTextBytes,
    vods: vodRows.map((row) => ({
      streamId: row.stream_id,
      streamerId: row.streamer_id,
      title: row.title,
      date: row.date,
      videoId: row.video_id,
      status: row.status,
    })),
    songs: songRows.map((row) => ({
      rowId: parsePrivateRowId(row.row_id, 'song'),
      songId: row.song_id,
      streamerId: row.streamer_id,
      title: row.title,
      originalArtist: row.original_artist,
      status: row.status,
    })),
    performances: performanceRows.map((row) => ({
      rowId: parsePrivateRowId(row.row_id, 'performance'),
      performanceId: row.performance_id,
      streamerId: row.streamer_id,
      songId: row.song_id,
      streamId: row.stream_id,
      startSeconds: sqliteInteger(row.start_storage_class, row.start_decimal_text),
      endSeconds: sqliteInteger(row.end_storage_class, row.end_decimal_text),
      status: row.status,
    })),
  };
}

export async function readVodExportSource(
  bindings: VodExportSourceBindings,
  exporterBuildId: string,
): Promise<VodExportSourceRead> {
  assertFingerprintConfiguration(bindings, exporterBuildId);
  const nova = await readNovaSource(bindings.NOVA_DB);
  const streamerIds = [...new Set(
    nova.streamers
      .map((streamer) => streamer.slug)
      .filter((slug): slug is string => typeof slug === 'string'),
  )];
  const remainingTextBytes = VOD_EXPORT_LIMITS.sourceTextBytes - nova.sourceTextBytes;
  const admin = await readAdminSource(bindings.DB, streamerIds, remainingTextBytes);

  return {
    data: {
      streamers: nova.streamers,
      vods: admin.vods,
      songs: admin.songs,
      performances: admin.performances,
    },
    fingerprint: {
      dbId: bindings.VOD_EXPORT_DB_ID,
      dbRevision: admin.revision,
      novaDbId: bindings.VOD_EXPORT_NOVA_DB_ID,
      novaRevision: nova.revision,
      schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
      exporterBuildId,
    },
    sourceRows: admin.sourceRows,
    sourceTextBytes: nova.sourceTextBytes + admin.sourceTextBytes,
  };
}

export async function readRevision(
  db: D1Database,
  database: 'DB' | 'NOVA_DB',
): Promise<string> {
  const session = db.withSession('first-primary');
  const expected = database === 'DB' ? ADMIN_REVISION_TRIGGERS : NOVA_REVISION_TRIGGERS;
  const results = await session.batch<unknown>([
    session.prepare(STATE_SQL),
    session.prepare(triggerGuardSql(expected)),
  ]);
  const row = (results[0] as D1Result<StateRow>).results[0] ?? null;
  assertRequiredTriggers(
    (results[1] as D1Result<{ name: string }>).results,
    expected,
    database,
  );
  return parseState(row, database);
}

export async function readCurrentSourceFingerprint(
  bindings: VodExportSourceBindings,
  exporterBuildId: string,
): Promise<VodExportSourceFingerprint> {
  assertFingerprintConfiguration(bindings, exporterBuildId);
  const [dbRevision, novaRevision] = await Promise.all([
    readRevision(bindings.DB, 'DB'),
    readRevision(bindings.NOVA_DB, 'NOVA_DB'),
  ]);
  return {
    dbId: bindings.VOD_EXPORT_DB_ID,
    dbRevision,
    novaDbId: bindings.VOD_EXPORT_NOVA_DB_ID,
    novaRevision,
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    exporterBuildId,
  };
}

/**
 * Publication's ordered revision-vector fence: DB is the logical cutover read,
 * then NOVA_DB conservatively validates that its candidate state crossed it.
 */
export async function readOrderedPublicationFingerprint(
  bindings: VodExportSourceBindings,
  exporterBuildId: string,
): Promise<VodExportSourceFingerprint> {
  assertFingerprintConfiguration(bindings, exporterBuildId);
  const dbRevision = await readRevision(bindings.DB, 'DB');
  const novaRevision = await readRevision(bindings.NOVA_DB, 'NOVA_DB');
  return {
    dbId: bindings.VOD_EXPORT_DB_ID,
    dbRevision,
    novaDbId: bindings.VOD_EXPORT_NOVA_DB_ID,
    novaRevision,
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    exporterBuildId,
  };
}

export function sourceFingerprintsEqual(
  left: VodExportSourceFingerprint,
  right: VodExportSourceFingerprint,
): boolean {
  return left.dbId === right.dbId
    && left.dbRevision === right.dbRevision
    && left.novaDbId === right.novaDbId
    && left.novaRevision === right.novaRevision
    && left.schemaVersion === right.schemaVersion
    && left.exporterBuildId === right.exporterBuildId;
}

function assertFingerprintConfiguration(
  bindings: VodExportSourceBindings,
  exporterBuildId: string,
): void {
  if (
    typeof bindings.VOD_EXPORT_DB_ID !== 'string'
    || bindings.VOD_EXPORT_DB_ID.length === 0
    || typeof bindings.VOD_EXPORT_NOVA_DB_ID !== 'string'
    || bindings.VOD_EXPORT_NOVA_DB_ID.length === 0
    || typeof exporterBuildId !== 'string'
    || exporterBuildId.length === 0
  ) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISMATCH',
      'VOD export source fingerprint configuration is incomplete',
      503,
    );
  }
}

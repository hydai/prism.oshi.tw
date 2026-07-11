import { VOD_EXPORT_LIMITS, VOD_EXPORT_SCHEMA_VERSION } from './constants';
import { utf8ByteLength } from './normalization';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  OwnedVodExportSourceData,
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
const DB_SOURCE_LIMIT_BOUND_PARAMETERS = 5;
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
  data: OwnedVodExportSourceData;
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

type VodRow = ExportSourceVod;
type SongRow = Omit<ExportSourceSong, 'rowId'> & { rowId: string | number };
type PerformanceRow = Omit<ExportSourcePerformance, 'rowId' | 'startDecimalText' | 'endDecimalText'> & {
  rowId: string | number;
  startDecimalText: string | number | null;
  endDecimalText: string | number | null;
};

interface AdminStatsRow {
  source_rows: number | string | null;
  loaded_source_rows: number | string | null;
  source_text_bytes: number | string | null;
  eligible_vod_count: number | string | null;
  eligible_performance_count: number | string | null;
  relationship_finding_count: number | string | null;
}

interface StreamerScopeBinding {
  kind: 'blob' | 'direct' | 'fragment';
  value: Uint8Array | string;
  fragmentGroup?: number;
  fragmentPart?: number;
  fragmentLast?: number;
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
    ) OR s.id IN (SELECT p.stream_id FROM scoped_performances p)
  ),
  scoped_songs AS (
    SELECT s.rowid AS source_row_id, s.*
    FROM songs s
    WHERE (
      s.status = 'approved'
      AND s.streamer_id IN (SELECT streamer_id FROM selected_streamers)
    ) OR s.id IN (SELECT p.song_id FROM scoped_performances p)
  ),
  classified_performances AS (
    SELECT
      p.*,
      CASE WHEN v.source_row_id IS NULL THEN 1 ELSE 0 END AS missing_vod,
      CASE WHEN song.source_row_id IS NULL THEN 1 ELSE 0 END AS missing_song,
      CASE WHEN v.source_row_id IS NOT NULL AND v.streamer_id <> p.streamer_id THEN 1 ELSE 0 END AS vod_mismatch,
      CASE WHEN song.source_row_id IS NOT NULL AND song.streamer_id <> p.streamer_id THEN 1 ELSE 0 END AS song_mismatch,
      CASE WHEN
        v.source_row_id IS NOT NULL
        AND song.source_row_id IS NOT NULL
        AND v.streamer_id = p.streamer_id
        AND song.streamer_id = p.streamer_id
        AND v.status = 'approved'
        AND song.status = 'approved'
      THEN 1 ELSE 0 END AS is_eligible
    FROM scoped_performances p
    LEFT JOIN scoped_streams v ON v.id = p.stream_id
    LEFT JOIN scoped_songs song ON song.id = p.song_id
  ),
  selected_performances AS (
    SELECT *
    FROM classified_performances
    WHERE is_eligible = 1
      OR missing_vod = 1
      OR missing_song = 1
      OR vod_mismatch = 1
      OR song_mismatch = 1
  ),
  selected_streams AS (
    SELECT s.*
    FROM scoped_streams s
    WHERE s.id IN (SELECT p.stream_id FROM selected_performances p)
  ),
  selected_songs AS (
    SELECT s.*
    FROM scoped_songs s
    WHERE s.id IN (SELECT p.song_id FROM selected_performances p)
  ),
  stats AS (
    SELECT
      (
        (SELECT COUNT(*) FROM scoped_streams) +
        (SELECT COUNT(*) FROM scoped_songs) +
        (SELECT COUNT(*) FROM scoped_performances)
      ) AS source_rows,
      (
        (SELECT COUNT(*) FROM selected_streams) +
        (SELECT COUNT(*) FROM selected_songs) +
        (SELECT COUNT(*) FROM selected_performances)
      ) AS loaded_source_rows,
      (SELECT COUNT(DISTINCT stream_id) FROM classified_performances WHERE is_eligible = 1)
        AS eligible_vod_count,
      (SELECT COUNT(*) FROM classified_performances WHERE is_eligible = 1)
        AS eligible_performance_count,
      COALESCE((SELECT SUM(missing_vod + missing_song + vod_mismatch + song_mismatch)
        FROM classified_performances), 0) AS relationship_finding_count,
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

function dbStatsSql(scopeCte: string): string {
  return `${scopeCte}${DB_SCOPED_CTE_SUFFIX}
    SELECT
      source_rows,
      loaded_source_rows,
      source_text_bytes,
      eligible_vod_count,
      eligible_performance_count,
      relationship_finding_count
    FROM stats
  `;
}

function dbVodRowsSql(scopeCte: string): string {
  return `${scopeCte}${DB_SCOPED_CTE_SUFFIX}
    SELECT
      id AS streamId,
      streamer_id AS streamerId,
      title,
      date,
      video_id AS videoId,
      status
    FROM selected_streams s
    WHERE (SELECT
      source_rows <= ?
      AND source_text_bytes <= ?
      AND eligible_vod_count <= ?
      AND eligible_performance_count <= ?
      AND relationship_finding_count <= ?
    FROM stats)
    ORDER BY COALESCE(id, ''), CAST(source_row_id AS TEXT)
  `;
}

function dbSongRowsSql(scopeCte: string): string {
  return `${scopeCte}${DB_SCOPED_CTE_SUFFIX}
    SELECT
      CAST(source_row_id AS TEXT) AS rowId,
      id AS songId,
      streamer_id AS streamerId,
      title,
      original_artist AS originalArtist,
      status
    FROM selected_songs s
    WHERE (SELECT
      source_rows <= ?
      AND source_text_bytes <= ?
      AND eligible_vod_count <= ?
      AND eligible_performance_count <= ?
      AND relationship_finding_count <= ?
    FROM stats)
    ORDER BY COALESCE(id, ''), CAST(source_row_id AS TEXT)
  `;
}

function dbPerformanceRowsSql(scopeCte: string): string {
  return `${scopeCte}${DB_SCOPED_CTE_SUFFIX}
    SELECT
      CAST(source_row_id AS TEXT) AS rowId,
      id AS performanceId,
      streamer_id AS streamerId,
      song_id AS songId,
      stream_id AS streamId,
      typeof(timestamp) AS startStorageClass,
      CAST(timestamp AS TEXT) AS startDecimalText,
      typeof(end_timestamp) AS endStorageClass,
      CAST(end_timestamp AS TEXT) AS endDecimalText,
      status
    FROM selected_performances
    WHERE (SELECT
      source_rows <= ?
      AND source_text_bytes <= ?
      AND eligible_vod_count <= ?
      AND eligible_performance_count <= ?
      AND relationship_finding_count <= ?
    FROM stats)
    ORDER BY COALESCE(id, ''), CAST(source_row_id AS TEXT)
  `;
}

function buildStreamerScope(streamerIds: readonly string[]): StreamerScope {
  const encodedBindings: StreamerScopeBinding[] = [];
  let pendingPayload: Uint8Array | null = null;
  let pendingBytes = 0;
  let fragmentGroup = 0;

  const flushBlob = (): void => {
    if (pendingPayload === null || pendingBytes === 0) return;
    const payload = pendingBytes === pendingPayload.byteLength
      ? pendingPayload
      : pendingPayload.slice(0, pendingBytes);
    encodedBindings.push({ kind: 'blob', value: payload });
    pendingPayload = null;
    pendingBytes = 0;
  };

  for (const streamerId of streamerIds) {
    const valueByteLength = utf8ByteLength(streamerId);

    if (valueByteLength > D1_MAX_BOUND_VALUE_BYTES) {
      flushBlob();
      const chunks = splitUtf8Text(streamerId, STREAMER_SCOPE_BLOB_TARGET_BYTES);
      const lastPart = chunks.length - 1;
      for (let part = 0; part < chunks.length; part += 1) {
        const chunk = chunks[part];
        if (chunk === undefined) continue;
        encodedBindings.push({
          kind: 'fragment',
          value: chunk,
          fragmentGroup,
          fragmentPart: part,
          fragmentLast: lastPart,
        });
      }
      fragmentGroup += 1;
      continue;
    }

    const lengthText = String(valueByteLength).padStart(
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
    const entryByteLength = STREAMER_SCOPE_LENGTH_PREFIX_BYTES + valueByteLength;

    // The framing bytes can push an otherwise legal D1 string over the BLOB
    // limit. Bind that one original string directly instead.
    if (entryByteLength > STREAMER_SCOPE_BLOB_TARGET_BYTES) {
      flushBlob();
      encodedBindings.push({ kind: 'direct', value: streamerId });
      continue;
    }
    if (pendingBytes + entryByteLength > STREAMER_SCOPE_BLOB_TARGET_BYTES) flushBlob();
    if (pendingPayload === null) pendingPayload = new Uint8Array(STREAMER_SCOPE_BLOB_TARGET_BYTES);
    for (let index = 0; index < lengthText.length; index += 1) {
      pendingPayload[pendingBytes + index] = lengthText.charCodeAt(index);
    }
    pendingBytes += STREAMER_SCOPE_LENGTH_PREFIX_BYTES;
    const encoded = textEncoder.encodeInto(streamerId, pendingPayload.subarray(pendingBytes));
    if (encoded.read !== streamerId.length || encoded.written !== valueByteLength) {
      throw new VodExportSourceError(
        'EXPORT_SOURCE_GUARD_MISMATCH',
        'A streamer scope key could not be encoded exactly',
        503,
      );
    }
    pendingBytes += encoded.written;
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
    ? ['SELECT NULL AS payload, NULL AS direct_value, NULL AS fragment_group, NULL AS fragment_part, NULL AS fragment_last, NULL AS fragment_value WHERE 0']
    : encodedBindings.map((binding) => {
      if (binding.kind === 'blob') {
        return 'SELECT CAST(? AS BLOB) AS payload, NULL AS direct_value, NULL AS fragment_group, NULL AS fragment_part, NULL AS fragment_last, NULL AS fragment_value';
      }
      if (binding.kind === 'direct') {
        return 'SELECT NULL AS payload, CAST(? AS TEXT) AS direct_value, NULL AS fragment_group, NULL AS fragment_part, NULL AS fragment_last, NULL AS fragment_value';
      }
      return `SELECT NULL AS payload, NULL AS direct_value, ${binding.fragmentGroup ?? 0} AS fragment_group, ${binding.fragmentPart ?? 0} AS fragment_part, ${binding.fragmentLast ?? 0} AS fragment_last, CAST(? AS TEXT) AS fragment_value`;
    });
  const byteLength = (expression: string): string =>
    `CAST(CAST(substr(${expression}, 1, ${STREAMER_SCOPE_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER)`;
  const firstLength = byteLength('payload');
  const nextLength = byteLength('rest');

  return {
    cteSql: `
      WITH RECURSIVE
      scope_sources(payload, direct_value, fragment_group, fragment_part, fragment_last, fragment_value) AS (
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
      assembled_fragments(fragment_group, fragment_part, fragment_last, streamer_id) AS (
        SELECT fragment_group, fragment_part, fragment_last, fragment_value
        FROM scope_sources
        WHERE fragment_part = 0
        UNION ALL
        SELECT
          assembled.fragment_group,
          next.fragment_part,
          assembled.fragment_last,
          assembled.streamer_id || next.fragment_value
        FROM assembled_fragments assembled
        JOIN scope_sources next
          ON next.fragment_group = assembled.fragment_group
          AND next.fragment_part = assembled.fragment_part + 1
        WHERE assembled.fragment_part < assembled.fragment_last
      ),
      selected_streamers(streamer_id) AS (
        SELECT streamer_id FROM decoded_scope
        UNION ALL
        SELECT direct_value FROM scope_sources WHERE direct_value IS NOT NULL
        UNION ALL
        SELECT streamer_id FROM assembled_fragments WHERE fragment_part = fragment_last
      )
    `,
    bindings: encodedBindings.map((binding) => binding.value),
  };
}

function splitUtf8Text(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let chunkStart = 0;
  let chunkBytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let scalarBytes: number;
    let width = 1;
    if (first <= 0x7f) scalarBytes = 1;
    else if (first <= 0x7ff) scalarBytes = 2;
    else if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        scalarBytes = 4;
        width = 2;
      } else {
        scalarBytes = 3;
      }
    } else scalarBytes = 3;

    if (chunkBytes + scalarBytes > maxBytes) {
      chunks.push(value.slice(chunkStart, index));
      chunkStart = index;
      chunkBytes = 0;
    }
    chunkBytes += scalarBytes;
    if (width === 2) index += 1;
  }
  chunks.push(value.slice(chunkStart));
  return chunks;
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
  const boundedRows = (sql: string): D1PreparedStatement => session.prepare(sql).bind(
    ...streamerScope.bindings,
    VOD_EXPORT_LIMITS.sourceRows,
    remainingTextBytes,
    VOD_EXPORT_LIMITS.vods,
    VOD_EXPORT_LIMITS.performances,
    VOD_EXPORT_LIMITS.findings,
  );
  const results = await session.batch<unknown>([
    session.prepare(STATE_SQL),
    session.prepare(triggerGuardSql(ADMIN_REVISION_TRIGGERS)),
    session.prepare(dbStatsSql(streamerScope.cteSql)).bind(...streamerScope.bindings),
    boundedRows(dbVodRowsSql(streamerScope.cteSql)),
    boundedRows(dbSongRowsSql(streamerScope.cteSql)),
    boundedRows(dbPerformanceRowsSql(streamerScope.cteSql)),
  ]);

  const state = requireFirstRow(results[0] as D1Result<StateRow>, 'DB state');
  assertRequiredTriggers(
    (results[1] as D1Result<{ name: string }>).results,
    ADMIN_REVISION_TRIGGERS,
    'DB',
  );
  const stats = requireFirstRow(results[2] as D1Result<AdminStatsRow>, 'DB source stats');
  const sourceRows = numberFromAggregate(stats.source_rows, 'sourceRows');
  const loadedSourceRows = numberFromAggregate(stats.loaded_source_rows, 'loadedSourceRows');
  const sourceTextBytes = numberFromAggregate(stats.source_text_bytes, 'sourceTextBytes');
  const eligibleVodCount = numberFromAggregate(stats.eligible_vod_count, 'eligibleVodCount');
  const eligiblePerformanceCount = numberFromAggregate(
    stats.eligible_performance_count,
    'eligiblePerformanceCount',
  );
  const relationshipFindingCount = numberFromAggregate(
    stats.relationship_finding_count,
    'relationshipFindingCount',
  );

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
  if (eligibleVodCount > VOD_EXPORT_LIMITS.vods) {
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Emitted VOD limit exceeded',
      422,
      { resource: 'vods', actual: eligibleVodCount, limit: VOD_EXPORT_LIMITS.vods },
    );
  }
  if (eligiblePerformanceCount > VOD_EXPORT_LIMITS.performances) {
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Emitted performance limit exceeded',
      422,
      {
        resource: 'performances',
        actual: eligiblePerformanceCount,
        limit: VOD_EXPORT_LIMITS.performances,
      },
    );
  }
  if (relationshipFindingCount > VOD_EXPORT_LIMITS.findings) {
    throw new VodExportSourceError(
      'EXPORT_LIMIT_EXCEEDED',
      'Relationship finding limit exceeded',
      422,
      { resource: 'findings', actual: relationshipFindingCount, limit: VOD_EXPORT_LIMITS.findings },
    );
  }

  const vodRows = (results[3] as D1Result<VodRow>).results;
  const songRows = (results[4] as D1Result<SongRow>).results;
  const performanceRows = (results[5] as D1Result<PerformanceRow>).results;
  if (vodRows.length + songRows.length + performanceRows.length !== loadedSourceRows) {
    throw new VodExportSourceError(
      'EXPORT_SOURCE_GUARD_MISMATCH',
      'DB loaded source row count does not match its transactional preflight count',
      503,
    );
  }

  for (const row of songRows) row.rowId = parsePrivateRowId(row.rowId, 'song');
  for (const row of performanceRows) {
    row.rowId = parsePrivateRowId(row.rowId, 'performance');
    row.startDecimalText = row.startDecimalText === null ? null : String(row.startDecimalText);
    row.endDecimalText = row.endDecimalText === null ? null : String(row.endDecimalText);
  }
  const vods = vodRows;
  const songs = songRows as ExportSourceSong[];
  const performances = performanceRows as ExportSourcePerformance[];

  return {
    revision: parseState(state, 'DB'),
    sourceRows,
    sourceTextBytes,
    vods,
    songs,
    performances,
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
      preflightCapacity: {
        sourceRows: admin.sourceRows,
        sourceTextBytes: nova.sourceTextBytes + admin.sourceTextBytes,
      },
    } as OwnedVodExportSourceData,
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

import {
  candidateDownloadHeaders,
  deleteCandidateById,
  getCandidate,
  readAndVerifyCandidateBytes,
  VodExportCandidateError,
  type VodExportCandidateMetadata,
} from './candidate';
import { CanonicalJsonError } from './canonical-json';
import { VodExportControlError } from './control';
import { capacityDiagnostic, ExportLimitExceededError } from './limits';
import { VOD_EXPORT_LIMITS } from './constants';
import { findingJsonByteLength } from './findings';
import { VodExportMaintenanceError } from './maintenance';
import {
  readCurrentManifest,
  stableCandidateState,
  VodExportPublicationError,
  type VodExportPublicationBindings,
} from './publication';
import { VodExportR2Error } from './r2';
import { generateVodExportPreview, VodExportServiceError } from './service';
import {
  readCurrentSourceFingerprint,
  sourceFingerprintsEqual,
  VodExportSourceError,
} from './source';
import { jsonStringByteLength, utf8ByteLength } from './normalization';
import { createCompactJsonStream } from './json-stream';
import type { CapacityDiagnostic, VodExportFinding } from './types';

export type VodExportCandidateApiState = 'ready' | 'stale' | 'expired' | 'already_published';

export interface VodExportCandidateApi {
  candidateId: string;
  schemaVersion: string;
  sha256: string;
  uncompressedBytes: number;
  counts: VodExportCandidateMetadata['counts'];
  generatedAt: string;
  expiresAt: string;
  state?: VodExportCandidateApiState;
}

export interface VodExportFindingApi extends VodExportFinding {
  repairPath?: string;
}

export interface VodExportPreviewApiResult {
  canPublish: boolean;
  findings: VodExportFindingApi[];
  candidate: VodExportCandidateApi | null;
  capacity: CapacityDiagnostic[];
}

export interface VodExportHttpError {
  status: number;
  body: {
    error: string;
    code: string;
    diagnostics?: CapacityDiagnostic[];
  };
}

export function vodExportPreviewApiResponse(result: VodExportPreviewApiResult): Response {
  return new Response(createCompactJsonStream(result), {
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

export type VodExportRepairRecord =
  | VodExportPerformanceRepairRecord
  | VodExportSongRepairRecord
  | VodExportVodRepairRecord
  | VodExportStreamerRepairRecord;

export interface VodExportPerformanceRepairRecord {
  entity: 'performance';
  rowId: number;
  id: string | null;
  streamerId: string | null;
  songId: string | null;
  streamId: string | null;
  startSeconds: string | null;
  startStorageClass: string;
  endSeconds: string | null;
  endStorageClass: string;
  status: string | null;
  referencedSong: null | {
    id: string | null;
    streamerId: string | null;
    title: string | null;
    status: string | null;
  };
  referencedVod: null | {
    id: string | null;
    streamerId: string | null;
    title: string | null;
    status: string | null;
  };
}

export interface VodExportSongRepairRecord {
  entity: 'song';
  rowId: number;
  id: string | null;
  streamerId: string | null;
  title: string | null;
  originalArtist: string | null;
  status: string | null;
  performanceCount: number;
}

export interface VodExportVodRepairRecord {
  entity: 'vod';
  rowId: number;
  id: string | null;
  streamerId: string | null;
  title: string | null;
  date: string | null;
  videoId: string | null;
  status: string | null;
}

export interface VodExportStreamerRepairRecord {
  entity: 'streamer';
  rowId: number;
  id: string | null;
  slug: string | null;
  displayName: string | null;
  youtubeChannelId: string | null;
  enabled: boolean;
  status: string | null;
}

export class VodExportRepairError extends Error {
  readonly code = 'VOD_EXPORT_REPAIR_RECORD_NOT_FOUND' as const;
  readonly status = 404 as const;

  constructor() {
    super('VOD export source record not found');
    this.name = 'VodExportRepairError';
  }
}

export async function generateVodExportPreviewApi(
  bindings: VodExportPublicationBindings,
  exporterBuildId: string,
): Promise<VodExportPreviewApiResult> {
  const result = await generateVodExportPreview(bindings, exporterBuildId);
  if (result.candidate !== undefined) {
    try {
      return await candidateMetadataForApi(bindings, result.candidate, exporterBuildId);
    } catch (error) {
      if (error instanceof ExportLimitExceededError) {
        try {
          await deleteCandidateById(bindings.VOD_EXPORT_PRIVATE, result.candidate.candidateId);
        } catch (cleanupError) {
          console.error(JSON.stringify({
            event: 'vod_export_over_capacity_candidate_cleanup_failed',
            error: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
          }));
        }
      }
      throw error;
    }
  }
  const findings = await findingsForApi(bindings, result.findings);
  const capacity = withApiFindingsCapacity(result.capacity, result.canPublish, findings);
  return {
    canPublish: result.canPublish,
    findings,
    candidate: null,
    capacity,
  };
}

export async function getVodExportCandidateApi(
  bindings: VodExportPublicationBindings,
  candidateId: string,
  exporterBuildId: string,
  now = new Date(),
): Promise<VodExportPreviewApiResult> {
  const stored = await getCandidate(bindings.VOD_EXPORT_PRIVATE, candidateId, { now });
  return candidateMetadataForApi(bindings, stored.metadata, exporterBuildId);
}

async function candidateMetadataForApi(
  bindings: VodExportPublicationBindings,
  metadata: VodExportCandidateMetadata,
  exporterBuildId: string,
): Promise<VodExportPreviewApiResult> {
  const [fingerprint, current] = await Promise.all([
    readCurrentSourceFingerprint(bindings, exporterBuildId),
    readCurrentManifest(bindings.VOD_EXPORT_PUBLIC, { verifySnapshot: false }),
  ]);
  const stale = !sourceFingerprintsEqual(metadata.sourceFingerprint, fingerprint);
  const state: VodExportCandidateApiState = stale
    ? 'stale'
    : stableCandidateState(current?.manifest ?? null, metadata)
      ? 'already_published'
      : 'ready';
  const findings = await findingsForApi(bindings, metadata.findings);
  const capacity = withApiFindingsCapacity(metadata.capacity, state !== 'stale', findings);
  return {
    // Stable-identical bytes still require an explicit curator action to move
    // the source-equivalence checkpoint without rewriting public artifacts.
    canPublish: state !== 'stale',
    findings,
    candidate: candidateForApi(metadata, state),
    capacity,
  };
}

export async function downloadVodExportCandidate(
  bindings: VodExportPublicationBindings,
  candidateId: string,
  now = new Date(),
): Promise<Response> {
  const stored = await getCandidate(bindings.VOD_EXPORT_PRIVATE, candidateId, { now });
  const bytes = await readAndVerifyCandidateBytes(bindings.VOD_EXPORT_PRIVATE, stored.metadata);
  return new Response(bytes, { headers: candidateDownloadHeaders(stored.metadata) });
}

export function normalizeVodExportError(error: unknown): VodExportHttpError {
  if (error instanceof VodExportServiceError) {
    const diagnostics = error.code === 'EXPORT_LIMIT_EXCEEDED'
      ? diagnosticFromDetails(error.details)
      : undefined;
    return knownError(error.status, error.code, error.message, diagnostics);
  }
  if (
    error instanceof VodExportCandidateError
    || error instanceof VodExportControlError
    || error instanceof VodExportPublicationError
    || error instanceof VodExportSourceError
    || error instanceof VodExportR2Error
    || error instanceof VodExportMaintenanceError
    || error instanceof VodExportRepairError
  ) {
    return knownError(error.status, error.code, error.message);
  }
  if (error instanceof ExportLimitExceededError) {
    return knownError(error.httpStatus, error.code, error.message, [error.diagnostic]);
  }
  if (error instanceof CanonicalJsonError) {
    return knownError(503, 'EXPORT_SERIALIZATION_FAILED', 'VOD export canonical serialization failed');
  }
  console.error(JSON.stringify({
    event: 'vod_export_unhandled_error',
    error: error instanceof Error ? error.message : 'Unknown error',
  }));
  return knownError(500, 'VOD_EXPORT_INTERNAL_ERROR', 'The VOD export operation failed unexpectedly');
}

export async function getVodExportRepairRecord(
  bindings: Pick<VodExportPublicationBindings, 'DB' | 'NOVA_DB'>,
  entity: 'performance' | 'song' | 'vod' | 'streamer',
  rowId: number,
): Promise<VodExportRepairRecord> {
  if (!Number.isSafeInteger(rowId) || rowId <= 0) throw new VodExportRepairError();

  if (entity === 'song') {
    const row = await bindings.DB.prepare(`
      SELECT s.rowid AS row_id, s.id, s.streamer_id, s.title,
             s.original_artist, s.status,
             (SELECT COUNT(*) FROM performances p WHERE p.song_id IS s.id) AS performance_count
      FROM songs s
      WHERE s.rowid = ?
    `).bind(rowId).first<{
      row_id: number;
      id: string | null;
      streamer_id: string | null;
      title: string | null;
      original_artist: string | null;
      status: string | null;
      performance_count: number;
    }>();
    if (row === null) throw new VodExportRepairError();
    return {
      entity: 'song',
      rowId: Number(row.row_id),
      id: row.id,
      streamerId: row.streamer_id,
      title: row.title,
      originalArtist: row.original_artist,
      status: row.status,
      performanceCount: Number(row.performance_count),
    };
  }

  if (entity === 'vod') {
    const row = await bindings.DB.prepare(`
      SELECT rowid AS row_id, id, streamer_id, title, date, video_id, status
      FROM streams
      WHERE rowid = ?
    `).bind(rowId).first<Record<string, string | number | null>>();
    if (row === null) throw new VodExportRepairError();
    return {
      entity: 'vod',
      rowId: Number(row.row_id),
      id: valueOrNull(row.id),
      streamerId: valueOrNull(row.streamer_id),
      title: valueOrNull(row.title),
      date: valueOrNull(row.date),
      videoId: valueOrNull(row.video_id),
      status: valueOrNull(row.status),
    };
  }

  if (entity === 'streamer') {
    const row = await bindings.NOVA_DB.prepare(`
      SELECT rowid AS row_id, id, slug, display_name, youtube_channel_id, enabled, status
      FROM submissions
      WHERE rowid = ?
    `).bind(rowId).first<Record<string, string | number | null>>();
    if (row === null) throw new VodExportRepairError();
    return {
      entity: 'streamer',
      rowId: Number(row.row_id),
      id: valueOrNull(row.id),
      slug: valueOrNull(row.slug),
      displayName: valueOrNull(row.display_name),
      youtubeChannelId: valueOrNull(row.youtube_channel_id),
      enabled: Number(row.enabled) === 1,
      status: valueOrNull(row.status),
    };
  }

  const row = await bindings.DB.prepare(`
    SELECT
      p.rowid AS row_id,
      p.id,
      p.streamer_id,
      p.song_id,
      p.stream_id,
      CAST(p.timestamp AS TEXT) AS start_seconds,
      typeof(p.timestamp) AS start_storage_class,
      CAST(p.end_timestamp AS TEXT) AS end_seconds,
      typeof(p.end_timestamp) AS end_storage_class,
      p.status,
      s.rowid AS song_row_id,
      s.id AS parent_song_id,
      s.streamer_id AS song_streamer_id,
      s.title AS song_title,
      s.status AS song_status,
      v.rowid AS vod_row_id,
      v.id AS parent_vod_id,
      v.streamer_id AS vod_streamer_id,
      v.title AS vod_title,
      v.status AS vod_status
    FROM performances p
    LEFT JOIN songs s ON s.id = p.song_id
    LEFT JOIN streams v ON v.id = p.stream_id
    WHERE p.rowid = ?
  `).bind(rowId).first<Record<string, string | number | null>>();
  if (row === null) throw new VodExportRepairError();
  return {
    entity: 'performance',
    rowId: Number(row.row_id),
    id: valueOrNull(row.id),
    streamerId: valueOrNull(row.streamer_id),
    songId: valueOrNull(row.song_id),
    streamId: valueOrNull(row.stream_id),
    startSeconds: valueOrNull(row.start_seconds),
    startStorageClass: String(row.start_storage_class),
    endSeconds: valueOrNull(row.end_seconds),
    endStorageClass: String(row.end_storage_class),
    status: valueOrNull(row.status),
    referencedSong: row.song_row_id === null
      ? null
      : {
          id: valueOrNull(row.parent_song_id),
          streamerId: valueOrNull(row.song_streamer_id),
          title: valueOrNull(row.song_title),
          status: valueOrNull(row.song_status),
        },
    referencedVod: row.vod_row_id === null
      ? null
      : {
          id: valueOrNull(row.parent_vod_id),
          streamerId: valueOrNull(row.vod_streamer_id),
          title: valueOrNull(row.vod_title),
          status: valueOrNull(row.vod_status),
        },
  };
}

function valueOrNull(value: string | number | null): string | null {
  return value === null ? null : String(value);
}

function candidateForApi(
  candidate: VodExportCandidateMetadata,
  state: VodExportCandidateApiState,
): VodExportCandidateApi {
  return {
    candidateId: candidate.candidateId,
    schemaVersion: candidate.schemaVersion,
    sha256: candidate.sha256,
    uncompressedBytes: candidate.uncompressedBytes,
    counts: candidate.counts,
    generatedAt: candidate.generatedAt,
    expiresAt: candidate.expiresAt,
    state,
  };
}

async function findingsForApi(
  bindings: Pick<VodExportPublicationBindings, 'DB' | 'NOVA_DB'>,
  findings: readonly VodExportFinding[],
): Promise<VodExportFindingApi[]> {
  const performanceIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'performance' && finding.entityId !== undefined)
    .map((finding) => finding.entityId!))];
  const songIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'song' && finding.entityId !== undefined)
    .map((finding) => finding.entityId!))];
  const vodIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'vod' && finding.entityId !== undefined)
    .map((finding) => finding.entityId!))];
  const vodStreamIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'vod' && finding.details?.streamId !== undefined)
    .map((finding) => finding.details!.streamId!))];
  const submissionIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'streamer' && finding.details?.submissionId !== undefined)
    .map((finding) => finding.details!.submissionId!))];
  const lookupWorkspace = createD1LookupWorkspace();
  const performances = await lookupPerformanceRepairRows(bindings.DB, performanceIds, lookupWorkspace);
  const songs = await lookupSongRepairRows(bindings.DB, songIds, lookupWorkspace);
  const streams = await lookupVodRepairRows(bindings.DB, vodIds, vodStreamIds, lookupWorkspace);
  const submissions = await lookupStreamerRepairRows(bindings.NOVA_DB, submissionIds, lookupWorkspace);
  const performanceById = new Map(performances
    .filter((row): row is { id: string; row_id: number } => typeof row.id === 'string')
    .map((row) => [row.id, Number(row.row_id)]));
  const songById = new Map(songs
    .filter((row): row is { id: string; row_id: number } => typeof row.id === 'string')
    .map((row) => [row.id, Number(row.row_id)]));
  const streamByIdentity = new Map(
    streams.map((row) => [`${row.streamer_id}\u0000${row.video_id}`, Number(row.row_id)]),
  );
  const streamById = new Map(streams.map((row) => [row.id, Number(row.row_id)]));
  const submissionById = new Map(submissions.map((row) => [row.id, Number(row.row_id)]));
  const decorated = findings as VodExportFindingApi[];
  for (const finding of decorated) {
    const repairPath = repairPathForFinding(
      finding,
      performanceById,
      songById,
      streamByIdentity,
      streamById,
      submissionById,
    );
    if (repairPath !== undefined) finding.repairPath = repairPath;
  }
  return decorated;
}

// A smaller reusable frame costs a few more curator-only D1 reads at the
// diagnostic ceiling, but preserves enough isolate headroom for the response
// stream and the 10 MiB candidate bytes to coexist safely.
const D1_LOOKUP_PAYLOAD_TARGET_BYTES = 512_000;
const D1_MAX_BOUND_VALUE_BYTES = 2_000_000;
const D1_LOOKUP_LENGTH_PREFIX_BYTES = 8;
const d1LookupTextEncoder = new TextEncoder();

export interface D1LookupBindingStats {
  packedBindings: number;
  directBindings: number;
  skippedValues: number;
}

export interface D1LookupWorkspace {
  buffer: Uint8Array;
}

export type D1LookupBinding =
  | { kind: 'packed'; value: Uint8Array }
  | { kind: 'direct'; value: string | number };

function createD1LookupWorkspace(): D1LookupWorkspace {
  return {
    buffer: new Uint8Array(D1_LOOKUP_LENGTH_PREFIX_BYTES + D1_LOOKUP_PAYLOAD_TARGET_BYTES),
  };
}

async function lookupPerformanceRepairRows(
  db: D1Database,
  ids: readonly string[],
  workspace: D1LookupWorkspace,
): Promise<Array<{ id: string | null; row_id: number }>> {
  return lookupRepairRows<{ id: string | null; row_id: number }>(
    db, 'performances', 'id', 'id, rowid AS row_id', ids, workspace,
  );
}

async function lookupSongRepairRows(
  db: D1Database,
  ids: readonly string[],
  workspace: D1LookupWorkspace,
): Promise<Array<{ id: string | null; row_id: number }>> {
  return lookupRepairRows<{ id: string | null; row_id: number }>(
    db, 'songs', 'id', 'id, rowid AS row_id', ids, workspace,
  );
}

async function lookupVodRepairRows(
  db: D1Database,
  videoIds: readonly string[],
  streamIds: readonly string[],
  workspace: D1LookupWorkspace,
): Promise<Array<{ row_id: number; id: string; streamer_id: string; video_id: string }>> {
  type VodRepairRow = { row_id: number; id: string; streamer_id: string; video_id: string };
  const columns = 'rowid AS row_id, id, streamer_id, video_id';
  return [
    ...await lookupRepairRows<VodRepairRow>(db, 'streams', 'video_id', columns, videoIds, workspace),
    ...await lookupRepairRows<VodRepairRow>(db, 'streams', 'id', columns, streamIds, workspace),
  ];
}

async function lookupStreamerRepairRows(
  db: D1Database,
  submissionIds: readonly string[],
  workspace: D1LookupWorkspace,
): Promise<Array<{ row_id: number; id: string }>> {
  return lookupRepairRows<{ row_id: number; id: string }>(
    db, 'submissions', 'id', 'rowid AS row_id, id', submissionIds, workspace,
  );
}

async function lookupRepairRows<T>(
  db: D1Database,
  table: 'performances' | 'songs' | 'streams' | 'submissions',
  column: 'id' | 'video_id',
  columns: string,
  values: readonly (string | number)[],
  workspace: D1LookupWorkspace,
): Promise<T[]> {
  const rows: T[] = [];
  await forEachD1LookupBinding(values, async (binding) => {
    const sql = binding.kind === 'packed'
      ? packedLookupSql(table, column, columns)
      : `SELECT ${columns} FROM ${table} WHERE ${column} = ?`;
    const result = await db.prepare(sql).bind(binding.value).all<T>();
    rows.push(...result.results);
  }, workspace);
  return rows;
}

export function packedLookupSql(
  table: string,
  column: string,
  columns: string,
): string {
  return `
    WITH RECURSIVE
    bound(raw) AS (SELECT CAST(? AS BLOB)),
    packed(payload) AS (
      SELECT substr(
        raw,
        ${D1_LOOKUP_LENGTH_PREFIX_BYTES + 1},
        CAST(CAST(substr(raw, 1, ${D1_LOOKUP_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER)
      )
      FROM bound
    ),
    decoded(value, rest) AS (
      SELECT
        CAST(substr(payload, ${D1_LOOKUP_LENGTH_PREFIX_BYTES + 1}, CAST(CAST(substr(payload, 1, ${D1_LOOKUP_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER)) AS TEXT),
        substr(payload, ${D1_LOOKUP_LENGTH_PREFIX_BYTES + 1} + CAST(CAST(substr(payload, 1, ${D1_LOOKUP_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER))
      FROM packed
      WHERE length(payload) >= ${D1_LOOKUP_LENGTH_PREFIX_BYTES}
      UNION ALL
      SELECT
        CAST(substr(rest, ${D1_LOOKUP_LENGTH_PREFIX_BYTES + 1}, CAST(CAST(substr(rest, 1, ${D1_LOOKUP_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER)) AS TEXT),
        substr(rest, ${D1_LOOKUP_LENGTH_PREFIX_BYTES + 1} + CAST(CAST(substr(rest, 1, ${D1_LOOKUP_LENGTH_PREFIX_BYTES}) AS TEXT) AS INTEGER))
      FROM decoded
      WHERE length(rest) >= ${D1_LOOKUP_LENGTH_PREFIX_BYTES}
    )
    SELECT ${columns}
    FROM ${table}
    WHERE ${column} IN (SELECT value FROM decoded)
  `;
}

/** Reuses one bounded buffer; consumers must finish reading it before resolving. */
export async function forEachD1LookupBinding(
  values: readonly (string | number)[],
  consume: (binding: D1LookupBinding) => Promise<void>,
  workspace: D1LookupWorkspace = createD1LookupWorkspace(),
): Promise<D1LookupBindingStats> {
  let packedBindings = 0;
  let directBindings = 0;
  let skippedValues = 0;
  let payloadBytes = 0;

  const flush = async (): Promise<void> => {
    if (payloadBytes === 0) return;
    const lengthText = String(payloadBytes).padStart(D1_LOOKUP_LENGTH_PREFIX_BYTES, '0');
    for (let index = 0; index < lengthText.length; index += 1) {
      workspace.buffer[index] = lengthText.charCodeAt(index);
    }
    await consume({ kind: 'packed', value: workspace.buffer });
    packedBindings += 1;
    payloadBytes = 0;
  };

  for (const value of values) {
    const textValue = String(value);
    const valueBytes = utf8ByteLength(textValue);
    const entryBytes = D1_LOOKUP_LENGTH_PREFIX_BYTES + valueBytes;
    if (entryBytes > D1_LOOKUP_PAYLOAD_TARGET_BYTES) {
      await flush();
      if (valueBytes <= D1_MAX_BOUND_VALUE_BYTES) {
        await consume({ kind: 'direct', value });
        directBindings += 1;
      } else {
        skippedValues += 1;
      }
      continue;
    }
    if (payloadBytes + entryBytes > D1_LOOKUP_PAYLOAD_TARGET_BYTES) await flush();
    const entryOffset = D1_LOOKUP_LENGTH_PREFIX_BYTES + payloadBytes;
    const entryLength = String(valueBytes).padStart(D1_LOOKUP_LENGTH_PREFIX_BYTES, '0');
    for (let index = 0; index < entryLength.length; index += 1) {
      workspace.buffer[entryOffset + index] = entryLength.charCodeAt(index);
    }
    const encoded = d1LookupTextEncoder.encodeInto(
      textValue,
      workspace.buffer.subarray(entryOffset + D1_LOOKUP_LENGTH_PREFIX_BYTES),
    );
    if (encoded.read !== textValue.length || encoded.written !== valueBytes) {
      throw new TypeError('D1 lookup identity could not be encoded exactly');
    }
    payloadBytes += entryBytes;
  }
  await flush();
  return { packedBindings, directBindings, skippedValues };
}

function withApiFindingsCapacity(
  capacity: readonly CapacityDiagnostic[],
  canPublish: boolean,
  findings: readonly VodExportFindingApi[],
): CapacityDiagnostic[] {
  const diagnostic = assertApiFindingsCapacity(canPublish, findings);

  let replaced = false;
  const result = capacity.map((item) => {
    if (item.resource !== 'findingsBytes') return item;
    replaced = true;
    return diagnostic;
  });
  if (!replaced) result.push(diagnostic);
  return result;
}

export function assertApiFindingsCapacity(
  canPublish: boolean,
  findings: readonly VodExportFindingApi[],
): CapacityDiagnostic {
  let actual = utf8ByteLength(`{"canPublish":${canPublish ? 'true' : 'false'},"findings":[`);
  for (let index = 0; index < findings.length; index += 1) {
    const finding = findings[index];
    if (finding === undefined) continue;
    if (index > 0) actual += 1;
    actual += findingJsonByteLength(finding);
    if (finding.repairPath !== undefined) {
      actual += 1 + jsonStringByteLength('repairPath') + 1 + jsonStringByteLength(finding.repairPath);
    }
    if (actual + 2 > VOD_EXPORT_LIMITS.findingsBytes) {
      throw new ExportLimitExceededError(capacityDiagnostic('findingsBytes', actual + 2));
    }
  }
  actual += 2;
  const diagnostic = capacityDiagnostic('findingsBytes', actual);
  return diagnostic;
}

export function repairPathForFinding(
  finding: VodExportFinding,
  performanceById: ReadonlyMap<string, number>,
  songById: ReadonlyMap<string, number>,
  streamByIdentity: ReadonlyMap<string, number>,
  streamById: ReadonlyMap<string, number>,
  submissionById: ReadonlyMap<string, number>,
): string | undefined {
  if (finding.entityType === 'streamer') {
    if (finding.details?.submissionId !== undefined) {
      const rowId = submissionById.get(finding.details.submissionId);
      if (rowId !== undefined) return `/vod-export/repair/streamer/${rowId}`;
      return undefined;
    }
    const search = finding.streamerSlug;
    return `/nova?status=approved${search === undefined ? '' : `&search=${encodeURIComponent(search)}`}`;
  }
  if (finding.entityType === 'song' && finding.entityId !== undefined) {
    const rowId = songById.get(finding.entityId);
    return rowId === undefined ? undefined : `/vod-export/repair/song/${rowId}`;
  }
  if (finding.entityType === 'song' && finding.details?.rowId !== undefined) {
    return `/vod-export/repair/song/${finding.details.rowId}`;
  }
  if (finding.entityType === 'performance') {
    const rowId = finding.entityId === undefined
      ? finding.details?.rowId
      : performanceById.get(finding.entityId);
    if (rowId !== undefined) return `/vod-export/repair/performance/${rowId}`;
  }
  if (finding.entityType === 'vod') {
    if (
      finding.code === 'DUPLICATE_VOD_VIDEO_ID'
      && finding.entityId !== undefined
      && finding.streamerSlug !== undefined
    ) {
      return `/streams?streamer=${encodeURIComponent(finding.streamerSlug)}&status=approved&search=${encodeURIComponent(finding.entityId)}`;
    }
    if (finding.details?.streamId !== undefined) {
      const rowId = streamById.get(finding.details.streamId);
      if (rowId !== undefined) return `/vod-export/repair/vod/${rowId}`;
      return undefined;
    }
    if (finding.entityId !== undefined) {
      const direct = finding.streamerSlug === undefined
        ? undefined
        : streamByIdentity.get(`${finding.streamerSlug}\u0000${finding.entityId}`);
      if (direct !== undefined) return `/vod-export/repair/vod/${direct}`;
      const streamer = finding.streamerSlug === undefined
        ? ''
        : `streamer=${encodeURIComponent(finding.streamerSlug)}&`;
      return `/streams?${streamer}search=${encodeURIComponent(finding.entityId)}`;
    }
  }
  return undefined;
}

function knownError(
  status: number,
  code: string,
  message: string,
  diagnostics?: CapacityDiagnostic[],
): VodExportHttpError {
  return {
    status,
    body: {
      error: message,
      code,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    },
  };
}

function diagnosticFromDetails(
  details: Readonly<Record<string, string | number>> | undefined,
): CapacityDiagnostic[] | undefined {
  if (
    details === undefined
    || typeof details.resource !== 'string'
    || typeof details.actual !== 'number'
    || typeof details.limit !== 'number'
    || details.limit <= 0
  ) return undefined;
  return [{
    resource: details.resource as CapacityDiagnostic['resource'],
    actual: details.actual,
    limit: details.limit,
    ratio: details.actual / details.limit,
    state: details.actual > details.limit ? 'exceeded' : 'warning',
  }];
}

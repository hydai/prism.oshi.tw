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
import { utf8ByteLength } from './normalization';
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
      return await getVodExportCandidateApi(bindings, result.candidate.candidateId, exporterBuildId);
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
  const [fingerprint, current] = await Promise.all([
    readCurrentSourceFingerprint(bindings, exporterBuildId),
    readCurrentManifest(bindings.VOD_EXPORT_PUBLIC, { verifySnapshot: false }),
  ]);
  const stale = !sourceFingerprintsEqual(stored.metadata.sourceFingerprint, fingerprint);
  const state: VodExportCandidateApiState = stale
    ? 'stale'
    : stableCandidateState(current?.manifest ?? null, stored.metadata)
      ? 'already_published'
      : 'ready';
  const findings = await findingsForApi(bindings, stored.metadata.findings);
  const capacity = withApiFindingsCapacity(stored.metadata.capacity, state !== 'stale', findings);
  return {
    // Stable-identical bytes still require an explicit curator action to move
    // the source-equivalence checkpoint without rewriting public artifacts.
    canPublish: state !== 'stale',
    findings,
    candidate: candidateForApi(stored.metadata, state),
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
  const vodIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'vod' && finding.entityId !== undefined)
    .map((finding) => finding.entityId!))];
  const vodStreamIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'vod' && finding.details?.streamId !== undefined)
    .map((finding) => finding.details!.streamId!))];
  const submissionIds = [...new Set(findings
    .filter((finding) => finding.entityType === 'streamer' && finding.details?.submissionId !== undefined)
    .map((finding) => finding.details!.submissionId!))];
  const [performances, streams, submissions] = await Promise.all([
    lookupPerformanceRepairRows(bindings.DB, performanceIds),
    lookupVodRepairRows(bindings.DB, vodIds, vodStreamIds),
    lookupStreamerRepairRows(bindings.NOVA_DB, submissionIds),
  ]);
  const performanceById = new Map(performances
    .filter((row): row is { id: string; row_id: number } => typeof row.id === 'string')
    .map((row) => [row.id, Number(row.row_id)]));
  const streamByIdentity = new Map(
    streams.map((row) => [`${row.streamer_id}\u0000${row.video_id}`, Number(row.row_id)]),
  );
  const streamById = new Map(streams.map((row) => [row.id, Number(row.row_id)]));
  const submissionById = new Map(submissions.map((row) => [row.id, Number(row.row_id)]));
  return findings.map((finding) => {
    const repairPath = repairPathForFinding(
      finding,
      performanceById,
      streamByIdentity,
      streamById,
      submissionById,
    );
    return { ...finding, ...(repairPath === undefined ? {} : { repairPath }) };
  });
}

const D1_JSON_BINDING_TARGET_BYTES = 1_900_000;
const D1_MAX_BOUND_VALUE_BYTES = 2_000_000;

export interface D1LookupBindingPlan {
  jsonBindings: string[];
  directBindings: Array<string | number>;
  skippedValues: number;
}

async function lookupPerformanceRepairRows(
  db: D1Database,
  ids: readonly string[],
): Promise<Array<{ id: string | null; row_id: number }>> {
  const statements: D1PreparedStatement[] = [];
  const idPlan = planD1LookupBindings(ids);
  for (const binding of idPlan.jsonBindings) {
    statements.push(db.prepare(`
      SELECT id, rowid AS row_id
      FROM performances
      WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(binding));
  }
  for (const binding of idPlan.directBindings) {
    statements.push(db.prepare(`
      SELECT id, rowid AS row_id
      FROM performances
      WHERE id = ?
    `).bind(binding));
  }
  if (statements.length === 0) return [];
  const results = await db.batch<{ id: string | null; row_id: number }>(statements);
  return results.flatMap((result) => result.results);
}

async function lookupVodRepairRows(
  db: D1Database,
  videoIds: readonly string[],
  streamIds: readonly string[],
): Promise<Array<{ row_id: number; id: string; streamer_id: string; video_id: string }>> {
  const plan = planD1LookupBindings(videoIds);
  const statements = plan.jsonBindings.map((binding) => db.prepare(`
    SELECT rowid AS row_id, id, streamer_id, video_id
    FROM streams
    WHERE video_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
  `).bind(binding));
  for (const binding of plan.directBindings) {
    statements.push(db.prepare(`
      SELECT rowid AS row_id, id, streamer_id, video_id
      FROM streams
      WHERE video_id = ?
    `).bind(binding));
  }
  const streamPlan = planD1LookupBindings(streamIds);
  for (const binding of streamPlan.jsonBindings) {
    statements.push(db.prepare(`
      SELECT rowid AS row_id, id, streamer_id, video_id
      FROM streams
      WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(binding));
  }
  for (const binding of streamPlan.directBindings) {
    statements.push(db.prepare(`
      SELECT rowid AS row_id, id, streamer_id, video_id
      FROM streams
      WHERE id = ?
    `).bind(binding));
  }
  if (statements.length === 0) return [];
  const results = await db.batch<{ row_id: number; id: string; streamer_id: string; video_id: string }>(statements);
  return results.flatMap((result) => result.results);
}

async function lookupStreamerRepairRows(
  db: D1Database,
  submissionIds: readonly string[],
): Promise<Array<{ row_id: number; id: string }>> {
  const plan = planD1LookupBindings(submissionIds);
  const statements = plan.jsonBindings.map((binding) => db.prepare(`
    SELECT rowid AS row_id, id
    FROM submissions
    WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
  `).bind(binding));
  for (const binding of plan.directBindings) {
    statements.push(db.prepare(`
      SELECT rowid AS row_id, id
      FROM submissions
      WHERE id = ?
    `).bind(binding));
  }
  if (statements.length === 0) return [];
  const results = await db.batch<{ row_id: number; id: string }>(statements);
  return results.flatMap((result) => result.results);
}

/**
 * Keep lookup bindings below D1's 2,000,000-byte value limit. A value whose
 * JSON escaping is large but raw representation still fits uses direct
 * equality; an impossible-to-bind value simply receives no optional repair
 * link and remains present in the complete findings response.
 */
export function planD1LookupBindings(values: readonly (string | number)[]): D1LookupBindingPlan {
  const jsonBindings: string[] = [];
  const directBindings: Array<string | number> = [];
  let skippedValues = 0;
  let entries: string[] = [];
  let bytes = 2;

  const flush = (): void => {
    if (entries.length === 0) return;
    jsonBindings.push(`[${entries.join(',')}]`);
    entries = [];
    bytes = 2;
  };

  for (const value of values) {
    const encoded = JSON.stringify(value);
    const entryBytes = utf8ByteLength(encoded);
    if (entryBytes + 2 > D1_JSON_BINDING_TARGET_BYTES) {
      flush();
      const directBytes = typeof value === 'string'
        ? utf8ByteLength(value)
        : utf8ByteLength(String(value));
      if (directBytes <= D1_MAX_BOUND_VALUE_BYTES) directBindings.push(value);
      else skippedValues += 1;
      continue;
    }
    const nextBytes = bytes + entryBytes + (entries.length === 0 ? 0 : 1);
    if (nextBytes > D1_JSON_BINDING_TARGET_BYTES) {
      flush();
    }
    entries.push(encoded);
    bytes += entryBytes + (entries.length === 1 ? 0 : 1);
  }
  flush();
  return { jsonBindings, directBindings, skippedValues };
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
  const actual = utf8ByteLength(JSON.stringify({ canPublish, findings }));
  const diagnostic = capacityDiagnostic('findingsBytes', actual);
  if (actual > VOD_EXPORT_LIMITS.findingsBytes) throw new ExportLimitExceededError(diagnostic);
  return diagnostic;
}

export function repairPathForFinding(
  finding: VodExportFinding,
  performanceById: ReadonlyMap<string, number>,
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
    return `/songs/${encodeURIComponent(finding.entityId)}`;
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

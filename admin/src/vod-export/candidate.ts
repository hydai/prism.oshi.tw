import {
  VOD_EXPORT_CONTENT_TYPE,
  VOD_EXPORT_LIMITS,
  VOD_EXPORT_MAJOR,
  VOD_EXPORT_SCHEMA_VERSION,
} from './constants';
import { sha256Hex, snapshotUrlForHash } from './canonical-json';
import { createFinding } from './findings';
import { capacityDiagnostic } from './limits';
import {
  PRIVATE_JSON_HTTP_METADATA,
  VodExportR2Error,
  assertHttpMetadata,
  checksumSha256Hex,
  createBytesObject,
  createJsonObject,
  getJsonObject,
} from './r2';
import type {
  CapacityDiagnostic,
  CapacityResource,
  FindingCode,
  FindingEntityType,
  PublicFindingField,
  VodExportCounts,
  VodExportFinding,
  VodExportSnapshotArtifact,
} from './types';
import type { VodExportSourceFingerprint } from './source';

const CANDIDATE_PREFIX = 'candidates/v1/';
const CANDIDATE_METADATA_LIMIT = 5_000_000;
const CANDIDATE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface VodExportCandidateMetadata {
  kind: 'vod-export-candidate-v1';
  candidateId: string;
  schemaVersion: typeof VOD_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  expiresAt: string;
  sha256: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
  warningCount: number;
  findings: VodExportFinding[];
  capacity: CapacityDiagnostic[];
  snapshotKey: string;
  snapshotUrl: string;
  downloadFilename: string;
  sourceFingerprint: VodExportSourceFingerprint;
}

export interface StoredVodExportCandidate {
  metadata: VodExportCandidateMetadata;
  metadataEtag: string;
}

export class VodExportCandidateError extends Error {
  constructor(
    readonly code:
      | 'CANDIDATE_NOT_FOUND'
      | 'CANDIDATE_EXPIRED'
      | 'CANDIDATE_CORRUPT'
      | 'CANDIDATE_COLLISION',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'VodExportCandidateError';
  }
}

export function candidateMetadataKey(candidateId: string): string {
  assertCandidateId(candidateId);
  return `${CANDIDATE_PREFIX}${candidateId}/metadata.json`;
}

export function candidateSnapshotKey(candidateId: string): string {
  assertCandidateId(candidateId);
  return `${CANDIDATE_PREFIX}${candidateId}/snapshot.json`;
}

export async function storeCandidate(
  bucket: R2Bucket,
  artifact: VodExportSnapshotArtifact,
  findings: readonly VodExportFinding[],
  sourceFingerprint: VodExportSourceFingerprint,
  now = new Date(),
): Promise<VodExportCandidateMetadata> {
  const candidateId = crypto.randomUUID();
  const generatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CANDIDATE_LIFETIME_MS).toISOString();
  const snapshotKey = candidateSnapshotKey(candidateId);
  const warningFindings = findings.filter((finding) => finding.severity === 'warning');

  const snapshotObject = await createBytesObject(bucket, snapshotKey, artifact.bytes, {
    httpMetadata: PRIVATE_JSON_HTTP_METADATA,
    customMetadata: {
      kind: 'vod-export-candidate-snapshot-v1',
      sha256: artifact.sha256,
      expiresAt,
    },
    sha256: artifact.sha256,
  });
  if (snapshotObject === null) {
    throw new VodExportCandidateError('CANDIDATE_COLLISION', 'Candidate snapshot key already exists', 409);
  }

  const metadata: VodExportCandidateMetadata = {
    kind: 'vod-export-candidate-v1',
    candidateId,
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    generatedAt,
    expiresAt,
    sha256: artifact.sha256,
    uncompressedBytes: artifact.uncompressedBytes,
    counts: artifact.counts,
    warningCount: warningFindings.length,
    findings: warningFindings,
    capacity: artifact.capacity,
    snapshotKey,
    snapshotUrl: artifact.snapshotUrl,
    downloadFilename: artifact.downloadFilename,
    sourceFingerprint,
  };

  const metadataObject = await createJsonObject(
    bucket,
    candidateMetadataKey(candidateId),
    metadata,
    { kind: metadata.kind, expiresAt },
  );
  if (metadataObject === null) {
    await bucket.delete(snapshotKey);
    throw new VodExportCandidateError('CANDIDATE_COLLISION', 'Candidate metadata key already exists', 409);
  }
  return metadata;
}

export async function getCandidate(
  bucket: R2Bucket,
  candidateId: string,
  options?: { allowExpired?: boolean; now?: Date },
): Promise<StoredVodExportCandidate> {
  const result = await getJsonObject<unknown>(
    bucket,
    candidateMetadataKey(candidateId),
    CANDIDATE_METADATA_LIMIT,
  );
  if (result === null) {
    throw new VodExportCandidateError('CANDIDATE_NOT_FOUND', 'Candidate not found', 404);
  }
  assertHttpMetadata(result.object, PRIVATE_JSON_HTTP_METADATA, 'Candidate metadata');
  if (!isCandidateMetadata(result.value) || result.value.candidateId !== candidateId) {
    throw new VodExportCandidateError('CANDIDATE_CORRUPT', 'Candidate metadata is invalid', 503);
  }
  if (!options?.allowExpired && Date.parse(result.value.expiresAt) <= (options?.now ?? new Date()).getTime()) {
    throw new VodExportCandidateError('CANDIDATE_EXPIRED', 'Candidate has expired', 410);
  }
  return { metadata: result.value, metadataEtag: result.object.etag };
}

export async function getCandidateSnapshot(
  bucket: R2Bucket,
  candidate: VodExportCandidateMetadata,
): Promise<R2ObjectBody> {
  const object = await bucket.get(candidate.snapshotKey);
  if (object === null) {
    throw new VodExportCandidateError('CANDIDATE_CORRUPT', 'Candidate snapshot bytes are missing', 503);
  }
  assertHttpMetadata(object, PRIVATE_JSON_HTTP_METADATA, 'Candidate snapshot');
  if (object.size !== candidate.uncompressedBytes || object.size > VOD_EXPORT_LIMITS.snapshotBytes) {
    throw new VodExportCandidateError('CANDIDATE_CORRUPT', 'Candidate snapshot byte length does not match', 503);
  }
  const storedChecksum = checksumSha256Hex(object);
  if (storedChecksum !== null && storedChecksum !== candidate.sha256) {
    throw new VodExportCandidateError('CANDIDATE_CORRUPT', 'Candidate snapshot checksum does not match', 503);
  }
  return object;
}

export async function readAndVerifyCandidateBytes(
  bucket: R2Bucket,
  candidate: VodExportCandidateMetadata,
): Promise<Uint8Array> {
  const object = await getCandidateSnapshot(bucket, candidate);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await sha256Hex(bytes) !== candidate.sha256) {
    throw new VodExportCandidateError('CANDIDATE_CORRUPT', 'Candidate snapshot content hash does not match', 503);
  }
  return bytes;
}

export async function deleteCandidate(
  bucket: R2Bucket,
  candidate: VodExportCandidateMetadata,
): Promise<void> {
  await bucket.delete([candidate.snapshotKey, candidateMetadataKey(candidate.candidateId)]);
}

export async function deleteCandidateById(bucket: R2Bucket, candidateId: string): Promise<void> {
  await bucket.delete([candidateSnapshotKey(candidateId), candidateMetadataKey(candidateId)]);
}

function assertCandidateId(candidateId: string): void {
  if (!CANDIDATE_ID_PATTERN.test(candidateId)) {
    throw new VodExportCandidateError('CANDIDATE_NOT_FOUND', 'Candidate not found', 404);
  }
}

function isCandidateMetadata(value: unknown): value is VodExportCandidateMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, [
    'kind', 'candidateId', 'schemaVersion', 'generatedAt', 'expiresAt', 'sha256',
    'uncompressedBytes', 'counts', 'warningCount', 'findings', 'capacity',
    'snapshotKey', 'snapshotUrl', 'downloadFilename', 'sourceFingerprint',
  ])
    && record.kind === 'vod-export-candidate-v1'
    && typeof record.candidateId === 'string'
    && CANDIDATE_ID_PATTERN.test(record.candidateId)
    && record.schemaVersion === VOD_EXPORT_SCHEMA_VERSION
    && isCanonicalTimestamp(record.generatedAt)
    && isCanonicalTimestamp(record.expiresAt)
    && typeof record.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(record.sha256)
    && isNonNegativeSafeInteger(record.uncompressedBytes)
    && isCounts(record.counts)
    && isNonNegativeSafeInteger(record.warningCount)
    && areCandidateFindings(record.findings, record.warningCount)
    && areCapacityDiagnostics(record.capacity)
    && record.snapshotKey === candidateSnapshotKey(record.candidateId)
    && record.snapshotUrl === snapshotUrlForHash(record.sha256)
    && record.downloadFilename === `vod-export-v${VOD_EXPORT_MAJOR}-${record.sha256}.json`
    && isSourceFingerprint(record.sourceFingerprint)
    && Date.parse(record.expiresAt) - Date.parse(record.generatedAt) === CANDIDATE_LIFETIME_MS;
}

function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCounts(value: unknown): value is VodExportCounts {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, ['streamers', 'vods', 'performances'])
    && isNonNegativeSafeInteger(record.streamers)
    && isNonNegativeSafeInteger(record.vods)
    && isNonNegativeSafeInteger(record.performances);
}

function isSourceFingerprint(value: unknown): value is VodExportSourceFingerprint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, [
    'dbId',
    'dbRevision',
    'novaDbId',
    'novaRevision',
    'schemaVersion',
    'exporterBuildId',
  ])
    && typeof record.dbId === 'string'
    && record.dbId.length > 0
    && typeof record.dbRevision === 'string'
    && /^(0|[1-9][0-9]*)$/.test(record.dbRevision)
    && typeof record.novaDbId === 'string'
    && record.novaDbId.length > 0
    && typeof record.novaRevision === 'string'
    && /^(0|[1-9][0-9]*)$/.test(record.novaRevision)
    && record.schemaVersion === VOD_EXPORT_SCHEMA_VERSION
    && typeof record.exporterBuildId === 'string'
    && record.exporterBuildId.length > 0;
}

export function candidateDownloadHeaders(candidate: VodExportCandidateMetadata): Headers {
  return new Headers({
    'Content-Type': VOD_EXPORT_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="vod-export-v${VOD_EXPORT_MAJOR}-${candidate.sha256}.json"`,
    'Cache-Control': 'private, no-store',
  });
}

function areCandidateFindings(value: unknown, warningCount: unknown): value is VodExportFinding[] {
  if (!Array.isArray(value) || value.length !== warningCount || value.length > VOD_EXPORT_LIMITS.findings) return false;
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (
      typeof record.code !== 'string'
      || record.severity !== 'warning'
      || typeof record.message !== 'string'
      || !isFindingEntityType(record.entityType)
      || (record.streamerSlug !== undefined && typeof record.streamerSlug !== 'string')
      || (record.entityId !== undefined && typeof record.entityId !== 'string')
      || (record.field !== undefined && typeof record.field !== 'string')
      || (record.details !== undefined && (record.details === null || typeof record.details !== 'object' || Array.isArray(record.details)))
      || !hasOnlyKeys(record, ['code', 'severity', 'message', 'streamerSlug', 'entityType', 'entityId', 'field', 'details'])
    ) return false;
    try {
      const canonical = createFinding({
        code: record.code as FindingCode,
        ...(record.streamerSlug === undefined ? {} : { streamerSlug: record.streamerSlug as string }),
        entityType: record.entityType as FindingEntityType,
        ...(record.entityId === undefined ? {} : { entityId: record.entityId as string }),
        ...(record.field === undefined ? {} : { field: record.field as PublicFindingField }),
        ...(record.details === undefined ? {} : { details: record.details }),
      });
      if (JSON.stringify(canonical) !== JSON.stringify(item)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function areCapacityDiagnostics(value: unknown): value is CapacityDiagnostic[] {
  if (!Array.isArray(value) || value.length > 8) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (
      !hasExactKeys(record, ['resource', 'actual', 'limit', 'ratio', 'state'])
      || !isCapacityResource(record.resource)
      || !isNonNegativeSafeInteger(record.actual)
      || !isNonNegativeSafeInteger(record.limit)
      || record.limit === 0
      || typeof record.ratio !== 'number'
      || !Number.isFinite(record.ratio)
      || seen.has(record.resource)
    ) return false;
    seen.add(record.resource);
    const expected = capacityDiagnostic(record.resource, record.actual, record.limit);
    if (record.ratio !== expected.ratio || record.state !== expected.state) return false;
  }
  return true;
}

function isFindingEntityType(value: unknown): value is FindingEntityType {
  return value === 'streamer' || value === 'vod' || value === 'song' || value === 'performance';
}

function isCapacityResource(value: unknown): value is CapacityResource {
  return value === 'sourceRows'
    || value === 'sourceTextBytes'
    || value === 'streamers'
    || value === 'vods'
    || value === 'performances'
    || value === 'snapshotBytes'
    || value === 'findings'
    || value === 'findingsBytes';
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

export function candidateErrorFromR2(error: unknown): never {
  if (error instanceof VodExportR2Error) {
    throw new VodExportCandidateError('CANDIDATE_CORRUPT', error.message, error.status);
  }
  throw error;
}

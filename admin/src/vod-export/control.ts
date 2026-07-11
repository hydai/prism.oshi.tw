import { VOD_EXPORT_SCHEMA_VERSION } from './constants';
import { serializeCanonicalManifest, snapshotUrlForHash } from './canonical-json';
import { createJsonObject, getJsonObject, replaceJsonObject } from './r2';
import type { VodExportSourceFingerprint } from './source';
import type { VodExportManifest } from './types';

export const GENERATION_CONTROL_KEY = 'generation-control/v1.json';
export const PUBLICATION_CONTROL_KEY = 'publication-control/v1.json';

const CONTROL_OBJECT_LIMIT = 1_000_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface SourceEquivalenceCheckpoint {
  manifestSha256: string;
  fingerprint: VodExportSourceFingerprint;
  verifiedAt: string;
}

export interface GenerationIdleSlot {
  kind: 'vod-export-generation-control-v1';
  state: 'idle';
}

export interface GenerationAcquiredSlot {
  kind: 'vod-export-generation-control-v1';
  state: 'acquired';
  generationId: string;
  acquiredAt: string;
}

export type GenerationControlSlot = GenerationIdleSlot | GenerationAcquiredSlot;

export interface PublicationIdleSlot {
  kind: 'vod-export-publication-control-v1';
  state: 'idle';
  checkpoint?: SourceEquivalenceCheckpoint;
}

export interface PublicationAcquiredSlot {
  kind: 'vod-export-publication-control-v1';
  state: 'acquired';
  intentId: string;
  candidateId: string;
  acquiredAt: string;
  previousCheckpoint?: SourceEquivalenceCheckpoint;
}

export interface PreparedPublicationAudit {
  curatorIdentity: string;
  candidateId: string;
  schemaVersion: typeof VOD_EXPORT_SCHEMA_VERSION;
  candidateSha256: string;
  previousSha256: string | null;
  snapshotUrl: string;
  previousSnapshotUrl: string | null;
  streamerCount: number;
  vodCount: number;
  performanceCount: number;
  warningCount: number;
  sourceFingerprint: VodExportSourceFingerprint;
  publishedAt: string;
}

export interface PublicationPreparedSlot {
  kind: 'vod-export-publication-control-v1';
  state: 'prepared';
  intentId: string;
  candidateId: string;
  acquiredAt: string;
  preparedAt: string;
  expectedManifestEtag: string | null;
  expectedManifestBody: string | null;
  manifestBody: string;
  audit: PreparedPublicationAudit;
  previousCheckpoint?: SourceEquivalenceCheckpoint;
  attemptsExhausted?: boolean;
}

export type PublicationControlSlot =
  | PublicationIdleSlot
  | PublicationAcquiredSlot
  | PublicationPreparedSlot;

export interface OwnedGenerationControl {
  slot: GenerationAcquiredSlot;
  etag: string;
}

export interface OwnedPublicationControl {
  slot: PublicationAcquiredSlot;
  etag: string;
}

export class VodExportControlError extends Error {
  constructor(
    readonly code:
      | 'EXPORT_GENERATION_IN_PROGRESS'
      | 'PUBLICATION_IN_PROGRESS'
      | 'CONTROL_STATE_INVALID'
      | 'CONTROL_OWNERSHIP_LOST',
    message: string,
    readonly status: number,
    readonly unresolvedSince?: string,
  ) {
    super(message);
    this.name = 'VodExportControlError';
  }
}

export async function acquireGenerationControl(
  bucket: R2Bucket,
  now = new Date(),
): Promise<OwnedGenerationControl> {
  const generationId = crypto.randomUUID();
  const slot: GenerationAcquiredSlot = {
    kind: 'vod-export-generation-control-v1',
    state: 'acquired',
    generationId,
    acquiredAt: now.toISOString(),
  };
  const existing = await getJsonObject<unknown>(bucket, GENERATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (existing === null) {
    let created: R2Object | null;
    try {
      created = await createJsonObject(bucket, GENERATION_CONTROL_KEY, slot, {
        kind: slot.kind,
        state: slot.state,
      });
    } catch {
      return resolveAmbiguousGenerationAcquire(bucket, slot);
    }
    if (created !== null) return { slot, etag: created.etag };
    return acquireGenerationControlAfterRace(bucket);
  }
  if (!isGenerationControlSlot(existing.value)) {
    throw new VodExportControlError('CONTROL_STATE_INVALID', 'Generation control state is invalid', 503);
  }
  if (existing.value.state === 'acquired') {
    throw new VodExportControlError(
      'EXPORT_GENERATION_IN_PROGRESS',
      'Another VOD export preview is already being generated',
      409,
      existing.value.acquiredAt,
    );
  }
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      GENERATION_CONTROL_KEY,
      slot,
      existing.object.etag,
      { kind: slot.kind, state: slot.state },
    );
  } catch {
    return resolveAmbiguousGenerationAcquire(bucket, slot);
  }
  if (replaced === null) return acquireGenerationControlAfterRace(bucket);
  return { slot, etag: replaced.etag };
}

async function resolveAmbiguousGenerationAcquire(
  bucket: R2Bucket,
  slot: GenerationAcquiredSlot,
): Promise<OwnedGenerationControl> {
  const current = await getJsonObject<unknown>(bucket, GENERATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (current !== null && isGenerationControlSlot(current.value) && current.value.state === 'acquired') {
    if (current.value.generationId === slot.generationId) {
      return { slot: current.value, etag: current.object.etag };
    }
    throw new VodExportControlError(
      'EXPORT_GENERATION_IN_PROGRESS',
      'Another VOD export preview is already being generated',
      409,
      current.value.acquiredAt,
    );
  }
  throw new VodExportControlError(
    'CONTROL_OWNERSHIP_LOST',
    'Generation control acquisition could not be classified after an ambiguous write',
    503,
  );
}

async function acquireGenerationControlAfterRace(bucket: R2Bucket): Promise<never> {
  const current = await getJsonObject<unknown>(bucket, GENERATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (current !== null && isGenerationControlSlot(current.value) && current.value.state === 'acquired') {
    throw new VodExportControlError(
      'EXPORT_GENERATION_IN_PROGRESS',
      'Another VOD export preview is already being generated',
      409,
      current.value.acquiredAt,
    );
  }
  throw new VodExportControlError('CONTROL_OWNERSHIP_LOST', 'Generation control acquisition lost a race', 409);
}

export async function releaseGenerationControl(
  bucket: R2Bucket,
  owned: OwnedGenerationControl,
): Promise<void> {
  const idle: GenerationIdleSlot = { kind: 'vod-export-generation-control-v1', state: 'idle' };
  let released: R2Object | null;
  try {
    released = await replaceJsonObject(
      bucket,
      GENERATION_CONTROL_KEY,
      idle,
      owned.etag,
      { kind: idle.kind, state: idle.state },
    );
  } catch {
    released = null;
  }
  if (released !== null) return;

  const current = await getJsonObject<unknown>(bucket, GENERATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (current !== null && isGenerationControlSlot(current.value) && current.value.state === 'idle') return;
  if (
    current !== null
    && isGenerationControlSlot(current.value)
    && current.value.state === 'acquired'
    && current.value.generationId === owned.slot.generationId
  ) {
    let retry: R2Object | null;
    try {
      retry = await replaceJsonObject(
        bucket,
        GENERATION_CONTROL_KEY,
        idle,
        current.object.etag,
        { kind: idle.kind, state: idle.state },
      );
    } catch {
      retry = null;
    }
    if (retry !== null) return;
    const afterRetry = await getJsonObject<unknown>(bucket, GENERATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
    if (afterRetry !== null && isGenerationControlSlot(afterRetry.value) && afterRetry.value.state === 'idle') return;
  }
  throw new VodExportControlError('CONTROL_OWNERSHIP_LOST', 'Could not release generation control', 503);
}

/**
 * Manual-recovery variant: never follows the same owner onto a newer ETag.
 * A null/ambiguous CAS succeeds only if the exact desired idle state is
 * already visible; otherwise the operator must inspect again.
 */
export async function strictlyReleaseGenerationControl(
  bucket: R2Bucket,
  owned: OwnedGenerationControl,
): Promise<void> {
  const idle: GenerationIdleSlot = { kind: 'vod-export-generation-control-v1', state: 'idle' };
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      GENERATION_CONTROL_KEY,
      idle,
      owned.etag,
      { kind: idle.kind, state: idle.state },
    );
  } catch {
    replaced = null;
  }
  if (replaced !== null) return;
  const current = await readGenerationControl(bucket);
  if (current !== null && current.slot.state === 'idle') return;
  throw new VodExportControlError(
    'CONTROL_OWNERSHIP_LOST',
    'Generation control changed after manual inspection',
    409,
  );
}

export async function acquirePublicationControl(
  bucket: R2Bucket,
  candidateId: string,
  now = new Date(),
): Promise<OwnedPublicationControl> {
  const intentId = crypto.randomUUID();
  const existing = await getJsonObject<unknown>(bucket, PUBLICATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  const previousCheckpoint = existing !== null && isPublicationControlSlot(existing.value)
    ? existing.value.state === 'idle' ? existing.value.checkpoint : undefined
    : undefined;
  const slot: PublicationAcquiredSlot = {
    kind: 'vod-export-publication-control-v1',
    state: 'acquired',
    intentId,
    candidateId,
    acquiredAt: now.toISOString(),
    ...(previousCheckpoint === undefined ? {} : { previousCheckpoint }),
  };

  if (existing === null) {
    let created: R2Object | null;
    try {
      created = await createJsonObject(bucket, PUBLICATION_CONTROL_KEY, slot, {
        kind: slot.kind,
        state: slot.state,
      });
    } catch {
      return resolveAmbiguousPublicationAcquire(bucket, slot);
    }
    if (created !== null) return { slot, etag: created.etag };
    return publicationRace(bucket);
  }
  if (!isPublicationControlSlot(existing.value)) {
    throw new VodExportControlError('CONTROL_STATE_INVALID', 'Publication control state is invalid', 503);
  }
  if (existing.value.state !== 'idle') {
    throw new VodExportControlError(
      'PUBLICATION_IN_PROGRESS',
      'Another VOD export publication requires completion or reconciliation',
      409,
      existing.value.state === 'acquired' ? existing.value.acquiredAt : existing.value.preparedAt,
    );
  }
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      PUBLICATION_CONTROL_KEY,
      slot,
      existing.object.etag,
      { kind: slot.kind, state: slot.state },
    );
  } catch {
    return resolveAmbiguousPublicationAcquire(bucket, slot);
  }
  if (replaced === null) return publicationRace(bucket);
  return { slot, etag: replaced.etag };
}

async function resolveAmbiguousPublicationAcquire(
  bucket: R2Bucket,
  slot: PublicationAcquiredSlot,
): Promise<OwnedPublicationControl> {
  const current = await readPublicationControl(bucket);
  if (current !== null && current.slot.state === 'acquired' && current.slot.intentId === slot.intentId) {
    return { slot: current.slot, etag: current.etag };
  }
  if (current !== null && current.slot.state !== 'idle') {
    throw new VodExportControlError(
      'PUBLICATION_IN_PROGRESS',
      'Another VOD export publication requires completion or reconciliation',
      409,
      current.slot.state === 'acquired' ? current.slot.acquiredAt : current.slot.preparedAt,
    );
  }
  throw new VodExportControlError(
    'CONTROL_OWNERSHIP_LOST',
    'Publication control acquisition could not be classified after an ambiguous write',
    503,
  );
}

async function publicationRace(bucket: R2Bucket): Promise<never> {
  const current = await getJsonObject<unknown>(bucket, PUBLICATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (current !== null && isPublicationControlSlot(current.value) && current.value.state !== 'idle') {
    throw new VodExportControlError(
      'PUBLICATION_IN_PROGRESS',
      'Another VOD export publication requires completion or reconciliation',
      409,
      current.value.state === 'acquired' ? current.value.acquiredAt : current.value.preparedAt,
    );
  }
  throw new VodExportControlError('CONTROL_OWNERSHIP_LOST', 'Publication control acquisition lost a race', 409);
}

export async function preparePublicationControl(
  bucket: R2Bucket,
  owned: OwnedPublicationControl,
  prepared: Omit<PublicationPreparedSlot, 'kind' | 'state' | 'intentId' | 'candidateId' | 'acquiredAt' | 'previousCheckpoint'>,
): Promise<{ slot: PublicationPreparedSlot; etag: string }> {
  const slot: PublicationPreparedSlot = {
    kind: 'vod-export-publication-control-v1',
    state: 'prepared',
    intentId: owned.slot.intentId,
    candidateId: owned.slot.candidateId,
    acquiredAt: owned.slot.acquiredAt,
    ...prepared,
    ...(owned.slot.previousCheckpoint === undefined ? {} : { previousCheckpoint: owned.slot.previousCheckpoint }),
  };
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      PUBLICATION_CONTROL_KEY,
      slot,
      owned.etag,
      { kind: slot.kind, state: slot.state, intentId: slot.intentId },
    );
  } catch {
    return resolveAmbiguousPreparedWrite(bucket, slot);
  }
  if (replaced === null) {
    throw new VodExportControlError('CONTROL_OWNERSHIP_LOST', 'Publication control ownership was lost before prepare', 409);
  }
  return { slot, etag: replaced.etag };
}

export async function updatePreparedPublicationControl(
  bucket: R2Bucket,
  slot: PublicationPreparedSlot,
  expectedEtag: string,
): Promise<{ slot: PublicationPreparedSlot; etag: string }> {
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      PUBLICATION_CONTROL_KEY,
      slot,
      expectedEtag,
      { kind: slot.kind, state: slot.state, intentId: slot.intentId },
    );
  } catch {
    return resolveAmbiguousPreparedWrite(bucket, slot);
  }
  if (replaced === null) {
    throw new VodExportControlError('CONTROL_OWNERSHIP_LOST', 'Prepared publication control ownership was lost', 409);
  }
  return { slot, etag: replaced.etag };
}

async function resolveAmbiguousPreparedWrite(
  bucket: R2Bucket,
  slot: PublicationPreparedSlot,
): Promise<{ slot: PublicationPreparedSlot; etag: string }> {
  const current = await readPublicationControl(bucket);
  if (
    current !== null
    && current.slot.state === 'prepared'
    && current.slot.intentId === slot.intentId
    && JSON.stringify(current.slot) === JSON.stringify(slot)
  ) {
    return { slot: current.slot, etag: current.etag };
  }
  throw new VodExportControlError(
    'CONTROL_OWNERSHIP_LOST',
    'Prepared publication control write could not be classified safely',
    503,
  );
}

export async function releasePublicationControl(
  bucket: R2Bucket,
  intentId: string,
  expectedEtag: string,
  checkpoint?: SourceEquivalenceCheckpoint,
): Promise<void> {
  const idle: PublicationIdleSlot = {
    kind: 'vod-export-publication-control-v1',
    state: 'idle',
    ...(checkpoint === undefined ? {} : { checkpoint }),
  };
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      PUBLICATION_CONTROL_KEY,
      idle,
      expectedEtag,
      { kind: idle.kind, state: idle.state },
    );
  } catch {
    replaced = null;
  }
  if (replaced !== null) return;

  const current = await getJsonObject<unknown>(bucket, PUBLICATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (current !== null && isPublicationControlSlot(current.value) && current.value.state === 'idle') {
    if (checkpointsEqual(current.value.checkpoint, checkpoint)) return;
  }
  if (
    current !== null
    && isPublicationControlSlot(current.value)
    && current.value.state !== 'idle'
    && current.value.intentId === intentId
  ) {
    let retry: R2Object | null;
    try {
      retry = await replaceJsonObject(
        bucket,
        PUBLICATION_CONTROL_KEY,
        idle,
        current.object.etag,
        { kind: idle.kind, state: idle.state },
      );
    } catch {
      retry = null;
    }
    if (retry !== null) return;
    const afterRetry = await getJsonObject<unknown>(bucket, PUBLICATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
    if (
      afterRetry !== null
      && isPublicationControlSlot(afterRetry.value)
      && afterRetry.value.state === 'idle'
      && checkpointsEqual(afterRetry.value.checkpoint, checkpoint)
    ) return;
  }
  throw new VodExportControlError('CONTROL_OWNERSHIP_LOST', 'Could not finalize publication control', 503);
}

export async function strictlyReleasePublicationControl(
  bucket: R2Bucket,
  expectedEtag: string,
  checkpoint?: SourceEquivalenceCheckpoint,
): Promise<void> {
  const idle: PublicationIdleSlot = {
    kind: 'vod-export-publication-control-v1',
    state: 'idle',
    ...(checkpoint === undefined ? {} : { checkpoint }),
  };
  let replaced: R2Object | null;
  try {
    replaced = await replaceJsonObject(
      bucket,
      PUBLICATION_CONTROL_KEY,
      idle,
      expectedEtag,
      { kind: idle.kind, state: idle.state },
    );
  } catch {
    replaced = null;
  }
  if (replaced !== null) return;
  const current = await readPublicationControl(bucket);
  if (
    current !== null
    && current.slot.state === 'idle'
    && checkpointsEqual(current.slot.checkpoint, checkpoint)
  ) return;
  throw new VodExportControlError(
    'CONTROL_OWNERSHIP_LOST',
    'Publication control changed after manual inspection',
    409,
  );
}

export async function readPublicationControl(
  bucket: R2Bucket,
): Promise<{ slot: PublicationControlSlot; etag: string } | null> {
  const result = await getJsonObject<unknown>(bucket, PUBLICATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (result === null) return null;
  if (!isPublicationControlSlot(result.value)) {
    throw new VodExportControlError('CONTROL_STATE_INVALID', 'Publication control state is invalid', 503);
  }
  return { slot: result.value, etag: result.object.etag };
}

export async function readGenerationControl(
  bucket: R2Bucket,
): Promise<{ slot: GenerationControlSlot; etag: string } | null> {
  const result = await getJsonObject<unknown>(bucket, GENERATION_CONTROL_KEY, CONTROL_OBJECT_LIMIT);
  if (result === null) return null;
  if (!isGenerationControlSlot(result.value)) {
    throw new VodExportControlError('CONTROL_STATE_INVALID', 'Generation control state is invalid', 503);
  }
  return { slot: result.value, etag: result.object.etag };
}

function isGenerationControlSlot(value: unknown): value is GenerationControlSlot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'vod-export-generation-control-v1') return false;
  if (record.state === 'idle') return hasExactKeys(record, ['kind', 'state']);
  return hasExactKeys(record, ['kind', 'state', 'generationId', 'acquiredAt'])
    && record.state === 'acquired'
    && isUuidV4(record.generationId)
    && isCanonicalTimestamp(record.acquiredAt);
}

function isPublicationControlSlot(value: unknown): value is PublicationControlSlot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'vod-export-publication-control-v1') return false;
  if (record.state === 'idle') {
    return hasRequiredAndOptionalKeys(record, ['kind', 'state'], ['checkpoint'])
      && (record.checkpoint === undefined || isCheckpoint(record.checkpoint));
  }
  if (record.state === 'acquired') {
    return hasRequiredAndOptionalKeys(
      record,
      ['kind', 'state', 'intentId', 'candidateId', 'acquiredAt'],
      ['previousCheckpoint'],
    )
      && isUuidV4(record.intentId)
      && isUuidV4(record.candidateId)
      && isCanonicalTimestamp(record.acquiredAt)
      && (record.previousCheckpoint === undefined || isCheckpoint(record.previousCheckpoint));
  }
  if (record.state === 'prepared') {
    if (!hasRequiredAndOptionalKeys(
      record,
      [
        'kind', 'state', 'intentId', 'candidateId', 'acquiredAt', 'preparedAt',
        'expectedManifestEtag', 'expectedManifestBody', 'manifestBody', 'audit',
      ],
      ['previousCheckpoint', 'attemptsExhausted'],
    )) return false;
    if (!(record.expectedManifestEtag === null || isNonEmptyString(record.expectedManifestEtag))) return false;
    if (!(record.expectedManifestBody === null || typeof record.expectedManifestBody === 'string')) return false;
    if ((record.expectedManifestEtag === null) !== (record.expectedManifestBody === null)) return false;
    if (typeof record.manifestBody !== 'string' || !isPreparedAudit(record.audit, record.candidateId)) return false;
    const desired = parseCanonicalControlManifest(record.manifestBody);
    const expected = record.expectedManifestBody === null
      ? null
      : parseCanonicalControlManifest(record.expectedManifestBody);
    if (desired === null || (record.expectedManifestBody !== null && expected === null)) return false;
    const audit = record.audit as PreparedPublicationAudit;
    return isUuidV4(record.intentId)
      && isUuidV4(record.candidateId)
      && isCanonicalTimestamp(record.acquiredAt)
      && isCanonicalTimestamp(record.preparedAt)
      && (record.previousCheckpoint === undefined || isCheckpoint(record.previousCheckpoint))
      && (record.attemptsExhausted === undefined || typeof record.attemptsExhausted === 'boolean')
      && audit.schemaVersion === desired.schemaVersion
      && audit.candidateSha256 === desired.sha256
      && audit.snapshotUrl === desired.snapshotUrl
      && audit.streamerCount === desired.counts.streamers
      && audit.vodCount === desired.counts.vods
      && audit.performanceCount === desired.counts.performances
      && audit.publishedAt === desired.publishedAt
      && audit.previousSha256 === (expected?.sha256 ?? null)
      && audit.previousSnapshotUrl === (expected?.snapshotUrl ?? null);
  }
  return false;
}

function isCheckpoint(value: unknown): value is SourceEquivalenceCheckpoint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, ['manifestSha256', 'fingerprint', 'verifiedAt'])
    && typeof record.manifestSha256 === 'string'
    && SHA256_PATTERN.test(record.manifestSha256)
    && isCanonicalTimestamp(record.verifiedAt)
    && isSourceFingerprint(record.fingerprint);
}

function checkpointsEqual(
  left: SourceEquivalenceCheckpoint | undefined,
  right: SourceEquivalenceCheckpoint | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function isPreparedAudit(value: unknown, candidateId: unknown): value is PreparedPublicationAudit {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, [
    'curatorIdentity', 'candidateId', 'schemaVersion', 'candidateSha256',
    'previousSha256', 'snapshotUrl', 'previousSnapshotUrl', 'streamerCount',
    'vodCount', 'performanceCount', 'warningCount', 'sourceFingerprint', 'publishedAt',
  ])
    && isNonEmptyString(record.curatorIdentity)
    && record.curatorIdentity.length <= 320
    && record.candidateId === candidateId
    && isUuidV4(record.candidateId)
    && record.schemaVersion === VOD_EXPORT_SCHEMA_VERSION
    && typeof record.candidateSha256 === 'string'
    && SHA256_PATTERN.test(record.candidateSha256)
    && (record.previousSha256 === null || (typeof record.previousSha256 === 'string' && SHA256_PATTERN.test(record.previousSha256)))
    && record.snapshotUrl === snapshotUrlForHash(record.candidateSha256)
    && (record.previousSnapshotUrl === null || isNonEmptyString(record.previousSnapshotUrl))
    && ((record.previousSha256 === null) === (record.previousSnapshotUrl === null))
    && isNonNegativeSafeInteger(record.streamerCount)
    && isNonNegativeSafeInteger(record.vodCount)
    && isNonNegativeSafeInteger(record.performanceCount)
    && isNonNegativeSafeInteger(record.warningCount)
    && isSourceFingerprint(record.sourceFingerprint)
    && isCanonicalTimestamp(record.publishedAt);
}

function isSourceFingerprint(value: unknown): value is VodExportSourceFingerprint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, [
    'dbId', 'dbRevision', 'novaDbId', 'novaRevision', 'schemaVersion', 'exporterBuildId',
  ])
    && isNonEmptyString(record.dbId)
    && typeof record.dbRevision === 'string'
    && /^(0|[1-9][0-9]*)$/.test(record.dbRevision)
    && isNonEmptyString(record.novaDbId)
    && typeof record.novaRevision === 'string'
    && /^(0|[1-9][0-9]*)$/.test(record.novaRevision)
    && record.schemaVersion === VOD_EXPORT_SCHEMA_VERSION
    && isNonEmptyString(record.exporterBuildId);
}

function parseCanonicalControlManifest(value: string): VodExportManifest | null {
  try {
    const parsed = JSON.parse(value) as VodExportManifest;
    const bytes = serializeCanonicalManifest(parsed);
    return textDecoder.decode(bytes) === value ? parsed : null;
  } catch {
    return null;
  }
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasRequiredAndOptionalKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => allowed.has(key));
}

import {
  VOD_EXPORT_LIMITS,
  VOD_EXPORT_MANIFEST_KEY,
  VOD_EXPORT_SCHEMA_VERSION,
} from './constants';
import {
  countSnapshot,
  serializeCanonicalManifest,
  serializeCanonicalSnapshot,
  sha256Hex,
  snapshotObjectKey,
} from './canonical-json';
import { SOCIAL_PROVIDERS } from './constants';
import {
  candidateMetadataKey,
  deleteCandidateById,
  getCandidate,
  readAndVerifyCandidateBytes,
  VodExportCandidateError,
  type VodExportCandidateMetadata,
} from './candidate';
import {
  acquirePublicationControl,
  preparePublicationControl,
  readGenerationControl,
  readPublicationControl,
  releasePublicationControl,
  strictlyReleaseGenerationControl,
  strictlyReleasePublicationControl,
  updatePreparedPublicationControl,
  VodExportControlError,
  type PreparedPublicationAudit,
  type PublicationPreparedSlot,
  type SourceEquivalenceCheckpoint,
} from './control';
import {
  PUBLIC_MANIFEST_HTTP_METADATA,
  PUBLIC_SNAPSHOT_HTTP_METADATA,
  assertHttpMetadata,
  checksumSha256Hex,
  createBytesObject,
} from './r2';
import {
  readCurrentSourceFingerprint,
  readOrderedPublicationFingerprint,
  sourceFingerprintsEqual,
  type VodExportSourceBindings,
  type VodExportSourceFingerprint,
} from './source';
import {
  hasValidUnicodeScalars,
  isBlankText,
  isValidDateOnly,
  isValidStreamerSlug,
  isValidVideoId,
  normalizeDisplayText,
  validateOptionalSafeUrl,
} from './normalization';
import { orderSnapshot } from './ordering';
import type { VodExportCounts, VodExportManifest, VodExportSnapshot } from './types';

const MANIFEST_BYTES_LIMIT = 65_536;
const MANIFEST_ATTEMPTS = 3;
const MANIFEST_RETRY_MS = 1_000;
const CONTROL_ALERT_MS = 15 * 60 * 1_000;
const RESOLUTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const VOD_EXPORT_MANUAL_RECOVERY_CONFIRMATION = 'I CONFIRM THE OWNER INVOCATION HAS TERMINATED';
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface VodExportPublicationBindings extends VodExportSourceBindings {
  VOD_EXPORT_PUBLIC: R2Bucket;
  VOD_EXPORT_PRIVATE: R2Bucket;
}

export interface CurrentVodExportManifest {
  manifest: VodExportManifest;
  bytes: Uint8Array;
  etag: string;
}

export interface VodExportStatusResult {
  currentPublication: VodExportManifest | null;
  changesNotPublished: boolean;
  publicationInProgress: boolean;
  generationInProgress: boolean;
  recoveryAvailable: boolean;
  controlWarning?: string;
}

export interface VodExportPublishResult {
  outcome: 'published' | 'already_published';
  currentPublication: VodExportManifest;
  warnings: string[];
}

export interface VodExportReconcileResult {
  outcome: 'idle' | 'recovered' | 'already_published' | 'released_not_committed';
  currentPublication: VodExportManifest | null;
}

export interface VodExportControlRecoveryState {
  generation: null | {
    state: 'acquired';
    ownerId: string;
    acquiredAt: string;
    etag: string;
  };
  publication: null | {
    state: 'acquired' | 'prepared';
    ownerId: string;
    acquiredAt: string;
    unresolvedSince: string;
    etag: string;
    attemptsExhausted?: boolean;
  };
}

export interface VodExportManualControlRecoveryRequest {
  control: 'generation' | 'publication';
  ownerId: string;
  etag: string;
  confirmation: string;
  reason: string;
}

export interface VodExportManualControlRecoveryResult {
  outcome: 'released' | 'reconciled';
  control: 'generation' | 'publication';
}

type PublicationResolutionOutcome = 'no_op' | 'pre_commit_failed' | 'conflict' | 'manual_release';

interface PublicationResolutionInput {
  intentId: string;
  candidateId: string;
  curatorIdentity: string;
  outcome: PublicationResolutionOutcome;
  resolutionCode: string;
  checkpoint?: SourceEquivalenceCheckpoint;
}

export class VodExportPublicationError extends Error {
  constructor(
    readonly code:
      | 'CANDIDATE_STALE'
      | 'PUBLIC_ARTIFACT_INVALID'
      | 'PUBLICATION_CONFLICT'
      | 'PUBLICATION_RECONCILIATION_REQUIRED'
      | 'CONTROL_RECOVERY_CONFIRMATION_REQUIRED'
      | 'CONTROL_RECOVERY_STATE_CHANGED'
      | 'CONTROL_RECOVERY_TOO_EARLY'
      | 'EXPORTER_BUILD_ID_MISSING',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'VodExportPublicationError';
  }
}

export function requireExporterBuildId(metadata: WorkerVersionMetadata | undefined): string {
  const id = metadata?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new VodExportPublicationError(
      'EXPORTER_BUILD_ID_MISSING',
      'Workers Version Metadata is unavailable for the VOD exporter',
      503,
    );
  }
  return id;
}

export async function readCurrentManifest(
  bucket: R2Bucket,
  options?: { verifySnapshot?: boolean },
): Promise<CurrentVodExportManifest | null> {
  const object = await bucket.get(VOD_EXPORT_MANIFEST_KEY);
  if (object === null) return null;
  if (object.size > MANIFEST_BYTES_LIMIT) {
    throw artifactError('The public VOD manifest exceeds its maximum byte length');
  }
  assertHttpMetadata(object, PUBLIC_MANIFEST_HTTP_METADATA, 'Public VOD manifest');
  const bytes = new Uint8Array(await object.arrayBuffer());
  const manifest = parseCanonicalManifest(bytes);

  if (options?.verifySnapshot !== false) {
    await readAndVerifyPublicSnapshot(bucket, manifest);
  }
  return { manifest, bytes, etag: object.etag };
}

export async function getVodExportStatus(
  bindings: VodExportPublicationBindings,
  exporterBuildId: string,
  now = new Date(),
): Promise<VodExportStatusResult> {
  const [current, control, generationControl, fingerprint] = await Promise.all([
    readCurrentManifest(bindings.VOD_EXPORT_PUBLIC, { verifySnapshot: false }),
    readPublicationControl(bindings.VOD_EXPORT_PRIVATE),
    readGenerationControl(bindings.VOD_EXPORT_PRIVATE),
    readCurrentSourceFingerprint(bindings, exporterBuildId),
  ]);
  const publicationInProgress = control !== null && control.slot.state !== 'idle';
  const generationInProgress = generationControl !== null && generationControl.slot.state !== 'idle';
  const recoveryAvailable = control?.slot.state === 'prepared';
  const checkpoint = control?.slot.state === 'idle' ? control.slot.checkpoint : undefined;
  const changesNotPublished = current === null
    || checkpoint === undefined
    || checkpoint.manifestSha256 !== current.manifest.sha256
    || !sourceFingerprintsEqual(checkpoint.fingerprint, fingerprint);

  const unresolvedAt = control === null || control.slot.state === 'idle'
    ? null
    : control.slot.state === 'acquired' ? control.slot.acquiredAt : control.slot.preparedAt;
  const generationUnresolvedAt = generationControl?.slot.state === 'acquired'
    ? generationControl.slot.acquiredAt
    : null;
  const warnings: string[] = [];
  if (unresolvedAt !== null && now.getTime() - Date.parse(unresolvedAt) >= CONTROL_ALERT_MS) {
    warnings.push('Publication recovery has remained unresolved for more than 15 minutes.');
  }
  if (
    generationUnresolvedAt !== null
    && now.getTime() - Date.parse(generationUnresolvedAt) >= CONTROL_ALERT_MS
  ) warnings.push('Preview generation has remained unresolved for more than 15 minutes.');
  const controlWarning = warnings.length === 0 ? undefined : warnings.join(' ');

  return {
    currentPublication: current?.manifest ?? null,
    changesNotPublished,
    publicationInProgress,
    generationInProgress,
    recoveryAvailable,
    ...(controlWarning === undefined ? {} : { controlWarning }),
  };
}

/** Reconcile a prepared intent without relying on a browser-held candidate ID. */
export async function reconcileVodExportPublication(
  bindings: VodExportPublicationBindings,
  now = new Date(),
): Promise<VodExportReconcileResult> {
  const control = await readPublicationControl(bindings.VOD_EXPORT_PRIVATE);
  if (control === null || control.slot.state === 'idle') {
    const current = await readCurrentManifest(bindings.VOD_EXPORT_PUBLIC, { verifySnapshot: false });
    return { outcome: 'idle', currentPublication: current?.manifest ?? null };
  }
  if (control.slot.state === 'acquired') {
    throw new VodExportControlError(
      'PUBLICATION_IN_PROGRESS',
      'A VOD export publication is still being prepared',
      409,
      control.slot.acquiredAt,
    );
  }

  const result = await reconcilePreviousPublication(bindings, control.slot.candidateId, now);
  if (result !== null) {
    return {
      outcome: result.outcome === 'published' ? 'recovered' : 'already_published',
      currentPublication: result.currentPublication,
    };
  }

  const current = await readCurrentManifest(bindings.VOD_EXPORT_PUBLIC, { verifySnapshot: false });
  return { outcome: 'released_not_committed', currentPublication: current?.manifest ?? null };
}

export async function inspectVodExportControlRecoveryState(
  bucket: R2Bucket,
): Promise<VodExportControlRecoveryState> {
  const [generation, publication] = await Promise.all([
    readGenerationControl(bucket),
    readPublicationControl(bucket),
  ]);
  return {
    generation: generation?.slot.state === 'acquired'
      ? {
          state: 'acquired',
          ownerId: generation.slot.generationId,
          acquiredAt: generation.slot.acquiredAt,
          etag: generation.etag,
        }
      : null,
    publication: publication !== null && publication.slot.state !== 'idle'
      ? {
          state: publication.slot.state,
          ownerId: publication.slot.intentId,
          acquiredAt: publication.slot.acquiredAt,
          unresolvedSince: publication.slot.state === 'prepared'
            ? publication.slot.preparedAt
            : publication.slot.acquiredAt,
          etag: publication.etag,
          ...(publication.slot.state === 'prepared' && publication.slot.attemptsExhausted !== undefined
            ? { attemptsExhausted: publication.slot.attemptsExhausted }
            : {}),
        }
      : null,
  };
}

/**
 * Last-resort CAS release after an operator has verified from request/log state
 * that the exact owner invocation is no longer alive. This never steals merely
 * because time elapsed and never clears a changed ETag or owner ID.
 */
export async function manuallyRecoverVodExportControl(
  bindings: VodExportPublicationBindings,
  request: unknown,
  curatorIdentity: string,
  now = new Date(),
): Promise<VodExportManualControlRecoveryResult> {
  assertManualRecoveryRequest(request);

  if (request.control === 'generation') {
    const current = await readGenerationControl(bindings.VOD_EXPORT_PRIVATE);
    if (
      current === null
      || current.slot.state !== 'acquired'
      || current.slot.generationId !== request.ownerId
      || current.etag !== request.etag
    ) throw recoveryStateChanged();
    assertRecoveryOldEnough(current.slot.acquiredAt, now);
    await strictlyReleaseGenerationControl(bindings.VOD_EXPORT_PRIVATE, {
      slot: current.slot,
      etag: current.etag,
    });
    logManualRecovery(curatorIdentity, request, 'released');
    return { outcome: 'released', control: 'generation' };
  }

  const current = await readPublicationControl(bindings.VOD_EXPORT_PRIVATE);
  if (
    current === null
    || current.slot.state === 'idle'
    || current.slot.intentId !== request.ownerId
    || current.etag !== request.etag
  ) throw recoveryStateChanged();
  const unresolvedSince = current.slot.state === 'prepared'
    ? current.slot.preparedAt
    : current.slot.acquiredAt;
  assertRecoveryOldEnough(unresolvedSince, now);

  const resumed = await resumePendingPublicationResolution(
    bindings,
    current.slot.intentId,
    current.etag,
    curatorIdentity,
    request,
    now,
  );
  if (resumed !== null) return resumed;

  if (current.slot.state === 'acquired') {
    const acquiredSlot = current.slot;
    await releasePublicationWithResolution(
      bindings.DB,
      {
        intentId: acquiredSlot.intentId,
        candidateId: acquiredSlot.candidateId,
        curatorIdentity,
        outcome: 'manual_release',
        resolutionCode: 'CONFIRMED_OWNER_TERMINATED_ACQUIRED',
        ...(acquiredSlot.previousCheckpoint === undefined
          ? {}
          : { checkpoint: acquiredSlot.previousCheckpoint }),
      },
      () => strictlyReleasePublicationControl(
        bindings.VOD_EXPORT_PRIVATE,
        current.etag,
        acquiredSlot.previousCheckpoint,
      ),
      now,
    );
    logManualRecovery(curatorIdentity, request, 'released');
    return { outcome: 'released', control: 'publication' };
  }

  const preparedSlot = current.slot;
  const publicManifest = await readCurrentManifest(bindings.VOD_EXPORT_PUBLIC);
  const preparedBytes = new TextEncoder().encode(preparedSlot.manifestBody);
  const preparedManifest = parseCanonicalManifest(preparedBytes);
  if (publicManifest !== null && bytesEqual(publicManifest.bytes, preparedBytes)) {
    await finalizeCommittedPublicationStrict(bindings, preparedSlot, current.etag, now);
    logManualRecovery(curatorIdentity, request, 'reconciled');
    return { outcome: 'reconciled', control: 'publication' };
  }
  if (publicManifest !== null && stableManifestIdentityEqual(publicManifest.manifest, preparedManifest)) {
    const checkpoint = checkpointFor(
      publicManifest.manifest.sha256,
      preparedSlot.audit.sourceFingerprint,
      now,
    );
    await releasePublicationWithResolution(
      bindings.DB,
      {
        intentId: preparedSlot.intentId,
        candidateId: preparedSlot.candidateId,
        curatorIdentity: preparedSlot.audit.curatorIdentity,
        outcome: 'no_op',
        resolutionCode: 'EQUIVALENT_PUBLICATION',
        checkpoint,
      },
      () => strictlyReleasePublicationControl(
        bindings.VOD_EXPORT_PRIVATE,
        current.etag,
        checkpoint,
      ),
      now,
    );
    logManualRecovery(curatorIdentity, request, 'reconciled');
    return { outcome: 'reconciled', control: 'publication' };
  }
  if (!priorManifestStillMatches(preparedSlot, publicManifest)) {
    throw new VodExportPublicationError(
      'PUBLICATION_RECONCILIATION_REQUIRED',
      'Prepared publication cannot be released because the public manifest is not its exact prior state',
      409,
    );
  }
  await releasePublicationWithResolution(
    bindings.DB,
    {
      intentId: preparedSlot.intentId,
      candidateId: preparedSlot.candidateId,
      curatorIdentity,
      outcome: 'manual_release',
      resolutionCode: 'CONFIRMED_OWNER_TERMINATED_PREPARED_NOT_COMMITTED',
      ...(preparedSlot.previousCheckpoint === undefined
        ? {}
        : { checkpoint: preparedSlot.previousCheckpoint }),
    },
    () => strictlyReleasePublicationControl(
      bindings.VOD_EXPORT_PRIVATE,
      current.etag,
      preparedSlot.previousCheckpoint,
    ),
    now,
  );
  logManualRecovery(curatorIdentity, request, 'released');
  return { outcome: 'released', control: 'publication' };
}

export async function publishVodExportCandidate(
  bindings: VodExportPublicationBindings,
  candidateId: string,
  exporterBuildId: string,
  curatorIdentity: string,
  now = new Date(),
): Promise<VodExportPublishResult> {
  // Validate the opaque locator before allowing this POST to perform recovery
  // work for an earlier intent.
  candidateMetadataKey(candidateId);
  const reconciliation = await reconcilePreviousPublication(bindings, candidateId, now);
  if (reconciliation !== null) return reconciliation;

  const stored = await getCandidate(bindings.VOD_EXPORT_PRIVATE, candidateId, { now });
  await assertCandidateFingerprint(bindings, stored.metadata, exporterBuildId, false);
  const candidateBytes = await readAndVerifyCandidateBytes(bindings.VOD_EXPORT_PRIVATE, stored.metadata);
  await validateSnapshotBytes(candidateBytes, stored.metadata.sha256, stored.metadata.counts);

  const owned = await acquirePublicationControl(bindings.VOD_EXPORT_PRIVATE, candidateId, now);
  console.log(JSON.stringify({
    event: 'vod_export_control_acquired',
    operation: 'publish',
    ownerId: owned.slot.intentId,
    acquiredAt: owned.slot.acquiredAt,
  }));
  let controlIsAcquired = true;
  try {
    const current = await readCurrentManifest(bindings.VOD_EXPORT_PUBLIC);
    if (current === null || current.manifest.sha256 !== stored.metadata.sha256) {
      await ensurePublicSnapshot(bindings.VOD_EXPORT_PUBLIC, stored.metadata, candidateBytes, now);
    }

    const refreshed = await getCandidate(bindings.VOD_EXPORT_PRIVATE, candidateId, { now: new Date() });
    if (!sameCandidateIdentity(stored.metadata, refreshed.metadata)) {
      throw artifactError('Private candidate identity changed unexpectedly');
    }
    await assertCandidateFingerprint(bindings, refreshed.metadata, exporterBuildId, true);

    if (current !== null && stableCandidateState(current.manifest, stored.metadata)) {
      const resolvedAt = new Date();
      const checkpoint = checkpointFor(
        current.manifest.sha256,
        stored.metadata.sourceFingerprint,
        resolvedAt,
      );
      controlIsAcquired = false;
      await releasePublicationWithResolution(
        bindings.DB,
        {
          intentId: owned.slot.intentId,
          candidateId,
          curatorIdentity,
          outcome: 'no_op',
          resolutionCode: 'STABLE_IDENTITY_ALREADY_PUBLISHED',
          checkpoint,
        },
        () => releasePublicationControl(
          bindings.VOD_EXPORT_PRIVATE,
          owned.slot.intentId,
          owned.etag,
          checkpoint,
        ),
        resolvedAt,
      );
      controlIsAcquired = false;
      return {
        outcome: 'already_published',
        currentPublication: current.manifest,
        warnings: [],
      };
    }

    const publishedAt = new Date().toISOString();
    const manifest: VodExportManifest = {
      schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
      snapshotUrl: stored.metadata.snapshotUrl,
      sha256: stored.metadata.sha256,
      publishedAt,
      uncompressedBytes: stored.metadata.uncompressedBytes,
      counts: stored.metadata.counts,
    };
    const manifestBytes = serializeCanonicalManifest(manifest);
    const audit = createPreparedAudit(
      stored.metadata,
      current?.manifest ?? null,
      curatorIdentity,
      publishedAt,
    );
    const prepared = await preparePublicationControl(bindings.VOD_EXPORT_PRIVATE, owned, {
      preparedAt: new Date().toISOString(),
      expectedManifestEtag: current?.etag ?? null,
      expectedManifestBody: current === null ? null : decodeUtf8(current.bytes, 'public manifest'),
      manifestBody: decodeUtf8(manifestBytes, 'prepared manifest'),
      audit,
    });
    controlIsAcquired = false;

    const commit = await commitPreparedManifest(
      bindings,
      prepared.slot,
      prepared.etag,
      manifest,
      manifestBytes,
    );
    if (commit.kind === 'equivalent') {
      const resolvedAt = new Date();
      const checkpoint = checkpointFor(
        commit.current.manifest.sha256,
        stored.metadata.sourceFingerprint,
        resolvedAt,
      );
      await releasePublicationWithResolution(
        bindings.DB,
        {
          intentId: prepared.slot.intentId,
          candidateId,
          curatorIdentity,
          outcome: 'no_op',
          resolutionCode: 'EQUIVALENT_PUBLICATION',
          checkpoint,
        },
        () => releasePublicationControl(
          bindings.VOD_EXPORT_PRIVATE,
          prepared.slot.intentId,
          commit.controlEtag,
          checkpoint,
        ),
        resolvedAt,
      );
      return {
        outcome: 'already_published',
        currentPublication: commit.current.manifest,
        warnings: [],
      };
    }

    const warnings: string[] = [];
    try {
      await finalizeCommittedPublication(bindings, prepared.slot, commit.controlEtag, new Date());
    } catch (error) {
      console.error(JSON.stringify({
        event: 'vod_export_post_commit_recovery_pending',
        intentId: prepared.slot.intentId,
        error: safeErrorMessage(error),
      }));
      warnings.push('The public manifest advanced, but private audit or cleanup recovery is still pending.');
    }
    return { outcome: 'published', currentPublication: manifest, warnings };
  } catch (error) {
    if (controlIsAcquired) {
      try {
        const resolvedAt = new Date();
        await releasePublicationWithResolution(
          bindings.DB,
          {
            intentId: owned.slot.intentId,
            candidateId,
            curatorIdentity,
            outcome: error instanceof VodExportPublicationError && error.code === 'PUBLICATION_CONFLICT'
              ? 'conflict'
              : 'pre_commit_failed',
            resolutionCode: resolutionCodeForError(error),
            ...(owned.slot.previousCheckpoint === undefined
              ? {}
              : { checkpoint: owned.slot.previousCheckpoint }),
          },
          () => releasePublicationControl(
            bindings.VOD_EXPORT_PRIVATE,
            owned.slot.intentId,
            owned.etag,
            owned.slot.previousCheckpoint,
          ),
          resolvedAt,
        );
      } catch (releaseError) {
        console.error(JSON.stringify({
          event: 'vod_export_publication_control_release_failed',
          intentId: owned.slot.intentId,
          error: safeErrorMessage(releaseError),
        }));
      }
    }
    throw error;
  }
}

async function reconcilePreviousPublication(
  bindings: VodExportPublicationBindings,
  requestedCandidateId: string,
  now: Date,
): Promise<VodExportPublishResult | null> {
  const control = await readPublicationControl(bindings.VOD_EXPORT_PRIVATE);
  if (control === null || control.slot.state === 'idle') return null;
  if (control.slot.state === 'acquired') {
    throw new VodExportControlError(
      'PUBLICATION_IN_PROGRESS',
      'Another VOD export publication requires completion or reconciliation',
      409,
      control.slot.acquiredAt,
    );
  }

  const preparedSlot = control.slot;

  const current = await readCurrentManifest(bindings.VOD_EXPORT_PUBLIC);
  const preparedBytes = new TextEncoder().encode(preparedSlot.manifestBody);
  const preparedManifest = parseCanonicalManifest(preparedBytes);
  if (current !== null && bytesEqual(current.bytes, preparedBytes)) {
    await finalizeCommittedPublication(bindings, preparedSlot, control.etag, now);
    if (preparedSlot.candidateId === requestedCandidateId) {
      return { outcome: 'published', currentPublication: current.manifest, warnings: [] };
    }
    return null;
  }

  if (current !== null && stableManifestIdentityEqual(current.manifest, preparedManifest)) {
    const checkpoint = checkpointFor(current.manifest.sha256, preparedSlot.audit.sourceFingerprint, now);
    await releasePublicationWithResolution(
      bindings.DB,
      {
        intentId: preparedSlot.intentId,
        candidateId: preparedSlot.candidateId,
        curatorIdentity: preparedSlot.audit.curatorIdentity,
        outcome: 'no_op',
        resolutionCode: 'EQUIVALENT_PUBLICATION',
        checkpoint,
      },
      () => releasePublicationControl(
        bindings.VOD_EXPORT_PRIVATE,
        preparedSlot.intentId,
        control.etag,
        checkpoint,
      ),
      now,
    );
    if (preparedSlot.candidateId === requestedCandidateId) {
      return { outcome: 'already_published', currentPublication: current.manifest, warnings: [] };
    }
    return null;
  }

  if (preparedSlot.attemptsExhausted === true && priorManifestStillMatches(preparedSlot, current)) {
    await releasePublicationWithResolution(
      bindings.DB,
      {
        intentId: preparedSlot.intentId,
        candidateId: preparedSlot.candidateId,
        curatorIdentity: preparedSlot.audit.curatorIdentity,
        outcome: 'pre_commit_failed',
        resolutionCode: 'MANIFEST_ATTEMPTS_EXHAUSTED_NOT_COMMITTED',
        ...(preparedSlot.previousCheckpoint === undefined
          ? {}
          : { checkpoint: preparedSlot.previousCheckpoint }),
      },
      () => releasePublicationControl(
        bindings.VOD_EXPORT_PRIVATE,
        preparedSlot.intentId,
        control.etag,
        preparedSlot.previousCheckpoint,
      ),
      now,
    );
    return null;
  }

  throw new VodExportPublicationError(
    'PUBLICATION_RECONCILIATION_REQUIRED',
    'A previous prepared publication cannot yet be classified safely',
    409,
  );
}

async function commitPreparedManifest(
  bindings: VodExportPublicationBindings,
  initialSlot: PublicationPreparedSlot,
  initialControlEtag: string,
  desiredManifest: VodExportManifest,
  desiredBytes: Uint8Array,
): Promise<
  | { kind: 'committed'; controlEtag: string }
  | { kind: 'equivalent'; controlEtag: string; current: CurrentVodExportManifest }
> {
  let slot = initialSlot;
  let controlEtag = initialControlEtag;
  const manifestChecksum = await sha256Hex(desiredBytes);

  for (let attempt = 0; attempt < MANIFEST_ATTEMPTS; attempt += 1) {
    let failureKind: 'precondition' | 'ambiguous' | null = null;
    await assertPreparedControlOwnership(
      bindings.VOD_EXPORT_PRIVATE,
      slot,
      controlEtag,
    );
    try {
      const result = await bindings.VOD_EXPORT_PUBLIC.put(VOD_EXPORT_MANIFEST_KEY, desiredBytes, {
        onlyIf: slot.expectedManifestEtag === null
          ? new Headers({ 'If-None-Match': '*' })
          : { etagMatches: slot.expectedManifestEtag },
        httpMetadata: PUBLIC_MANIFEST_HTTP_METADATA,
        customMetadata: {
          kind: 'vod-export-manifest-v1',
          sha256: desiredManifest.sha256,
          publishedAt: desiredManifest.publishedAt,
        },
        sha256: manifestChecksum,
      });
      if (result !== null) return { kind: 'committed', controlEtag };
      failureKind = 'precondition';
    } catch (error) {
      failureKind = 'ambiguous';
      console.warn(JSON.stringify({
        event: 'vod_export_manifest_write_ambiguous',
        intentId: slot.intentId,
        attempt: attempt + 1,
        error: safeErrorMessage(error),
      }));
    }

    if (failureKind !== null) {
      const current = await readCurrentManifest(bindings.VOD_EXPORT_PUBLIC);
      if (current !== null && bytesEqual(current.bytes, desiredBytes)) {
        return { kind: 'committed', controlEtag };
      }
      if (current !== null && stableManifestIdentityEqual(current.manifest, desiredManifest)) {
        return { kind: 'equivalent', controlEtag, current };
      }
      if (!priorManifestStillMatches(slot, current)) {
        if (failureKind === 'precondition') {
          const resolvedAt = new Date();
          await releasePublicationWithResolution(
            bindings.DB,
            {
              intentId: slot.intentId,
              candidateId: slot.candidateId,
              curatorIdentity: slot.audit.curatorIdentity,
              outcome: 'conflict',
              resolutionCode: 'PUBLICATION_CONFLICT',
              ...(slot.previousCheckpoint === undefined
                ? {}
                : { checkpoint: slot.previousCheckpoint }),
            },
            () => releasePublicationControl(
              bindings.VOD_EXPORT_PRIVATE,
              slot.intentId,
              controlEtag,
              slot.previousCheckpoint,
            ),
            resolvedAt,
          );
        }
        throw new VodExportPublicationError(
          'PUBLICATION_CONFLICT',
          'The public VOD manifest changed during conditional publication',
          409,
        );
      }
    }

    const latestControl = await readPublicationControl(bindings.VOD_EXPORT_PRIVATE);
    if (
      latestControl === null
      || latestControl.slot.state !== 'prepared'
      || latestControl.slot.intentId !== slot.intentId
    ) {
      throw new VodExportControlError(
        'CONTROL_OWNERSHIP_LOST',
        'Prepared publication control ownership was lost',
        409,
      );
    }
    slot = latestControl.slot;
    controlEtag = latestControl.etag;

    if (attempt + 1 < MANIFEST_ATTEMPTS) {
      await wait(MANIFEST_RETRY_MS);
      continue;
    }

    slot = { ...slot, attemptsExhausted: true };
    const updated = await updatePreparedPublicationControl(
      bindings.VOD_EXPORT_PRIVATE,
      slot,
      controlEtag,
    );
    controlEtag = updated.etag;
  }

  throw new VodExportPublicationError(
    'PUBLICATION_RECONCILIATION_REQUIRED',
    'Manifest publication attempts were exhausted and require direct-state reconciliation',
    503,
  );
}

async function assertPreparedControlOwnership(
  bucket: R2Bucket,
  slot: PublicationPreparedSlot,
  expectedEtag: string,
): Promise<void> {
  const current = await readPublicationControl(bucket);
  if (
    current === null
    || current.slot.state !== 'prepared'
    || current.slot.intentId !== slot.intentId
    || current.etag !== expectedEtag
  ) {
    throw new VodExportControlError(
      'CONTROL_OWNERSHIP_LOST',
      'Prepared publication control changed before manifest cutover',
      409,
    );
  }
}

async function finalizeCommittedPublication(
  bindings: VodExportPublicationBindings,
  slot: PublicationPreparedSlot,
  controlEtag: string,
  now: Date,
): Promise<void> {
  await persistPublicationAudit(bindings.DB, slot.intentId, slot.audit);
  await deleteCandidateById(bindings.VOD_EXPORT_PRIVATE, slot.candidateId);
  await releasePublicationControl(
    bindings.VOD_EXPORT_PRIVATE,
    slot.intentId,
    controlEtag,
    checkpointFor(slot.audit.candidateSha256, slot.audit.sourceFingerprint, now),
  );
}

async function finalizeCommittedPublicationStrict(
  bindings: VodExportPublicationBindings,
  slot: PublicationPreparedSlot,
  inspectedControlEtag: string,
  now: Date,
): Promise<void> {
  await persistPublicationAudit(bindings.DB, slot.intentId, slot.audit);
  await deleteCandidateById(bindings.VOD_EXPORT_PRIVATE, slot.candidateId);
  await strictlyReleasePublicationControl(
    bindings.VOD_EXPORT_PRIVATE,
    inspectedControlEtag,
    checkpointFor(slot.audit.candidateSha256, slot.audit.sourceFingerprint, now),
  );
}

async function persistPublicationAudit(
  db: D1Database,
  intentId: string,
  audit: PreparedPublicationAudit,
): Promise<void> {
  const retainedUntil = addUtcYears(audit.publishedAt, 2);
  await db.prepare(`
    INSERT INTO vod_export_publication_audits (
      intent_id, candidate_id, curator_identity, schema_version,
      candidate_sha256, previous_sha256, snapshot_url, previous_snapshot_url,
      streamer_count, vod_count, performance_count, warning_count,
      source_db_id, source_db_revision, source_nova_db_id,
      source_nova_revision, exporter_build_id, published_at,
      identity_retained_until, identity_removed_at, snapshot_unreferenced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(intent_id) DO NOTHING
  `).bind(
    intentId,
    audit.candidateId,
    audit.curatorIdentity,
    audit.schemaVersion,
    audit.candidateSha256,
    audit.previousSha256,
    audit.snapshotUrl,
    audit.previousSnapshotUrl,
    audit.streamerCount,
    audit.vodCount,
    audit.performanceCount,
    audit.warningCount,
    audit.sourceFingerprint.dbId,
    audit.sourceFingerprint.dbRevision,
    audit.sourceFingerprint.novaDbId,
    audit.sourceFingerprint.novaRevision,
    audit.sourceFingerprint.exporterBuildId,
    audit.publishedAt,
    retainedUntil,
  ).run();

  const saved = await db.withSession('first-primary')
    .prepare(`
      SELECT candidate_id, curator_identity, schema_version, candidate_sha256,
             previous_sha256, snapshot_url, previous_snapshot_url,
             streamer_count, vod_count, performance_count, warning_count,
             source_db_id, source_db_revision, source_nova_db_id,
             source_nova_revision, exporter_build_id, published_at,
             identity_retained_until, identity_removed_at
      FROM vod_export_publication_audits
      WHERE intent_id = ?
    `)
    .bind(intentId)
    .first<Record<string, string | number | null>>();
  if (!auditRowMatches(saved, audit, retainedUntil)) {
    throw new VodExportPublicationError(
      'PUBLICATION_RECONCILIATION_REQUIRED',
      'Successful publication audit state could not be verified',
      503,
    );
  }

  const statements: D1PreparedStatement[] = [db.prepare(`
    UPDATE vod_export_publication_audits
    SET snapshot_unreferenced_at = NULL
    WHERE candidate_sha256 = ? AND snapshot_url = ?
  `).bind(audit.candidateSha256, audit.snapshotUrl)];
  if (
    audit.previousSha256 !== null
    && audit.previousSnapshotUrl !== null
    && (
      audit.previousSha256 !== audit.candidateSha256
      || audit.previousSnapshotUrl !== audit.snapshotUrl
    )
  ) {
    statements.push(db.prepare(`
      UPDATE vod_export_publication_audits
      SET snapshot_unreferenced_at = COALESCE(snapshot_unreferenced_at, ?)
      WHERE candidate_sha256 = ? AND snapshot_url = ?
    `).bind(audit.publishedAt, audit.previousSha256, audit.previousSnapshotUrl));
  }
  await db.batch(statements);
}

async function releasePublicationWithResolution(
  db: D1Database,
  input: PublicationResolutionInput,
  release: () => Promise<void>,
  now: Date,
): Promise<void> {
  await persistPublicationResolutionIntent(db, input, now);
  await release();
  await finalizePublicationResolution(db, input.intentId, now);
}

async function resumePendingPublicationResolution(
  bindings: VodExportPublicationBindings,
  intentId: string,
  expectedEtag: string,
  curatorIdentity: string,
  request: VodExportManualControlRecoveryRequest,
  now: Date,
): Promise<VodExportManualControlRecoveryResult | null> {
  const saved = await bindings.DB.withSession('first-primary').prepare(`
    SELECT outcome, checkpoint_json, finalized_at
    FROM vod_export_publication_resolutions
    WHERE intent_id = ?
  `).bind(intentId).first<{
    outcome: PublicationResolutionOutcome;
    checkpoint_json: string | null;
    finalized_at: string | null;
  }>();
  if (saved === null || saved.finalized_at !== null) return null;

  const checkpoint = parseStoredCheckpoint(saved.checkpoint_json);
  await strictlyReleasePublicationControl(
    bindings.VOD_EXPORT_PRIVATE,
    expectedEtag,
    checkpoint,
  );
  await finalizePublicationResolution(bindings.DB, intentId, now);
  const outcome = saved.outcome === 'no_op' ? 'reconciled' : 'released';
  logManualRecovery(curatorIdentity, request, outcome);
  return { outcome, control: 'publication' };
}

async function persistPublicationResolutionIntent(
  db: D1Database,
  input: PublicationResolutionInput,
  now: Date,
): Promise<void> {
  await db.prepare(`
    INSERT INTO vod_export_publication_resolutions (
      intent_id, candidate_id, curator_identity, outcome, resolution_code,
      checkpoint_json, recorded_at, finalized_at, delete_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(intent_id) DO NOTHING
  `).bind(
    input.intentId,
    input.candidateId,
    input.curatorIdentity,
    input.outcome,
    input.resolutionCode,
    input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint),
    now.toISOString(),
  ).run();

  const saved = await db.withSession('first-primary').prepare(`
    SELECT candidate_id, curator_identity, outcome, resolution_code, checkpoint_json
    FROM vod_export_publication_resolutions
    WHERE intent_id = ?
  `).bind(input.intentId).first<Record<string, string | null>>();
  const checkpointJson = input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint);
  if (
    saved === null
    || saved.candidate_id !== input.candidateId
    || saved.curator_identity !== input.curatorIdentity
    || saved.outcome !== input.outcome
    || saved.resolution_code !== input.resolutionCode
    || saved.checkpoint_json !== checkpointJson
  ) {
    throw new VodExportPublicationError(
      'PUBLICATION_RECONCILIATION_REQUIRED',
      'Publication resolution history could not be verified',
      503,
    );
  }
}

async function finalizePublicationResolution(
  db: D1Database,
  intentId: string,
  now: Date,
): Promise<void> {
  const finalizedAt = now.toISOString();
  const deleteAfter = new Date(now.getTime() + RESOLUTION_RETENTION_MS).toISOString();
  await db.prepare(`
    UPDATE vod_export_publication_resolutions
    SET finalized_at = COALESCE(finalized_at, ?),
        delete_after = COALESCE(delete_after, ?)
    WHERE intent_id = ?
  `).bind(finalizedAt, deleteAfter, intentId).run();

  const saved = await db.withSession('first-primary').prepare(`
    SELECT finalized_at, delete_after
    FROM vod_export_publication_resolutions
    WHERE intent_id = ?
  `).bind(intentId).first<{ finalized_at: string | null; delete_after: string | null }>();
  if (saved === null || saved.finalized_at === null || saved.delete_after === null) {
    throw new VodExportPublicationError(
      'PUBLICATION_RECONCILIATION_REQUIRED',
      'Publication resolution finalization could not be verified',
      503,
    );
  }
}

function parseStoredCheckpoint(value: string | null): SourceEquivalenceCheckpoint | undefined {
  if (value === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new VodExportPublicationError(
      'PUBLICATION_RECONCILIATION_REQUIRED',
      'Stored publication resolution checkpoint is invalid',
      503,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidStoredCheckpoint();
  }
  const checkpoint = parsed as Record<string, unknown>;
  const fingerprint = checkpoint.fingerprint;
  if (
    typeof checkpoint.manifestSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(checkpoint.manifestSha256)
    || typeof checkpoint.verifiedAt !== 'string'
    || !isCanonicalTimestamp(checkpoint.verifiedAt)
    || fingerprint === null
    || typeof fingerprint !== 'object'
    || Array.isArray(fingerprint)
  ) throw invalidStoredCheckpoint();
  const source = fingerprint as Record<string, unknown>;
  if (
    typeof source.dbId !== 'string'
    || source.dbId.length === 0
    || typeof source.dbRevision !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(source.dbRevision)
    || typeof source.novaDbId !== 'string'
    || source.novaDbId.length === 0
    || typeof source.novaRevision !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(source.novaRevision)
    || source.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION
    || typeof source.exporterBuildId !== 'string'
    || source.exporterBuildId.length === 0
  ) throw invalidStoredCheckpoint();
  return parsed as SourceEquivalenceCheckpoint;
}

function invalidStoredCheckpoint(): VodExportPublicationError {
  return new VodExportPublicationError(
    'PUBLICATION_RECONCILIATION_REQUIRED',
    'Stored publication resolution checkpoint is invalid',
    503,
  );
}

function auditRowMatches(
  saved: Record<string, string | number | null> | null,
  audit: PreparedPublicationAudit,
  retainedUntil: string,
): boolean {
  return saved !== null
    && saved.candidate_id === audit.candidateId
    && saved.curator_identity === audit.curatorIdentity
    && saved.schema_version === audit.schemaVersion
    && saved.candidate_sha256 === audit.candidateSha256
    && saved.previous_sha256 === audit.previousSha256
    && saved.snapshot_url === audit.snapshotUrl
    && saved.previous_snapshot_url === audit.previousSnapshotUrl
    && saved.streamer_count === audit.streamerCount
    && saved.vod_count === audit.vodCount
    && saved.performance_count === audit.performanceCount
    && saved.warning_count === audit.warningCount
    && saved.source_db_id === audit.sourceFingerprint.dbId
    && saved.source_db_revision === audit.sourceFingerprint.dbRevision
    && saved.source_nova_db_id === audit.sourceFingerprint.novaDbId
    && saved.source_nova_revision === audit.sourceFingerprint.novaRevision
    && saved.exporter_build_id === audit.sourceFingerprint.exporterBuildId
    && saved.published_at === audit.publishedAt
    && saved.identity_retained_until === retainedUntil
    && saved.identity_removed_at === null;
}

async function ensurePublicSnapshot(
  bucket: R2Bucket,
  candidate: VodExportCandidateMetadata,
  bytes: Uint8Array,
  now: Date,
): Promise<void> {
  const key = snapshotObjectKey(candidate.sha256);
  await createBytesObject(bucket, key, bytes, {
    httpMetadata: PUBLIC_SNAPSHOT_HTTP_METADATA,
    customMetadata: {
      kind: 'vod-export-snapshot-v1',
      sha256: candidate.sha256,
      unreferencedAt: now.toISOString(),
    },
    sha256: candidate.sha256,
  });
  const manifestShape: VodExportManifest = {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: candidate.snapshotUrl,
    sha256: candidate.sha256,
    publishedAt: now.toISOString(),
    uncompressedBytes: candidate.uncompressedBytes,
    counts: candidate.counts,
  };
  await readAndVerifyPublicSnapshot(bucket, manifestShape);
}

async function readAndVerifyPublicSnapshot(
  bucket: R2Bucket,
  manifest: VodExportManifest,
): Promise<Uint8Array> {
  const object = await bucket.get(snapshotObjectKey(manifest.sha256));
  if (object === null) throw artifactError('The public manifest references a missing snapshot');
  assertHttpMetadata(object, PUBLIC_SNAPSHOT_HTTP_METADATA, 'Public VOD snapshot');
  if (object.size !== manifest.uncompressedBytes || object.size > VOD_EXPORT_LIMITS.snapshotBytes) {
    throw artifactError('The public snapshot byte length does not match its manifest');
  }
  const storedChecksum = checksumSha256Hex(object);
  if (storedChecksum !== null && storedChecksum !== manifest.sha256) {
    throw artifactError('The public snapshot R2 checksum does not match its manifest');
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  await validateSnapshotBytes(bytes, manifest.sha256, manifest.counts);
  return bytes;
}

async function validateSnapshotBytes(
  bytes: Uint8Array,
  expectedSha256: string,
  expectedCounts: VodExportCounts,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes, 'snapshot')) as unknown;
  } catch (error) {
    if (error instanceof VodExportPublicationError) throw error;
    throw artifactError('Snapshot bytes are not valid JSON');
  }
  let canonical: Uint8Array;
  let counts: VodExportCounts;
  try {
    assertPublishedSnapshotSemantics(value as VodExportSnapshot);
    canonical = serializeCanonicalSnapshot(orderSnapshot(value as VodExportSnapshot));
    counts = countSnapshot(value as VodExportSnapshot);
  } catch {
    throw artifactError('Snapshot bytes do not conform to the canonical v1 schema');
  }
  if (!bytesEqual(bytes, canonical) || !countsEqual(counts, expectedCounts)) {
    throw artifactError('Snapshot bytes or counts do not match the canonical v1 identity');
  }
  await verifyHash(bytes, expectedSha256);
}

function assertPublishedSnapshotSemantics(snapshot: VodExportSnapshot): void {
  if (snapshot.schemaVersion !== VOD_EXPORT_SCHEMA_VERSION || !Array.isArray(snapshot.streamers)) {
    throw artifactError('Snapshot schema version or streamer collection is invalid');
  }
  const slugs = new Set<string>();
  const channelIds = new Set<string>();
  for (const streamer of snapshot.streamers) {
    if (
      typeof streamer.slug !== 'string'
      || !isValidStreamerSlug(streamer.slug)
      || slugs.has(streamer.slug)
      || !isCanonicalDisplayText(streamer.displayName)
      || !isValidOpaqueIdentity(streamer.youtubeChannelId)
      || channelIds.has(streamer.youtubeChannelId)
      || !Array.isArray(streamer.vods)
    ) throw artifactError('Snapshot streamer identity or display fields are invalid');
    slugs.add(streamer.slug);
    channelIds.add(streamer.youtubeChannelId);

    if (
      streamer.avatarUrl !== null
      && !isExactSafeUrl(streamer.avatarUrl, 'avatar')
    ) throw artifactError('Snapshot avatar URL is invalid');
    if (streamer.group !== null && !isCanonicalDisplayText(streamer.group)) {
      throw artifactError('Snapshot group text is invalid');
    }
    for (const provider of SOCIAL_PROVIDERS) {
      const link = streamer.socialLinks[provider];
      if (link !== undefined && !isExactSafeUrl(link, provider)) {
        throw artifactError('Snapshot social URL is invalid');
      }
    }

    const videoIds = new Set<string>();
    for (const vod of streamer.vods) {
      if (
        !isCanonicalDisplayText(vod.title)
        || typeof vod.date !== 'string'
        || !isValidDateOnly(vod.date)
        || typeof vod.videoId !== 'string'
        || !isValidVideoId(vod.videoId)
        || videoIds.has(vod.videoId)
        || !Array.isArray(vod.performances)
        || vod.performances.length === 0
      ) throw artifactError('Snapshot VOD identity or display fields are invalid');
      videoIds.add(vod.videoId);
      for (const performance of vod.performances) {
        if (
          !isValidOpaqueIdentity(performance.performanceId)
          || !isValidOpaqueIdentity(performance.songId)
          || !isCanonicalDisplayText(performance.title)
          || (performance.originalArtist !== null && !isCanonicalDisplayText(performance.originalArtist))
          || !Number.isSafeInteger(performance.startSeconds)
          || performance.startSeconds < 0
          || !Number.isSafeInteger(performance.endSeconds)
          || performance.endSeconds <= performance.startSeconds
        ) throw artifactError('Snapshot performance identity, text, or timestamp range is invalid');
      }
    }
  }
}

function isCanonicalDisplayText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeDisplayText(value);
  return normalized.kind === 'value' && normalized.value === value;
}

function isValidOpaqueIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && !isBlankText(value)
    && hasValidUnicodeScalars(value);
}

function isExactSafeUrl(
  value: string,
  provider: Parameters<typeof validateOptionalSafeUrl>[1],
): boolean {
  const result = validateOptionalSafeUrl(value, provider);
  return result.kind === 'safe' && result.url === value;
}

async function verifyHash(bytes: Uint8Array, expectedSha256: string): Promise<void> {
  if (await sha256Hex(bytes) !== expectedSha256) {
    throw artifactError('Snapshot content hash does not match its expected SHA-256');
  }
}

function parseCanonicalManifest(bytes: Uint8Array): VodExportManifest {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes, 'manifest')) as unknown;
  } catch (error) {
    if (error instanceof VodExportPublicationError) throw error;
    throw artifactError('The public VOD manifest is not valid JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw artifactError('The public VOD manifest has an invalid schema');
  }
  const manifest = value as VodExportManifest;
  let canonical: Uint8Array;
  try {
    canonical = serializeCanonicalManifest(manifest);
  } catch {
    throw artifactError('The public VOD manifest does not conform to the canonical v1 schema');
  }
  if (!bytesEqual(bytes, canonical)) {
    throw artifactError('The public VOD manifest is not canonical v1 JSON');
  }
  return manifest;
}

async function assertCandidateFingerprint(
  bindings: VodExportSourceBindings,
  candidate: VodExportCandidateMetadata,
  exporterBuildId: string,
  ordered: boolean,
): Promise<void> {
  if (candidate.sourceFingerprint.exporterBuildId !== exporterBuildId) {
    throw new VodExportPublicationError(
      'CANDIDATE_STALE',
      'The exporter deployment changed after this candidate was generated',
      409,
    );
  }
  const current = ordered
    ? await readOrderedPublicationFingerprint(bindings, exporterBuildId)
    : await readCurrentSourceFingerprint(bindings, exporterBuildId);
  if (!sourceFingerprintsEqual(candidate.sourceFingerprint, current)) {
    throw new VodExportPublicationError(
      'CANDIDATE_STALE',
      'Approved source data changed after this candidate was generated',
      409,
    );
  }
}

function createPreparedAudit(
  candidate: VodExportCandidateMetadata,
  current: VodExportManifest | null,
  curatorIdentity: string,
  publishedAt: string,
): PreparedPublicationAudit {
  return {
    curatorIdentity,
    candidateId: candidate.candidateId,
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    candidateSha256: candidate.sha256,
    previousSha256: current?.sha256 ?? null,
    snapshotUrl: candidate.snapshotUrl,
    previousSnapshotUrl: current?.snapshotUrl ?? null,
    streamerCount: candidate.counts.streamers,
    vodCount: candidate.counts.vods,
    performanceCount: candidate.counts.performances,
    warningCount: candidate.warningCount,
    sourceFingerprint: candidate.sourceFingerprint,
    publishedAt,
  };
}

function priorManifestStillMatches(
  slot: PublicationPreparedSlot,
  current: CurrentVodExportManifest | null,
): boolean {
  if (slot.expectedManifestBody === null || slot.expectedManifestEtag === null) return current === null;
  return current !== null
    && current.etag === slot.expectedManifestEtag
    && decodeUtf8(current.bytes, 'public manifest') === slot.expectedManifestBody;
}

export function stableCandidateState(
  manifest: VodExportManifest | null,
  candidate: VodExportCandidateMetadata,
): boolean {
  return manifest !== null
    && manifest.schemaVersion === candidate.schemaVersion
    && manifest.snapshotUrl === candidate.snapshotUrl
    && manifest.sha256 === candidate.sha256
    && manifest.uncompressedBytes === candidate.uncompressedBytes
    && countsEqual(manifest.counts, candidate.counts);
}

function stableManifestIdentityEqual(left: VodExportManifest, right: VodExportManifest): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.snapshotUrl === right.snapshotUrl
    && left.sha256 === right.sha256
    && left.uncompressedBytes === right.uncompressedBytes
    && countsEqual(left.counts, right.counts);
}

function sameCandidateIdentity(left: VodExportCandidateMetadata, right: VodExportCandidateMetadata): boolean {
  return left.candidateId === right.candidateId
    && left.sha256 === right.sha256
    && left.uncompressedBytes === right.uncompressedBytes
    && countsEqual(left.counts, right.counts)
    && sourceFingerprintsEqual(left.sourceFingerprint, right.sourceFingerprint);
}

function checkpointFor(
  manifestSha256: string,
  fingerprint: VodExportSourceFingerprint,
  now: Date,
): SourceEquivalenceCheckpoint {
  return { manifestSha256, fingerprint, verifiedAt: now.toISOString() };
}

function countsEqual(left: VodExportCounts, right: VodExportCounts): boolean {
  return left.streamers === right.streamers
    && left.vods === right.vods
    && left.performances === right.performances;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw artifactError(`The ${label} is not valid UTF-8`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function addUtcYears(timestamp: string, years: number): string {
  const date = new Date(timestamp);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function assertManualRecoveryRequest(
  value: unknown,
): asserts value is VodExportManualControlRecoveryRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VodExportPublicationError(
      'CONTROL_RECOVERY_CONFIRMATION_REQUIRED',
      'Manual control recovery requires the exact current owner, ETag, confirmation, and reason',
      400,
    );
  }
  const request = value as Record<string, unknown>;
  const reason = request.reason;
  if (
    (request.control !== 'generation' && request.control !== 'publication')
    || typeof request.ownerId !== 'string'
    || request.ownerId.length === 0
    || typeof request.etag !== 'string'
    || request.etag.length === 0
    || request.confirmation !== VOD_EXPORT_MANUAL_RECOVERY_CONFIRMATION
    || typeof reason !== 'string'
    || isBlankText(reason)
    || reason.length > 500
    || !hasValidUnicodeScalars(reason)
  ) {
    throw new VodExportPublicationError(
      'CONTROL_RECOVERY_CONFIRMATION_REQUIRED',
      'Manual control recovery requires the exact current owner, ETag, confirmation, and a bounded reason',
      400,
    );
  }
}

function assertRecoveryOldEnough(unresolvedSince: string, now: Date): void {
  if (now.getTime() - Date.parse(unresolvedSince) < CONTROL_ALERT_MS) {
    throw new VodExportPublicationError(
      'CONTROL_RECOVERY_TOO_EARLY',
      'Manual control recovery is available only after the 15-minute unresolved-owner alert threshold',
      409,
    );
  }
}

function recoveryStateChanged(): VodExportPublicationError {
  return new VodExportPublicationError(
    'CONTROL_RECOVERY_STATE_CHANGED',
    'VOD export control state changed; inspect it again before any recovery attempt',
    409,
  );
}

function logManualRecovery(
  curatorIdentity: string,
  request: VodExportManualControlRecoveryRequest,
  outcome: VodExportManualControlRecoveryResult['outcome'],
): void {
  console.warn(JSON.stringify({
    event: 'vod_export_manual_control_recovery',
    control: request.control,
    ownerId: request.ownerId,
    expectedEtag: request.etag,
    curatorIdentity,
    reason: request.reason.trim(),
    outcome,
  }));
}

function resolutionCodeForError(error: unknown): string {
  if (
    error instanceof VodExportPublicationError
    || error instanceof VodExportControlError
    || error instanceof VodExportCandidateError
  ) return error.code;
  return 'PRE_COMMIT_OPERATION_FAILED';
}

function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function artifactError(message: string): VodExportPublicationError {
  return new VodExportPublicationError('PUBLIC_ARTIFACT_INVALID', message, 503);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

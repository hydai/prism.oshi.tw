import { createSnapshotArtifact } from './canonical-json';
import { storeCandidate, type VodExportCandidateMetadata } from './candidate';
import { acquireGenerationControl, releaseGenerationControl } from './control';
import { ExportLimitExceededError } from './limits';
import {
  readCurrentSourceFingerprint,
  readVodExportSource,
  sourceFingerprintsEqual,
  VodExportSourceError,
  type VodExportSourceBindings,
} from './source';
import { buildVodExportSnapshot } from './validation';
import type { CapacityDiagnostic, VodExportFinding } from './types';

const GENERATION_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300] as const;

export interface VodExportServiceBindings extends VodExportSourceBindings {
  VOD_EXPORT_PRIVATE: R2Bucket;
}

export interface VodExportPreviewResult {
  canPublish: boolean;
  findings: VodExportFinding[];
  capacity: CapacityDiagnostic[];
  candidate?: VodExportCandidateMetadata;
}

export class VodExportServiceError extends Error {
  constructor(
    readonly code: 'SOURCE_CHANGED_DURING_GENERATION' | 'EXPORT_LIMIT_EXCEEDED',
    message: string,
    readonly status: number,
    readonly details?: Readonly<Record<string, string | number>>,
  ) {
    super(message);
    this.name = 'VodExportServiceError';
  }
}

export async function generateVodExportPreview(
  bindings: VodExportServiceBindings,
  exporterBuildId: string,
): Promise<VodExportPreviewResult> {
  const control = await acquireGenerationControl(bindings.VOD_EXPORT_PRIVATE);
  console.log(JSON.stringify({
    event: 'vod_export_control_acquired',
    operation: 'preview',
    ownerId: control.slot.generationId,
    acquiredAt: control.slot.acquiredAt,
  }));
  let operationError: unknown;
  try {
    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
      try {
        const source = await readVodExportSource(bindings, exporterBuildId);
        const build = buildVodExportSnapshot(source.data);
        const endingFingerprint = await readCurrentSourceFingerprint(bindings, exporterBuildId);
        if (!sourceFingerprintsEqual(source.fingerprint, endingFingerprint)) {
          if (attempt + 1 < GENERATION_ATTEMPTS) {
            await waitBeforeRetry(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[1]);
            continue;
          }
          throw new VodExportServiceError(
            'SOURCE_CHANGED_DURING_GENERATION',
            'Approved source data changed during all candidate generation attempts',
            409,
          );
        }

        if (!build.canPublish || build.snapshot === null) {
          return {
            canPublish: false,
            findings: build.findings,
            capacity: build.capacity,
          };
        }

        const artifact = await createSnapshotArtifact(build.snapshot);
        artifact.capacity = mergeCapacity(build.capacity, artifact.capacity);
        const candidate = await storeCandidate(
          bindings.VOD_EXPORT_PRIVATE,
          artifact,
          build.findings,
          source.fingerprint,
        );
        return {
          canPublish: true,
          findings: build.findings,
          capacity: artifact.capacity,
          candidate,
        };
      } catch (error) {
        if (error instanceof ExportLimitExceededError) {
          throw new VodExportServiceError(
            'EXPORT_LIMIT_EXCEEDED',
            error.message,
            error.httpStatus,
            {
              resource: error.diagnostic.resource,
              actual: error.diagnostic.actual,
              limit: error.diagnostic.limit,
            },
          );
        }
        if (error instanceof VodExportSourceError && error.code === 'EXPORT_LIMIT_EXCEEDED') {
          throw new VodExportServiceError('EXPORT_LIMIT_EXCEEDED', error.message, error.status, error.details);
        }
        throw error;
      }
    }

    throw new VodExportServiceError(
      'SOURCE_CHANGED_DURING_GENERATION',
      'Approved source data changed during candidate generation',
      409,
    );
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseGenerationControl(bindings.VOD_EXPORT_PRIVATE, control);
    } catch (releaseError) {
      if (operationError === undefined) throw releaseError;
      console.error(JSON.stringify({
        event: 'vod_export_generation_control_release_failed',
        generationId: control.slot.generationId,
        error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      }));
    }
  }
}

function mergeCapacity(
  first: readonly CapacityDiagnostic[],
  second: readonly CapacityDiagnostic[],
): CapacityDiagnostic[] {
  const byResource = new Map<CapacityDiagnostic['resource'], CapacityDiagnostic>();
  for (const diagnostic of [...first, ...second]) byResource.set(diagnostic.resource, diagnostic);
  return [...byResource.values()];
}

async function waitBeforeRetry(baseMs: number): Promise<void> {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const jitter = (random[0] ?? 0) % 101;
  await new Promise<void>((resolve) => setTimeout(resolve, baseMs + jitter));
}

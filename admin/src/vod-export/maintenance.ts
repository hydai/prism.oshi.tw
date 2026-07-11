import {
  VOD_EXPORT_MANIFEST_KEY,
  VOD_EXPORT_PUBLIC_ORIGIN,
  VOD_EXPORT_SNAPSHOT_PREFIX,
} from './constants';
import { acquirePublicationControl, releasePublicationControl } from './control';

const SNAPSHOT_KEY_PATTERN = /^vod\/v1\/snapshots\/([0-9a-f]{64})\.json$/;
const UNREFERENCED_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 1_000;
const D1_BATCH_SIZE = 50;
const STORAGE_REVIEW_BYTES = 8 * 1024 * 1024 * 1024;
const RESOLUTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface VodExportMaintenanceBindings {
  DB: D1Database;
  VOD_EXPORT_PUBLIC: R2Bucket;
  VOD_EXPORT_PRIVATE: R2Bucket;
}

export interface VodExportMaintenanceResult {
  retainedManifestCount: number;
  referencedSnapshotCount: number;
  referenceMarkersCleared: number;
  unreferencedMarkersStarted: number;
  auditIdentitiesRemoved: number;
  publicationResolutionsFinalized: number;
  publicationResolutionsDeleted: number;
  snapshotsDeleted: number;
  snapshotDeletionFailures: number;
  publicSnapshotBytes: number;
  storageReviewRequired: boolean;
}

export class VodExportMaintenanceError extends Error {
  readonly code = 'VOD_EXPORT_MAINTENANCE_FAILED' as const;
  readonly status = 503 as const;

  constructor(message: string) {
    super(message);
    this.name = 'VodExportMaintenanceError';
  }
}

interface AuditMaintenanceRow {
  intent_id: string;
  snapshot_url: string;
  candidate_sha256: string;
  identity_retained_until: string;
  curator_identity: string | null;
  candidate_id: string | null;
  snapshot_unreferenced_at: string | null;
}

export async function runVodExportMaintenance(
  bindings: VodExportMaintenanceBindings,
  now = new Date(),
): Promise<VodExportMaintenanceResult> {
  // D-012.9 intentionally defers multi-major cutover. v1 maintenance shares
  // the v1 publication slot so a publisher cannot re-reference an old object
  // between the reference fence and an irreversible anonymize/delete action.
  const owned = await acquirePublicationControl(bindings.VOD_EXPORT_PRIVATE, crypto.randomUUID(), now);
  console.log(JSON.stringify({
    event: 'vod_export_control_acquired',
    operation: 'maintenance',
    ownerId: owned.slot.intentId,
    acquiredAt: owned.slot.acquiredAt,
  }));
  let operationError: unknown;
  try {
    return await runLockedVodExportMaintenance(bindings, now);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releasePublicationControl(
        bindings.VOD_EXPORT_PRIVATE,
        owned.slot.intentId,
        owned.etag,
        owned.slot.previousCheckpoint,
      );
    } catch (releaseError) {
      if (operationError === undefined) throw releaseError;
      console.error(JSON.stringify({
        event: 'vod_export_maintenance_control_release_failed',
        intentId: owned.slot.intentId,
        error: releaseError instanceof Error ? releaseError.message : 'Unknown error',
      }));
    }
  }
}

async function runLockedVodExportMaintenance(
  bindings: VodExportMaintenanceBindings,
  now: Date,
): Promise<VodExportMaintenanceResult> {
  const resolutionMaintenance = await maintainPublicationResolutions(bindings.DB, now);
  const references = await readRetainedManifestReferences(bindings.VOD_EXPORT_PUBLIC);
  const audits = await bindings.DB.withSession('first-primary')
    .prepare(`
      SELECT intent_id, snapshot_url, candidate_sha256, identity_retained_until,
             curator_identity, candidate_id, snapshot_unreferenced_at
      FROM vod_export_publication_audits
      ORDER BY intent_id
    `)
    .all<AuditMaintenanceRow>();

  const markerStatements: D1PreparedStatement[] = [];
  let referenceMarkersCleared = 0;
  let unreferencedMarkersStarted = 0;
  let auditIdentitiesRemoved = 0;
  const nowIso = now.toISOString();
  for (const row of audits.results) {
    const key = snapshotKeyFromUrl(row.snapshot_url);
    const referenced = key !== null && references.snapshotKeys.has(key);
    if (referenced && row.snapshot_unreferenced_at !== null) {
      markerStatements.push(bindings.DB.prepare(`
        UPDATE vod_export_publication_audits
        SET snapshot_unreferenced_at = NULL
        WHERE intent_id = ? AND snapshot_unreferenced_at IS NOT NULL
      `).bind(row.intent_id));
      referenceMarkersCleared += 1;
    } else if (!referenced && row.snapshot_unreferenced_at === null) {
      markerStatements.push(bindings.DB.prepare(`
        UPDATE vod_export_publication_audits
        SET snapshot_unreferenced_at = ?
        WHERE intent_id = ? AND snapshot_unreferenced_at IS NULL
      `).bind(nowIso, row.intent_id));
      unreferencedMarkersStarted += 1;
    }

    if (
      !referenced
      && row.identity_retained_until <= nowIso
      && (row.curator_identity !== null || row.candidate_id !== null)
    ) {
      markerStatements.push(bindings.DB.prepare(`
        UPDATE vod_export_publication_audits
        SET curator_identity = NULL, candidate_id = NULL, identity_removed_at = ?
        WHERE intent_id = ?
          AND identity_retained_until <= ?
          AND (curator_identity IS NOT NULL OR candidate_id IS NOT NULL)
      `).bind(nowIso, row.intent_id, nowIso));
      auditIdentitiesRemoved += 1;
    }
  }
  await runBatches(bindings.DB, markerStatements);

  const markerByObjectKey = new Map<string, string>();
  for (const row of audits.results) {
    const objectKey = snapshotKeyFromUrl(row.snapshot_url);
    if (objectKey === null || references.snapshotKeys.has(objectKey)) continue;
    const marker = row.snapshot_unreferenced_at ?? nowIso;
    const current = markerByObjectKey.get(objectKey);
    if (current === undefined || marker > current) markerByObjectKey.set(objectKey, marker);
  }

  let snapshotsDeleted = 0;
  let snapshotDeletionFailures = 0;
  let publicSnapshotBytes = 0;
  for await (const object of listPublicObjects(bindings.VOD_EXPORT_PUBLIC, VOD_EXPORT_SNAPSHOT_PREFIX)) {
    const match = SNAPSHOT_KEY_PATTERN.exec(object.key);
    if (match === null) continue;
    publicSnapshotBytes += object.size;
    if (references.snapshotKeys.has(object.key)) continue;
    const unreferencedAt = markerByObjectKey.get(object.key)
      ?? object.customMetadata?.unreferencedAt
      ?? object.uploaded.toISOString();
    const timestamp = Date.parse(unreferencedAt);
    if (!Number.isFinite(timestamp) || now.getTime() - timestamp < UNREFERENCED_RETENTION_MS) continue;
    try {
      await bindings.VOD_EXPORT_PUBLIC.delete(object.key);
      snapshotsDeleted += 1;
    } catch (error) {
      snapshotDeletionFailures += 1;
      console.error(JSON.stringify({
        event: 'vod_export_snapshot_retention_delete_failed',
        objectKey: object.key,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }

  const storageReviewRequired = publicSnapshotBytes >= STORAGE_REVIEW_BYTES;
  if (storageReviewRequired) {
    console.warn(JSON.stringify({
      event: 'vod_export_public_snapshot_storage_review_required',
      publicSnapshotBytes,
      thresholdBytes: STORAGE_REVIEW_BYTES,
    }));
  }

  return {
    retainedManifestCount: references.manifestCount,
    referencedSnapshotCount: references.snapshotKeys.size,
    referenceMarkersCleared,
    unreferencedMarkersStarted,
    auditIdentitiesRemoved,
    publicationResolutionsFinalized: resolutionMaintenance.finalized,
    publicationResolutionsDeleted: resolutionMaintenance.deleted,
    snapshotsDeleted,
    snapshotDeletionFailures,
    publicSnapshotBytes,
    storageReviewRequired,
  };
}

async function maintainPublicationResolutions(
  db: D1Database,
  now: Date,
): Promise<{ finalized: number; deleted: number }> {
  // Holding a newly acquired publication slot proves no older resolution
  // intent is still the active R2 owner. Complete any D1 row left pending by a
  // crash after its R2 release, then retain it for a fresh 30-day interval.
  const finalizedAt = now.toISOString();
  const deleteAfter = new Date(now.getTime() + RESOLUTION_RETENTION_MS).toISOString();
  const finalized = await db.prepare(`
    UPDATE vod_export_publication_resolutions
    SET finalized_at = ?, delete_after = ?
    WHERE finalized_at IS NULL AND delete_after IS NULL
  `).bind(finalizedAt, deleteAfter).run();
  const deleted = await db.prepare(`
    DELETE FROM vod_export_publication_resolutions
    WHERE finalized_at IS NOT NULL AND delete_after <= ?
  `).bind(finalizedAt).run();
  return {
    finalized: finalized.meta.changes ?? 0,
    deleted: deleted.meta.changes ?? 0,
  };
}

async function readRetainedManifestReferences(
  bucket: R2Bucket,
): Promise<{ manifestCount: number; snapshotKeys: Set<string> }> {
  const snapshotKeys = new Set<string>();
  let manifestCount = 0;
  for await (const listed of listPublicObjects(bucket, VOD_EXPORT_MANIFEST_KEY)) {
    if (listed.key !== VOD_EXPORT_MANIFEST_KEY) continue;
    const object = await bucket.get(listed.key);
    if (object === null || object.size > 65_536) {
      throw new VodExportMaintenanceError('A retained VOD manifest is missing or too large');
    }
    let value: unknown;
    try {
      value = JSON.parse(textDecoder.decode(await object.arrayBuffer())) as unknown;
    } catch {
      throw new VodExportMaintenanceError('A retained VOD manifest cannot be parsed safely');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new VodExportMaintenanceError('A retained VOD manifest has an invalid shape');
    }
    const snapshotUrl = (value as Record<string, unknown>).snapshotUrl;
    if (typeof snapshotUrl !== 'string') {
      throw new VodExportMaintenanceError('A retained VOD manifest has no snapshot URL');
    }
    const key = snapshotKeyFromUrl(snapshotUrl);
    if (key === null) {
      throw new VodExportMaintenanceError('A retained VOD manifest snapshot URL is unsafe');
    }
    manifestCount += 1;
    snapshotKeys.add(key);
  }
  return { manifestCount, snapshotKeys };
}

async function* listPublicObjects(bucket: R2Bucket, prefix: string): AsyncGenerator<R2Object> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      limit: LIST_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
      include: ['customMetadata'],
    });
    for (const object of page.objects) yield object;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
}

function snapshotKeyFromUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
  ) return null;
  const key = parsed.pathname.replace(/^\//, '');
  return SNAPSHOT_KEY_PATTERN.test(key) ? key : null;
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += D1_BATCH_SIZE) {
    await db.batch(statements.slice(index, index + D1_BATCH_SIZE));
  }
}

// Keep this import-time assertion close to the URL parser so a future origin
// migration must consciously retain old hostnames before changing the constant.
if (new URL(VOD_EXPORT_PUBLIC_ORIGIN).protocol !== 'https:') {
  throw new Error('VOD export public origin must use HTTPS');
}

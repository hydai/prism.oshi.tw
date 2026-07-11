import { compareUtf8Ordinal } from './normalization';
import type {
  FindingEntityType,
  VodExportFinding,
  VodExportPerformance,
  VodExportSnapshot,
  VodExportStreamer,
  VodExportVod,
} from './types';

const ENTITY_ORDER: Readonly<Record<FindingEntityType, number>> = {
  streamer: 0,
  vod: 1,
  song: 2,
  performance: 3,
};

export function comparePerformances(left: VodExportPerformance, right: VodExportPerformance): number {
  return left.startSeconds - right.startSeconds || compareUtf8Ordinal(left.performanceId, right.performanceId);
}
export function compareVods(left: VodExportVod, right: VodExportVod): number {
  return compareUtf8Ordinal(right.date, left.date) || compareUtf8Ordinal(left.videoId, right.videoId);
}

export function compareStreamers(left: VodExportStreamer, right: VodExportStreamer): number {
  return compareUtf8Ordinal(left.slug, right.slug);
}

/** Returns fresh arrays so ordering never mutates adapter-owned or caller-owned state. */
export function orderSnapshot(snapshot: VodExportSnapshot): VodExportSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    streamers: snapshot.streamers
      .map((streamer) => ({
        ...streamer,
        socialLinks: { ...streamer.socialLinks },
        vods: streamer.vods
          .map((vod) => ({
            ...vod,
            performances: [...vod.performances].sort(comparePerformances),
          }))
          .sort(compareVods),
      }))
      .sort(compareStreamers),
  };
}

/**
 * Orders a newly assembled snapshot without cloning its object graph.
 *
 * Only callers that exclusively own every nested array may use this helper.
 * Parsed or otherwise shared snapshots must continue to use `orderSnapshot()`.
 */
export function orderOwnedSnapshotInPlace(snapshot: VodExportSnapshot): VodExportSnapshot {
  for (const streamer of snapshot.streamers) {
    for (const vod of streamer.vods) sortIfNeeded(vod.performances, comparePerformances);
    sortIfNeeded(streamer.vods, compareVods);
  }
  sortIfNeeded(snapshot.streamers, compareStreamers);
  return snapshot;
}

function sortIfNeeded<T>(values: T[], compare: (left: T, right: T) => number): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && compare(previous, current) > 0) {
      values.sort(compare);
      return;
    }
  }
}

export function compareFindings(left: VodExportFinding, right: VodExportFinding): number {
  const severity = severityOrder(left) - severityOrder(right);
  if (severity !== 0) return severity;

  const scope = findingScopeOrder(left) - findingScopeOrder(right);
  if (scope !== 0) return scope;

  const slugPresence = optionalPresenceOrder(left.streamerSlug, right.streamerSlug);
  if (slugPresence !== 0) return slugPresence;
  const slug = compareOptionalText(left.streamerSlug, right.streamerSlug);
  if (slug !== 0) return slug;

  const entity = ENTITY_ORDER[left.entityType] - ENTITY_ORDER[right.entityType];
  if (entity !== 0) return entity;

  const entityIdPresence = optionalPresenceOrder(left.entityId, right.entityId);
  if (entityIdPresence !== 0) return entityIdPresence;
  const entityId = compareOptionalText(left.entityId, right.entityId);
  if (entityId !== 0) return entityId;

  const fieldPresence = optionalPresenceOrder(left.field, right.field);
  if (fieldPresence !== 0) return fieldPresence;
  const field = compareOptionalText(left.field, right.field);
  if (field !== 0) return field;

  const code = compareUtf8Ordinal(left.code, right.code);
  if (code !== 0) return code;

  return compareUtf8Ordinal(fallbackLocator(left), fallbackLocator(right));
}

function severityOrder(finding: VodExportFinding): number {
  return finding.severity === 'error' ? 0 : 1;
}

function findingScopeOrder(finding: VodExportFinding): number {
  // The pure domain core emits only streamer-data findings. This retains the
  // normative ordering if an operation-level caller later merges system items.
  return finding.entityType == null ? 0 : 1;
}

function optionalPresenceOrder(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right !== undefined) return -1;
  if (left !== undefined && right === undefined) return 1;
  return 0;
}

function compareOptionalText(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) return 0;
  return compareUtf8Ordinal(left, right);
}

function fallbackLocator(finding: VodExportFinding): string {
  const details = finding.details;
  if (details?.submissionId !== undefined) return `submission:${details.submissionId}`;
  if (details?.streamId !== undefined) return `stream:${details.streamId}`;
  if (details?.rowId !== undefined) return `row:${details.rowId.toString().padStart(20, '0')}`;
  return '';
}

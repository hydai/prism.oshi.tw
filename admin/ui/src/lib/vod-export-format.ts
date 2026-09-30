import { ApiError } from '../api/client';
import type { VodExportCapacityResource, VodExportFindingApi } from '../api/vodExportTypes';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, ratio) * 100)}%`;
}

export function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Every resource the worker can report, so adding one to the shared
 * `CapacityResource` union fails this build until it has a name a curator reads.
 */
const CAPACITY_LABELS: Readonly<Record<VodExportCapacityResource, string>> = {
  sourceRows: 'Source rows',
  sourceTextBytes: 'Source text',
  streamers: 'Exported streamers',
  vods: 'Exported VODs',
  performances: 'Exported performances',
  snapshotBytes: 'Snapshot bytes',
  findings: 'Findings',
  findingsBytes: 'Findings response',
  d1JsonBindingBytes: 'D1 query payload',
};

/** Diagnostics come off the wire, so an unrecognised resource still renders. */
export function capacityLabel(resource: string): string {
  const labels: Readonly<Record<string, string>> = CAPACITY_LABELS;
  return labels[resource] ?? resource;
}

export function operationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;

  switch (error.code) {
    case 'EXPORT_GENERATION_IN_PROGRESS':
      return 'Another preview is already being generated. Wait for it to finish, then try again.';
    case 'EXPORT_LIMIT_EXCEEDED':
      return 'The export exceeded a confirmed v1 capacity limit. No candidate was created.';
    case 'SOURCE_CHANGED_DURING_GENERATION':
      return 'Approved source data changed during generation. Try again after current edits finish.';
    case 'CANDIDATE_STALE':
      return 'Approved source data changed after this preview. Generate a fresh preview.';
    case 'CANDIDATE_EXPIRED':
      return 'This candidate expired. Generate a fresh preview.';
    case 'PUBLICATION_IN_PROGRESS':
      return 'Another publication is in progress. This candidate was retained.';
    case 'PUBLICATION_CONFLICT':
      return 'The public manifest changed concurrently. This candidate was retained; refresh and try again.';
    default:
      return error.message || fallback;
  }
}

export function findingKey(finding: VodExportFindingApi): string {
  return [
    finding.code,
    finding.streamerSlug ?? '',
    finding.entityType,
    finding.entityId ?? '',
    finding.field ?? '',
    JSON.stringify(finding.details ?? {}),
  ].join('\u0000');
}

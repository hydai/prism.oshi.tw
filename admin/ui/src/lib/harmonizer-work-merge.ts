import { HARMONIZE_MERGE_SOURCE_LIMIT } from '../../../shared/types';
import type { HarmonizeMergeBody, HarmonizeSongEntry } from '../../../shared/types';

export interface HarmonizeWorkMergePlan {
  canonicalWorkId: string | null;
  workIds: string[];
  sourceWorkIds: string[];
  missingSongIds: string[];
  requiresGlobalMerge: boolean;
}

export interface HarmonizeMergeBatch {
  items: HarmonizeSongEntry[];
  deferredSourceCount: number;
}

export function getWorkAwareMergeBatch(
  items: HarmonizeSongEntry[],
  canonicalSongId: string,
): HarmonizeMergeBatch {
  const canonical = items.find((item) => item.id === canonicalSongId);
  if (canonical === undefined) {
    return { items: [], deferredSourceCount: items.length };
  }

  const sources = items.filter((item) => item.id !== canonicalSongId);
  const selectedSources = sources.slice(0, HARMONIZE_MERGE_SOURCE_LIMIT);
  return {
    items: [canonical, ...selectedSources],
    deferredSourceCount: sources.length - selectedSources.length,
  };
}

export function getWorkMergePlan(
  items: HarmonizeSongEntry[],
  canonicalSongId: string,
): HarmonizeWorkMergePlan {
  const canonicalWorkId = items.find((item) => item.id === canonicalSongId)?.workId ?? null;
  const workIds = [...new Set(
    items.flatMap((item) => (item.workId === null ? [] : [item.workId])),
  )];
  const sourceWorkIds = canonicalWorkId === null
    ? []
    : workIds.filter((workId) => workId !== canonicalWorkId);

  return {
    canonicalWorkId,
    workIds,
    sourceWorkIds,
    missingSongIds: items.filter((item) => item.workId === null).map((item) => item.id),
    requiresGlobalMerge: sourceWorkIds.length > 0,
  };
}

/** `revision` is the catalog revision the scan these items came from reported. */
export function buildWorkAwareMergeRequest(
  items: HarmonizeSongEntry[],
  canonicalSongId: string,
  revision: number,
): HarmonizeMergeBody | null {
  const batch = getWorkAwareMergeBatch(items, canonicalSongId);
  const plan = getWorkMergePlan(batch.items, canonicalSongId);
  if (plan.canonicalWorkId === null || plan.missingSongIds.length > 0) return null;

  const sourceSongIds = batch.items.slice(1).map((item) => item.id);
  if (sourceSongIds.length === 0) return null;

  return {
    canonicalSongId,
    sourceSongIds,
    revision,
    ...(plan.requiresGlobalMerge
      ? {
          workMergeConfirmation: {
            canonicalWorkId: plan.canonicalWorkId,
            sourceWorkIds: plan.sourceWorkIds,
          },
        }
      : {}),
  };
}

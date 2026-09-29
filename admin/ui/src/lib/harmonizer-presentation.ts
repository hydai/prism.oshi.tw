import { HARMONIZE_MERGE_SOURCE_LIMIT } from '../../../shared/types';
import type { HarmonizeGroupMatchType, HarmonizeSongEntry } from '../../../shared/types';
import type { Tone } from '../components/ui/pill-core';
import type { HarmonizeMergeBatch, HarmonizeWorkMergePlan } from './harmonizer-work-merge';

/** The legacy Similar artists tab's match-type chip colours; the rebuilt tabs use `matchTypePill`. */
export function matchTypeClasses(matchType: HarmonizeGroupMatchType): string {
  if (matchType === 'work_id') return 'bg-blue-100 text-blue-700';
  if (matchType === 'exact') return 'bg-green-100 text-green-700';
  return 'bg-yellow-100 text-yellow-700';
}

/** How a group's match type reads as a pill: Exact (ok), Fuzzy (warn) or Work ID (info). */
export function matchTypePill(matchType: HarmonizeGroupMatchType): { label: string; tone: Tone } {
  if (matchType === 'exact') return { label: 'Exact', tone: 'ok' };
  if (matchType === 'fuzzy') return { label: 'Fuzzy', tone: 'warn' };
  return { label: 'Work ID', tone: 'info' };
}

/**
 * What merging a song group does, as its button (and the confirm that asks before it) names it: a
 * group past the per-request source limit merges its first batch, and a group on more than one work
 * ID merges the global works too.
 */
export function mergeActionLabel(deferredSourceCount: number, requiresGlobalMerge: boolean): string {
  if (deferredSourceCount > 0) {
    return requiresGlobalMerge
      ? `Merge First ${HARMONIZE_MERGE_SOURCE_LIMIT} + Global Works`
      : `Merge First ${HARMONIZE_MERGE_SOURCE_LIMIT} Local Duplicates`;
  }
  return requiresGlobalMerge ? 'Merge Songs + Global Works' : 'Merge Local Duplicates';
}

/** Everything a curator must weigh before confirming one Harmonizer merge. */
export function mergeConfirmationMessage(
  canonical: HarmonizeSongEntry,
  batch: HarmonizeMergeBatch,
  plan: HarmonizeWorkMergePlan,
  sourceCount: number,
): string {
  const performanceCount = batch.items.reduce((sum, item) => sum + item.performanceCount, 0);
  const batchNotice = batch.deferredSourceCount > 0
    ? `\n\nThis group exceeds the per-request safety limit. This batch will locally merge ${sourceCount} source records; ${batch.deferredSourceCount} will remain as local song records. A global work merge may still repoint their workId. Run Scan again after this batch to continue.`
    : '';
  const workImpact = plan.requiresGlobalMerge
    ? `GLOBAL WORK MERGE\n\nCanonical workId: ${plan.canonicalWorkId}\nWorkId(s) to retire: ${plan.sourceWorkIds.join(', ')}\n\nEvery surviving song across all VTubers linked to the retired workId(s) will be repointed to the canonical work.`
    : `LOCAL SONG MERGE\n\nworkId remains: ${plan.canonicalWorkId}\n\nThe global work identity will not be merged or replaced.`;
  return `${workImpact}\n\nMerge ${sourceCount} song record(s) into "${canonical.title}" by ${canonical.originalArtist}?${batchNotice}\n\nAll ${performanceCount} performances in this batch will be preserved.`;
}

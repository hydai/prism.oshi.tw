import { GLOBAL_WORK_MERGE_SOURCE_LIMIT } from '../../../shared/types';
import type { WorkMatchCandidate } from '../../../shared/types';

export function candidateReviewStateKey(candidate: WorkMatchCandidate): string {
  return `${candidate.candidateKey}:${candidate.fingerprint}`;
}

export function selectMergeSourceWorkIds(
  candidate: WorkMatchCandidate,
  canonicalWorkId: string,
): string[] {
  return candidate.works
    .filter((work) => work.id !== canonicalWorkId)
    .slice(0, GLOBAL_WORK_MERGE_SOURCE_LIMIT)
    .map((work) => work.id);
}

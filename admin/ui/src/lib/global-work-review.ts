import { GLOBAL_WORK_MERGE_SOURCE_LIMIT } from '../../../shared/types';
import type { WorkMatchCandidate, WorkMatchDecision } from '../../../shared/types';
import type { Tone } from '../components/ui/pill-core';

export function candidateReviewStateKey(candidate: WorkMatchCandidate): string {
  return `${candidate.candidateKey}:${candidate.fingerprint}`;
}

/**
 * The pill a candidate's decision wears, in the review queue's list and in its detail: a decision
 * saved on the server (`candidate.decision`) or made in this view (a merge included); with none yet
 * it is pending review.
 */
export function decisionPill(decision: WorkMatchDecision | 'merged' | null): { label: string; tone: Tone } {
  if (decision === 'not_duplicate') return { label: 'Not duplicate', tone: 'neutral' };
  if (decision === 'needs_research') return { label: 'Needs research', tone: 'warn' };
  if (decision === 'merged') return { label: 'Merged', tone: 'ok' };
  return { label: 'Pending review', tone: 'neutral' };
}

/**
 * The rows on screen after a silent re-read of the same filter and page (`fresh`). The order on
 * screen (`current`) is kept, so nothing jumps under the curator:
 * - a row the re-read has is replaced by the fresh row (fresh review version and catalog revision);
 * - a row the curator decided here (a key of `decided`) stays as it was when the re-read lacks it,
 *   which is the usual case: a decision moves it out of the filter it was listed under;
 * - an undecided row the re-read lacks drops out: it changed elsewhere;
 * - rows only the re-read has append, in its order.
 * Only which keys `decided` holds matters, not what it records for them.
 */
export function mergeRefreshedCandidates(
  current: readonly WorkMatchCandidate[],
  fresh: readonly WorkMatchCandidate[],
  decided: Readonly<Record<string, unknown>>,
): WorkMatchCandidate[] {
  const freshByKey = new Map<string, WorkMatchCandidate>(
    fresh.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const merged: WorkMatchCandidate[] = [];
  for (const row of current) {
    const replacement = freshByKey.get(row.candidateKey);
    if (replacement) merged.push(replacement);
    else if (row.candidateKey in decided) merged.push(row);
  }
  const onScreen = new Set(current.map((row) => row.candidateKey));
  for (const row of fresh) {
    if (!onScreen.has(row.candidateKey)) merged.push(row);
  }
  return merged;
}

/**
 * The decisions made in this view (`decided`, by `candidateKey`) that still hold once a silent
 * re-read (`fresh`) lands. A decision holds for the fingerprint its candidate had when it was made,
 * the fingerprint of its row on screen (`current`): a re-read keeps a decided row only under that
 * same fingerprint, so the row on screen always carries it. When the re-read returns the candidate
 * under another fingerprint (a title or an artist edited elsewhere), that is a new candidate under
 * the old key, pending on the server: the decision lapses, and the fresh row that replaces the
 * decided one is live. A decided row the re-read returns under the same fingerprint, or lacks,
 * keeps its decision. With nothing lapsed, `decided` itself comes back.
 */
export function decisionsAfterRefresh<Outcome>(
  current: readonly WorkMatchCandidate[],
  fresh: readonly WorkMatchCandidate[],
  decided: Readonly<Record<string, Outcome>>,
): Readonly<Record<string, Outcome>> {
  const freshFingerprints = new Map<string, string>(fresh.map((row) => [row.candidateKey, row.fingerprint]));
  const lapsed = new Set<string>();
  for (const row of current) {
    const fingerprint = freshFingerprints.get(row.candidateKey);
    if (row.candidateKey in decided && fingerprint !== undefined && fingerprint !== row.fingerprint) {
      lapsed.add(row.candidateKey);
    }
  }
  if (lapsed.size === 0) return decided;
  return Object.fromEntries(Object.entries(decided).filter(([key]) => !lapsed.has(key)));
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

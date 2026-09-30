import type { VodExportCandidate } from '../api/vodExportTypes';

export type CandidateLocalState = 'ready' | 'stale' | 'already_published';

export function safeRepairPath(value: string | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;

  try {
    const base = 'https://prism-admin.invalid';
    const url = new URL(value, base);
    const allowedPrefixes = ['/songs', '/streams', '/stamp', '/nova', '/vod-export/repair'];
    if (
      url.origin !== base ||
      !allowedPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
    ) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Whether `candidate` is too old to publish: the server says it expired, or its expiry is at or
 * before `now` (an unreadable expiry counts as passed). The card's badge, the Publish button and the
 * workflow stepper all ask here, so they always agree.
 */
export function isCandidateExpired(candidate: VodExportCandidate, now: number): boolean {
  const expiresAt = Date.parse(candidate.expiresAt);
  return candidate.state === 'expired' || !Number.isFinite(expiresAt) || expiresAt <= now;
}

/**
 * Whether the candidate already is the public snapshot: the server says so, or a publication or a
 * recovery handed it over while the page watched (`localState`, which outlasts the candidate itself).
 * The card's Publish then only confirms the unchanged snapshot, the dialog records the reviewed
 * state, and the stepper reads "Published" — all three ask here.
 */
export function candidateAlreadyPublished(localState: CandidateLocalState, candidate: VodExportCandidate | null): boolean {
  return localState === 'already_published' || candidate?.state === 'already_published';
}

export function getPublishDisabledReason({
  candidate,
  canPublish,
  hasBlockingErrors,
  localState,
  publishing,
  publicationInProgress,
  now,
}: {
  candidate: VodExportCandidate | null;
  canPublish: boolean;
  hasBlockingErrors: boolean;
  localState: CandidateLocalState;
  publishing: boolean;
  publicationInProgress: boolean;
  now: number;
}): string | null {
  if (publishing || publicationInProgress) return 'Another publication is in progress.';
  if (!candidate) {
    if (hasBlockingErrors) return 'Resolve all blocking errors and generate a fresh preview.';
    return canPublish
      ? 'The server did not create a candidate. Generate a fresh preview.'
      : 'Generate a valid preview before publishing.';
  }
  // The candidate's own staleness or expiry is why the server refuses it: that reason comes first.
  if (localState === 'stale' || candidate.state === 'stale') {
    return 'Source data changed. Generate a fresh preview.';
  }
  if (isCandidateExpired(candidate, now)) {
    return 'This candidate expired. Generate a fresh preview.';
  }
  if (!canPublish) return 'Resolve all blocking errors and generate a fresh preview.';
  return null;
}

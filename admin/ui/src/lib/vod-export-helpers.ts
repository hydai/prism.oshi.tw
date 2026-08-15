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
  if (!canPublish) return 'Resolve all blocking errors and generate a fresh preview.';
  if (localState === 'stale' || candidate.state === 'stale') {
    return 'Source data changed. Generate a fresh preview.';
  }
  const expiresAt = Date.parse(candidate.expiresAt);
  if (candidate.state === 'expired' || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return 'This candidate expired. Generate a fresh preview.';
  }
  return null;
}

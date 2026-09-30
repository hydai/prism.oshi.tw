import type { VodExportCandidate, VodExportFindingApi, VodExportFindingSeverity } from '../api/vodExportTypes';

export type CandidateLocalState = 'ready' | 'stale' | 'already_published';

/** A repair path is relative to the Admin app; this stand-in origin lets `URL` parse it and prove it stays there. */
const REPAIR_PATH_BASE = 'https://prism-admin.invalid';

export function safeRepairPath(value: string | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;

  try {
    const url = new URL(value, REPAIR_PATH_BASE);
    const allowedPrefixes = ['/songs', '/streams', '/stamp', '/nova', '/vod-export/repair'];
    if (
      url.origin !== REPAIR_PATH_BASE ||
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
 * The findings sharing one severity and one code — what a curator fixes in one sitting. `key` is
 * stable across previews (`error:MISSING_END_SECONDS`), `message` is the server's own text of the
 * first finding, and `entityNoun` names what the findings are about ("streamers", "VOD").
 */
export interface FindingGroup {
  key: string;
  severity: VodExportFindingSeverity;
  code: string;
  message: string;
  entityNoun: string;
  items: VodExportFindingApi[];
}

/** Every entity type the worker reports, so a new one fails this build until it has a noun. */
const ENTITY_NOUNS: Readonly<Record<VodExportFindingApi['entityType'], string>> = {
  streamer: 'streamer',
  vod: 'VOD',
  song: 'song',
  performance: 'performance',
};

/**
 * What `items` are about, counted: "1 streamer", "41 streamers". One code can span entity types
 * (INVALID_UNICODE_TEXT is raised for all four), and a group of mixed kinds is just "records".
 */
function entityNoun(items: readonly VodExportFindingApi[]): string {
  const [first] = items;
  const sameKind = first !== undefined && items.every((item) => item.entityType === first.entityType);
  const noun = sameKind ? ENTITY_NOUNS[first.entityType] : 'record';
  return items.length === 1 ? noun : `${noun}s`;
}

const SEVERITY_RANK: Readonly<Record<VodExportFindingSeverity, number>> = { error: 0, warning: 1 };

function compareGroups(a: FindingGroup, b: FindingGroup): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  // Code-unit order, not the locale's: the codes are ASCII and the order must not depend on the browser.
  if (a.code === b.code) return 0;
  return a.code < b.code ? -1 : 1;
}

/**
 * Groups findings by severity and code: errors first, then by code, each group's findings in the
 * order they were given. Never changes `findings`.
 */
export function groupFindings(findings: readonly VodExportFindingApi[]): FindingGroup[] {
  const buckets = new Map<string, { first: VodExportFindingApi; items: VodExportFindingApi[] }>();
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.code}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(finding);
    else buckets.set(key, { first: finding, items: [finding] });
  }

  return [...buckets]
    .map(([key, { first, items }]) => ({
      key,
      severity: first.severity,
      code: first.code,
      message: first.message,
      entityNoun: entityNoun(items),
      items,
    }))
    .sort(compareGroups);
}

/**
 * The Admin pages a group of findings can be fixed in as a whole. The single-record repair pages
 * (`/vod-export/repair/…`) are deliberately absent: a finding there stays a per-item "Open record".
 */
const FIX_LABELS: Readonly<Record<string, string>> = {
  '/nova': 'Fix in Nova',
  '/stamp': 'Fix in Stamp Editor',
  '/streams': 'Fix in Streams',
  '/songs': 'Fix in Songs',
};

/**
 * One destination for a whole group of findings, or none: when every finding has a safe repair path
 * and all of them share one pathname the group can be fixed in (`FIX_LABELS`), the link goes to that
 * pathname with the query parameters every finding carries with the same value — in the first
 * finding's order — so 41 streamers pointing at `/nova?status=approved&search=<slug>` share
 * `/nova?status=approved`. Anything else, including a finding without a safe path, has no group link.
 */
export function groupFixLink(items: readonly VodExportFindingApi[]): { label: string; to: string } | null {
  const destinations: URL[] = [];
  for (const item of items) {
    const path = safeRepairPath(item.repairPath);
    if (path === null) return null;
    destinations.push(new URL(path, REPAIR_PATH_BASE));
  }

  const [first, ...others] = destinations;
  if (first === undefined || others.some((other) => other.pathname !== first.pathname)) return null;
  const label = FIX_LABELS[first.pathname];
  if (label === undefined) return null;

  const shared = [...first.searchParams].filter(([name, value]) =>
    others.every((other) => other.searchParams.getAll(name).includes(value)),
  );
  return { label, to: destinationOf(first.pathname, shared) };
}

/**
 * A destination in the one form the group link is written in: the pathname, then the query pairs
 * re-serialized by `URLSearchParams`, so an encoding difference (`%20` or `+`) never makes two places differ.
 */
function destinationOf(pathname: string, pairs: Iterable<[string, string]>): string {
  const query = new URLSearchParams([...pairs]).toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

/**
 * Where a finding's own repair link goes, written the way `groupFixLink` writes its `to`: the group's
 * "Fix in …" is the same place when the two are equal, and the finding's link only repeats it. Null for a
 * path that is not safe. A fragment stays, so a path with one is never taken for the group link, which has none.
 */
export function repairDestination(repairPath: string | undefined): string | null {
  const path = safeRepairPath(repairPath);
  if (path === null) return null;
  const url = new URL(path, REPAIR_PATH_BASE);
  return `${destinationOf(url.pathname, url.searchParams)}${url.hash}`;
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

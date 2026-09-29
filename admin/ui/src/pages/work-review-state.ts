import type {
  WorkMatchCandidate,
  WorkMatchCandidatesResponse,
  WorkMatchFilter,
  WorkMatchStats,
} from '../../../shared/types';
import { nextQueueKey } from '../components/ui/queue';
import { decisionsAfterRefresh, mergeRefreshedCandidates } from '../lib/global-work-review';

/** How a candidate was settled in this view: a saved review decision, or a global merge. */
export type WorkReviewOutcome = 'not_duplicate' | 'needs_research' | 'merged';

export interface WorkReviewState {
  candidates: WorkMatchCandidate[];
  stats: WorkMatchStats;
  filter: WorkMatchFilter;
  page: number;
  total: number;
  totalPages: number;
  loading: boolean;
  scanError: string | null;
  refreshVersion: number;
  confirmingCandidateKey: string | null;
  actionCandidateKey: string | null;
  /**
   * The `candidateKey` of the row the detail shows. `null` while the list is empty and once every
   * row is decided. It changes in the same transition as the rows, so a queue that keeps the
   * selected row in view sees the row and its key arrive together.
   */
  selectedKey: string | null;
  /**
   * The rows settled in this view, by `candidateKey`. They stay in `candidates`, read-only, until
   * a scan replaces the list: a reload, a filter change or a page change. A decision holds for the
   * fingerprint it was made under, which its row on screen keeps: a silent re-read that returns the
   * candidate under another fingerprint drops it, and the fresh row is live again
   * (`decisionsAfterRefresh`).
   */
  decided: Readonly<Record<string, WorkReviewOutcome>>;
  /**
   * A silent re-read of the same filter and page is in flight (started by a decision, ended by
   * `pageRefreshed` or `pageRefreshFailed`). The list stays on screen while it runs.
   */
  rereading: boolean;
  /** Why the last silent re-read failed; cleared by the scan that succeeds after it. */
  rereadError: string | null;
}

export const EMPTY_WORK_REVIEW_STATS: WorkMatchStats = {
  candidateCount: 0,
  pendingCount: 0,
  notDuplicateCount: 0,
  needsResearchCount: 0,
  affectedWorks: 0,
};

export const initialWorkReviewState: WorkReviewState = {
  candidates: [],
  stats: EMPTY_WORK_REVIEW_STATS,
  filter: 'pending',
  page: 1,
  total: 0,
  totalPages: 0,
  loading: true,
  scanError: null,
  refreshVersion: 0,
  confirmingCandidateKey: null,
  actionCandidateKey: null,
  selectedKey: null,
  decided: {},
  rereading: false,
  rereadError: null,
};

/**
 * Whether the queue is busy: a decision or merge is saving, a silent re-read is running, or the
 * last re-read failed (until a reload succeeds the rows on screen may carry stale review versions
 * and catalog revisions). The page gates every decision, merge, filter and page control on it, so a
 * second merge never sends a revision the re-read has not refreshed.
 */
export function isWorkReviewQueueBusy(state: WorkReviewState): boolean {
  return state.actionCandidateKey !== null || state.rereading || state.rereadError !== null;
}

/**
 * The list count: the slice of the filter this page covers by the server's own numbers, "{start}–{end}
 * of {total}". It counts neither the rows on screen nor how they came: a decided row kept on screen
 * has usually left the filter (the re-read's `total` no longer counts it), and a row a re-read
 * appended fills a place in the slice. So the rows on screen may outnumber the slice, while the count
 * stays true to the server: the start never passes the end, the end never passes the total. Once the
 * page lies past the filter's end (every row of the last page decided away, or an empty filter),
 * the slice is empty: "0 of {total}".
 */
export function candidateRangeLabel(page: number, pageSize: number, total: number): string {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return start > end ? `0 of ${total}` : `${start}–${end} of ${total}`;
}

export type WorkReviewAction =
  | { type: 'scanStarted' }
  | { type: 'scanPageCorrected'; page: number }
  | { type: 'scanSucceeded'; response: WorkMatchCandidatesResponse }
  | { type: 'scanFailed'; error: string }
  | { type: 'scanFinished' }
  | { type: 'refreshRequested' }
  | { type: 'actionStarted'; candidateKey: string }
  | { type: 'actionFinished' }
  | { type: 'filterChanged'; filter: WorkMatchFilter }
  | { type: 'previousPageRequested' }
  | { type: 'nextPageRequested' }
  | { type: 'mergeConfirmationStarted'; candidateKey: string }
  | { type: 'mergeConfirmationCancelled' }
  | { type: 'candidateSelected'; key: string }
  | { type: 'decisionRecorded'; candidateKey: string; outcome: WorkReviewOutcome }
  | {
      type: 'pageRefreshed';
      candidates: WorkMatchCandidate[];
      stats: WorkMatchStats;
      total: number;
      totalPages: number;
    }
  | { type: 'pageRefreshFailed'; error: string };

const candidateKeyOf = (candidate: WorkMatchCandidate): string => candidate.candidateKey;

/**
 * The selection once a silent re-read has turned `state.candidates` into `merged`, with `decided`
 * the decisions that still hold. A selected row that is still there stays selected. Otherwise (a row
 * that dropped out, or nothing selected) the selection is replaced: first from the old position,
 * walking the order the rows had and skipping what is decided or gone; failing that, the first
 * undecided row of the merged list, which is a row the re-read appended (an over-limit merge's
 * remainder comes back under a new key). `null` when no merged row is undecided. A row whose
 * decision lapsed is undecided here.
 */
function selectionAfterRefresh(
  state: WorkReviewState,
  merged: readonly WorkMatchCandidate[],
  decided: WorkReviewState['decided'],
): string | null {
  const remaining = new Set(merged.map(candidateKeyOf));
  if (state.selectedKey !== null && remaining.has(state.selectedKey)) return state.selectedKey;
  return (
    nextQueueKey(
      state.candidates.map(candidateKeyOf),
      state.selectedKey,
      (key) => key in decided || !remaining.has(key),
    )
    ?? merged.find((row) => !(row.candidateKey in decided))?.candidateKey
    ?? null
  );
}

export function workReviewReducer(
  state: WorkReviewState,
  action: WorkReviewAction,
): WorkReviewState {
  switch (action.type) {
    case 'scanStarted':
      // The list goes, so its selection goes, and a re-read of it is moot.
      return {
        ...state,
        candidates: [],
        stats: EMPTY_WORK_REVIEW_STATS,
        total: 0,
        totalPages: 0,
        loading: true,
        scanError: null,
        selectedKey: null,
        rereading: false,
      };
    case 'scanPageCorrected':
      return { ...state, page: action.page };
    case 'scanSucceeded':
      return {
        ...state,
        candidates: action.response.data,
        stats: action.response.stats,
        total: action.response.total,
        totalPages: action.response.totalPages,
        selectedKey: action.response.data[0]?.candidateKey ?? null,
        decided: {},
        rereadError: null,
      };
    case 'scanFailed':
      return { ...state, scanError: action.error };
    case 'scanFinished':
      return { ...state, loading: false };
    case 'refreshRequested':
      return {
        ...state,
        confirmingCandidateKey: null,
        refreshVersion: state.refreshVersion + 1,
      };
    case 'actionStarted':
      return { ...state, actionCandidateKey: action.candidateKey };
    case 'actionFinished':
      return { ...state, actionCandidateKey: null };
    case 'filterChanged':
      return {
        ...state,
        filter: action.filter,
        page: 1,
        confirmingCandidateKey: null,
        // The active filter on page 1 changes nothing the page's scan is keyed on, so no scan
        // follows: the rows on screen stay, and so does which of them are decided.
        decided: action.filter === state.filter && state.page === 1 ? state.decided : {},
      };
    case 'previousPageRequested':
      return {
        ...state,
        page: Math.max(1, state.page - 1),
        confirmingCandidateKey: null,
        // At page 1 the page does not change, so no scan follows and the decided rows stay.
        decided: state.page > 1 ? {} : state.decided,
      };
    case 'nextPageRequested':
      return {
        ...state,
        page: Math.min(state.totalPages, state.page + 1),
        confirmingCandidateKey: null,
        // The same at the last page.
        decided: state.page < state.totalPages ? {} : state.decided,
      };
    case 'mergeConfirmationStarted':
      return { ...state, confirmingCandidateKey: action.candidateKey };
    case 'mergeConfirmationCancelled':
      return { ...state, confirmingCandidateKey: null };
    case 'candidateSelected':
      return { ...state, selectedKey: action.key };
    case 'decisionRecorded': {
      // The decided row stays in the list, faded. The selection follows the decision to the next
      // undecided row unless the curator has already moved on to another undecided one while the
      // decision was saving. A decision ends any pending merge confirmation (the reload that used
      // to clear it is gone). Starts the re-read: until it lands the queue is busy, so a second
      // merge never sends a revision the re-read has not refreshed.
      const decided = { ...state.decided, [action.candidateKey]: action.outcome };
      const isDecided = (key: string) => key in decided;
      const selectionIsLive = state.selectedKey !== null && !isDecided(state.selectedKey);
      return {
        ...state,
        decided,
        selectedKey: selectionIsLive
          ? state.selectedKey
          : nextQueueKey(state.candidates.map(candidateKeyOf), action.candidateKey, isDecided),
        confirmingCandidateKey: null,
        rereading: true,
      };
    }
    case 'pageRefreshed': {
      // Rows, decisions and selection change in one transition. A decision whose candidate came back
      // under another fingerprint lapses first, so its fresh row counts as live for the selection.
      const decided = decisionsAfterRefresh(state.candidates, action.candidates, state.decided);
      const candidates = mergeRefreshedCandidates(state.candidates, action.candidates, decided);
      return {
        ...state,
        candidates,
        stats: action.stats,
        total: action.total,
        totalPages: action.totalPages,
        decided,
        selectedKey: selectionAfterRefresh(state, candidates, decided),
        rereading: false,
      };
    }
    case 'pageRefreshFailed':
      return { ...state, rereading: false, rereadError: action.error };
  }
}

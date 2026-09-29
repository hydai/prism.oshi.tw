import { useEffect, useReducer, useRef, useState } from 'react';
import type {
  WorkMatchCandidate,
  WorkMatchDecision,
  WorkMatchFilter,
  WorkMatchMergeResponse,
} from '../../../shared/types';
import { api } from '../api/client';
import { useToast } from '../components/ui/toast';
import { createRequestSequencer, errorMessage, loadCurrent } from '../lib/apiResource';
import { candidateReviewStateKey } from '../lib/global-work-review';
import {
  candidateRangeLabel,
  initialWorkReviewState,
  isWorkReviewQueueBusy,
  workReviewReducer,
  type WorkReviewOutcome,
} from './work-review-state';

/** Candidates per page: the compact queue list holds 50 rows easily. */
const PAGE_SIZE = 50;

const DECISION_MESSAGES: Record<WorkMatchDecision, string> = {
  not_duplicate: 'Saved as not duplicate.',
  needs_research: 'Saved for source research.',
};

type Drafts = Readonly<Record<string, string>>;

/** Where a decision was made, so the re-read after it reads that filter and page. */
interface PagePosition {
  filter: WorkMatchFilter;
  page: number;
}

/**
 * Seeds the canonical choice of every row that holds none yet with its suggested work. A choice the
 * curator made stays, unless it is no longer one of the row's works.
 */
function seedCanonicalChoices(rows: readonly WorkMatchCandidate[]): (current: Drafts) => Drafts {
  return (current) => {
    let next: Record<string, string> | null = null;
    for (const row of rows) {
      const chosen = current[row.candidateKey];
      if (chosen !== undefined && row.works.some((work) => work.id === chosen)) continue;
      if (next === null) next = { ...current };
      next[row.candidateKey] = row.suggestedCanonicalWorkId;
    }
    return next ?? current;
  };
}

/** Seeds the saved review note of every row whose note it holds none of yet; a draft stays as typed. */
function seedNotes(rows: readonly WorkMatchCandidate[]): (current: Drafts) => Drafts {
  return (current) => {
    let next: Record<string, string> | null = null;
    for (const row of rows) {
      const key = candidateReviewStateKey(row);
      if (current[key] !== undefined) continue;
      if (next === null) next = { ...current };
      next[key] = row.reviewNote;
    }
    return next ?? current;
  };
}

/**
 * The Work Review page's data and flow: the queue's state, the scan of the current filter and page,
 * the curator's drafts (canonical choice and review note per row), and the decisions and merges.
 *
 * A decision or a merge keeps its row in the list, faded and read-only, and moves the selection to
 * the next undecided row; the page then silently re-reads the same filter and page, so the rows still
 * on screen carry fresh review versions and catalog revisions. Until that re-read lands the queue is
 * busy (`busy`): no second decision or merge can go out with a revision the re-read is about to
 * replace. A failed decision or merge is toasted and rescans the page.
 */
export function useWorkReviewPage() {
  const [state, dispatch] = useReducer(workReviewReducer, initialWorkReviewState);
  const { filter, page, refreshVersion } = state;
  const [canonicalByCandidate, setCanonicalByCandidate] = useState<Drafts>({});
  const [notes, setNotes] = useState<Drafts>({});
  // Every read of the list takes a turn here, the scan and the silent re-read alike, so an older
  // answer never lands after a newer request: a re-read that returns after a filter change, a page
  // change or a reload is dropped.
  const [sequencer] = useState(createRequestSequencer);
  const actionInFlightRef = useRef(false);
  const toast = useToast();

  useEffect(() => {
    dispatch({ type: 'scanStarted' });
    void loadCurrent(
      sequencer,
      () => api.listWorkMatches({ filter, page, pageSize: PAGE_SIZE }),
      (result) => {
        if (!result.ok) {
          dispatch({ type: 'scanFailed', error: result.error });
          dispatch({ type: 'scanFinished' });
          return;
        }
        const response = result.data;
        const validPage = response.totalPages === 0 ? 1 : Math.min(page, response.totalPages);
        if (validPage !== page) {
          // The page moved; the scan of the corrected page follows.
          dispatch({ type: 'scanPageCorrected', page: validPage });
          return;
        }
        dispatch({ type: 'scanSucceeded', response });
        dispatch({ type: 'scanFinished' });
        setCanonicalByCandidate(seedCanonicalChoices(response.data));
        setNotes(seedNotes(response.data));
      },
    );
  }, [filter, page, refreshVersion, sequencer]);

  const busy = isWorkReviewQueueBusy(state);

  const reload = () => dispatch({ type: 'refreshRequested' });

  /** The silent re-read after a decision: the same filter and page, merged into the rows on screen. */
  const rereadPage = ({ filter: filterAt, page: pageAt }: PagePosition) => {
    void loadCurrent(
      sequencer,
      () => api.listWorkMatches({ filter: filterAt, page: pageAt, pageSize: PAGE_SIZE }),
      (result) => {
        if (!result.ok) {
          dispatch({ type: 'pageRefreshFailed', error: result.error });
          return;
        }
        dispatch({
          type: 'pageRefreshed',
          candidates: result.data.data,
          stats: result.data.stats,
          total: result.data.total,
          totalPages: result.data.totalPages,
        });
        setCanonicalByCandidate(seedCanonicalChoices(result.data.data));
        setNotes(seedNotes(result.data.data));
      },
    );
  };

  const beginAction = (candidateKey: string): boolean => {
    if (busy || actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    dispatch({ type: 'actionStarted', candidateKey });
    return true;
  };

  /**
   * A decision or merge the server took. The outcome is recorded before the action ends, in the same
   * render, so the queue goes from saving straight to re-reading and is never idle in between.
   */
  const recordOutcome = (candidateKey: string, outcome: WorkReviewOutcome, message: string, at: PagePosition) => {
    dispatch({ type: 'decisionRecorded', candidateKey, outcome });
    actionInFlightRef.current = false;
    dispatch({ type: 'actionFinished' });
    toast.success(message);
    rereadPage(at);
  };

  /** A decision or merge that failed: the toast says why, and a full scan fetches fresh versions. */
  const reportFailure = (caught: unknown, fallback: string) => {
    actionInFlightRef.current = false;
    dispatch({ type: 'actionFinished' });
    toast.error(errorMessage(caught, fallback));
    reload();
  };

  const saveDecision = async (candidate: WorkMatchCandidate, decision: WorkMatchDecision) => {
    if (!beginAction(candidate.candidateKey)) return;
    const at: PagePosition = { filter, page };
    try {
      await api.reviewWorkMatch({
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        workIds: candidate.works.map((work) => work.id),
        decision,
        expectedReviewVersion: candidate.reviewVersion,
        note: notes[candidateReviewStateKey(candidate)] ?? '',
      });
    } catch (caught: unknown) {
      reportFailure(caught, 'Failed to save review decision');
      return;
    }
    recordOutcome(candidate.candidateKey, decision, DECISION_MESSAGES[decision], at);
  };

  const confirmMerge = async (
    candidate: WorkMatchCandidate,
    canonicalWorkId: string,
    sourceWorkIds: string[],
  ) => {
    if (!beginAction(candidate.candidateKey)) return;
    const at: PagePosition = { filter, page };
    let result: WorkMatchMergeResponse;
    try {
      result = await api.mergeWorkMatch({
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        catalogRevision: candidate.catalogRevision,
        expectedReviewVersion: candidate.reviewVersion,
        canonicalWorkId,
        sourceWorkIds,
        note: notes[candidateReviewStateKey(candidate)] ?? '',
      });
    } catch (caught: unknown) {
      reportFailure(caught, 'Failed to merge global works');
      return;
    }
    recordOutcome(
      candidate.candidateKey,
      'merged',
      `Merged ${result.mergedWorks} work ID(s); preserved ${result.preservedSongs} songs and ${result.preservedPerformances} performances.`,
      at,
    );
  };

  return {
    state,
    /** Every decision, merge, filter and page control waits while this is set. */
    busy,
    /** A reload waits only for what is running; after a failed re-read it is the way out. */
    reloadBlocked: state.actionCandidateKey !== null || state.rereading,
    /** The list count, "{start}–{end} of {total}"; none while the page scans. */
    rangeLabel: state.loading ? undefined : candidateRangeLabel(state.page, PAGE_SIZE, state.total),
    canonicalOf: (candidate: WorkMatchCandidate): string =>
      canonicalByCandidate[candidate.candidateKey] ?? candidate.suggestedCanonicalWorkId,
    noteOf: (candidate: WorkMatchCandidate): string => notes[candidateReviewStateKey(candidate)] ?? '',
    chooseCanonical: (candidate: WorkMatchCandidate, workId: string) =>
      setCanonicalByCandidate((current) => ({ ...current, [candidate.candidateKey]: workId })),
    editNote: (candidate: WorkMatchCandidate, note: string) =>
      setNotes((current) => ({ ...current, [candidateReviewStateKey(candidate)]: note })),
    select: (key: string) => dispatch({ type: 'candidateSelected', key }),
    changeFilter: (value: WorkMatchFilter) => dispatch({ type: 'filterChanged', filter: value }),
    previousPage: () => dispatch({ type: 'previousPageRequested' }),
    nextPage: () => dispatch({ type: 'nextPageRequested' }),
    reviewMergeImpact: (candidate: WorkMatchCandidate) =>
      dispatch({ type: 'mergeConfirmationStarted', candidateKey: candidate.candidateKey }),
    cancelMerge: () => dispatch({ type: 'mergeConfirmationCancelled' }),
    reload,
    saveDecision,
    confirmMerge,
  };
}

/** What the page's sections read from `useWorkReviewPage`. */
export type WorkReviewPage = ReturnType<typeof useWorkReviewPage>;

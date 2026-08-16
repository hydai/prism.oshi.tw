import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  WorkMatchCandidate,
  WorkMatchDecision,
  WorkMatchFilter,
} from '../../../shared/types';
import { api } from '../api/client';
import WorkMatchCandidateCard from '../components/WorkMatchCandidateCard';
import { candidateReviewStateKey } from '../lib/global-work-review';
import { initialWorkReviewState, workReviewReducer } from './work-review-state';

export { MergeImpact } from '../components/WorkMatchCandidateCard';

const PAGE_SIZE = 20;
const FILTERS: Array<{ value: WorkMatchFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'needs_research', label: 'Needs research' },
  { value: 'not_duplicate', label: 'Not duplicate' },
  { value: 'all', label: 'All' },
];

export default function GlobalWorkReview() {
  const [{
    candidates,
    stats,
    filter,
    page,
    total,
    totalPages,
    loading,
    scanError,
    actionError,
    message,
    refreshVersion,
    confirmingCandidateKey,
    actionCandidateKey,
  }, dispatch] = useReducer(workReviewReducer, initialWorkReviewState);
  const [canonicalByCandidate, setCanonicalByCandidate] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    dispatch({ type: 'scanStarted' });
    api.listWorkMatches({ filter, page, pageSize: PAGE_SIZE })
      .then((response) => {
        if (!active) return;
        const validPage = response.totalPages === 0
          ? 1
          : Math.min(page, response.totalPages);
        if (validPage !== page) {
          dispatch({ type: 'scanPageCorrected', page: validPage });
          return;
        }
        dispatch({ type: 'scanSucceeded', response });
        setCanonicalByCandidate((current) => {
          const next = { ...current };
          for (const candidate of response.data) {
            const selected = next[candidate.candidateKey];
            if (!selected || !candidate.works.some((work) => work.id === selected)) {
              next[candidate.candidateKey] = candidate.suggestedCanonicalWorkId;
            }
          }
          return next;
        });
        setNotes((current) => {
          const next = { ...current };
          for (const candidate of response.data) {
            const stateKey = candidateReviewStateKey(candidate);
            if (next[stateKey] === undefined) {
              next[stateKey] = candidate.reviewNote;
            }
          }
          return next;
        });
      })
      .catch((caught: unknown) => {
        if (active) {
          dispatch({
            type: 'scanFailed',
            error: caught instanceof Error ? caught.message : 'Failed to scan global works',
          });
        }
      })
      .finally(() => {
        if (active) dispatch({ type: 'scanFinished' });
      });
    return () => {
      active = false;
    };
  }, [filter, page, refreshVersion]);

  const confirmingCandidate = useMemo(
    () => candidates.find((candidate) => candidate.candidateKey === confirmingCandidateKey) ?? null,
    [candidates, confirmingCandidateKey],
  );

  const refresh = () => {
    dispatch({ type: 'refreshRequested' });
  };

  const beginAction = (candidateKey: string): boolean => {
    if (actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    dispatch({ type: 'actionStarted', candidateKey });
    return true;
  };

  const finishAction = () => {
    actionInFlightRef.current = false;
    dispatch({ type: 'actionFinished' });
  };

  const saveDecision = async (candidate: WorkMatchCandidate, decision: WorkMatchDecision) => {
    if (!beginAction(candidate.candidateKey)) return;
    try {
      await api.reviewWorkMatch({
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        workIds: candidate.works.map((work) => work.id),
        decision,
        expectedReviewVersion: candidate.reviewVersion,
        note: notes[candidateReviewStateKey(candidate)] ?? '',
      });
      dispatch({
        type: 'actionSucceeded',
        message: decision === 'not_duplicate'
          ? 'Saved as not duplicate.'
          : 'Saved for source research.',
      });
      refresh();
    } catch (caught: unknown) {
      dispatch({
        type: 'actionFailed',
        error: caught instanceof Error ? caught.message : 'Failed to save review decision',
      });
      refresh();
    } finally {
      finishAction();
    }
  };

  const confirmMerge = async (
    candidate: WorkMatchCandidate,
    canonicalWorkId: string,
    sourceWorkIds: string[],
  ) => {
    if (!beginAction(candidate.candidateKey)) return;
    try {
      const result = await api.mergeWorkMatch({
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        catalogRevision: candidate.catalogRevision,
        expectedReviewVersion: candidate.reviewVersion,
        canonicalWorkId,
        sourceWorkIds,
        note: notes[candidateReviewStateKey(candidate)] ?? '',
      });
      dispatch({
        type: 'actionSucceeded',
        message: `Merged ${result.mergedWorks} work ID(s); preserved ${result.preservedSongs} songs and ${result.preservedPerformances} performances.`,
      });
      refresh();
    } catch (caught: unknown) {
      dispatch({
        type: 'actionFailed',
        error: caught instanceof Error ? caught.message : 'Failed to merge global works',
      });
      refresh();
    } finally {
      finishAction();
    }
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);
  const queueBusy = actionCandidateKey !== null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Global Work Review</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Tier A finds formatting-only title and original-artist differences. Every result requires
            curator confirmation; this scanner never merges automatically.
          </p>
        </div>
        <a
          href="/works"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          View global library
        </a>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Candidates', stats.candidateCount],
          ['Pending', stats.pendingCount],
          ['Needs research', stats.needsResearchCount],
          ['Not duplicate', stats.notDuplicateCount],
          ['Affected work IDs', stats.affectedWorks],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{Number(value).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Review filter">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={queueBusy}
            onClick={() => {
              dispatch({ type: 'filterChanged', filter: option.value });
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              filter === option.value
                ? 'bg-slate-800 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {message && (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {(actionError ?? scanError) && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError ?? scanError}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-slate-500">Scanning global works...</p>
      ) : candidates.length === 0 ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">
          No candidates in this review state.
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {candidates.map((candidate) => {
            const selectedCanonical = canonicalByCandidate[candidate.candidateKey]
              ?? candidate.suggestedCanonicalWorkId;
            const noteStateKey = candidateReviewStateKey(candidate);
            return (
              <WorkMatchCandidateCard
                key={candidate.candidateKey}
                candidate={candidate}
                selectedCanonicalWorkId={selectedCanonical}
                note={notes[noteStateKey] ?? ''}
                queueBusy={queueBusy}
                acting={actionCandidateKey === candidate.candidateKey}
                isConfirming={confirmingCandidate?.candidateKey === candidate.candidateKey}
                onCanonicalChange={(workId) => setCanonicalByCandidate((current) => ({
                  ...current,
                  [candidate.candidateKey]: workId,
                }))}
                onNoteChange={(note) => setNotes((current) => ({
                  ...current,
                  [noteStateKey]: note,
                }))}
                onReviewMergeImpact={() => dispatch({
                  type: 'mergeConfirmationStarted',
                  candidateKey: candidate.candidateKey,
                })}
                onCancelMerge={() => dispatch({ type: 'mergeConfirmationCancelled' })}
                onConfirmMerge={(canonicalWorkId, sourceWorkIds) => void confirmMerge(
                  candidate,
                  canonicalWorkId,
                  sourceWorkIds,
                )}
                onSaveDecision={(decision) => void saveDecision(candidate, decision)}
              />
            );
          })}
        </div>
      )}

      {totalPages > 0 && (
        <div className="mt-5 flex items-center justify-between text-sm text-slate-600">
          <span>Showing {startItem}–{endItem} of {total}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'previousPageRequested' });
              }}
              disabled={queueBusy || page <= 1}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'nextPageRequested' });
              }}
              disabled={queueBusy || page >= totalPages}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

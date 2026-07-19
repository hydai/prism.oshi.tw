import { useEffect, useMemo, useState } from 'react';
import { GLOBAL_WORK_MERGE_SOURCE_LIMIT } from '../../../shared/types';
import type {
  WorkMatchCandidate,
  WorkMatchDecision,
  WorkMatchFilter,
  WorkMatchReason,
  WorkMatchStats,
} from '../../../shared/types';
import { api } from '../api/client';

const PAGE_SIZE = 20;
const EMPTY_STATS: WorkMatchStats = {
  candidateCount: 0,
  pendingCount: 0,
  notDuplicateCount: 0,
  needsResearchCount: 0,
  affectedWorks: 0,
};

const REASON_LABELS: Record<WorkMatchReason, string> = {
  case_width_whitespace: 'Case / width / whitespace',
  punctuation_spacing: 'Punctuation / spacing',
  diacritic_variant: 'Latin diacritic variant',
};

const FILTERS: Array<{ value: WorkMatchFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'needs_research', label: 'Needs research' },
  { value: 'not_duplicate', label: 'Not duplicate' },
  { value: 'all', label: 'All' },
];

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

export function MergeImpact({
  candidate,
  canonicalWorkId,
  sourceWorkIds,
}: {
  candidate: WorkMatchCandidate;
  canonicalWorkId: string;
  sourceWorkIds: string[];
}) {
  const selectedWorkIds = new Set([canonicalWorkId, ...sourceWorkIds]);
  const selectedWorks = candidate.works.filter((work) => selectedWorkIds.has(work.id));
  const selectedStreamers = new Set(selectedWorks.flatMap((work) => work.streamerIds));
  const selectedSongs = selectedWorks.reduce((sum, work) => sum + work.songCount, 0);
  const selectedPerformances = selectedWorks.reduce(
    (sum, work) => sum + work.performanceCount,
    0,
  );
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Site-wide identity change</p>
      <p className="mt-1">
        This retires {sourceWorkIds.length} work ID(s) while keeping{' '}
        {selectedSongs} local song record(s) across {selectedStreamers.size} VTuber(s).
        Only source song-to-work links are repointed.
      </p>
      <p className="mt-1 font-medium">
        All {selectedPerformances} performances and their performance IDs are preserved.
        No song or performance row is deleted.
      </p>
    </div>
  );
}

function decisionLabel(decision: WorkMatchDecision | null): string {
  if (decision === 'not_duplicate') return 'Not duplicate';
  if (decision === 'needs_research') return 'Needs research';
  return 'Pending review';
}

export default function GlobalWorkReview() {
  const [candidates, setCandidates] = useState<WorkMatchCandidate[]>([]);
  const [stats, setStats] = useState<WorkMatchStats>(EMPTY_STATS);
  const [filter, setFilter] = useState<WorkMatchFilter>('pending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [canonicalByCandidate, setCanonicalByCandidate] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirmingCandidateKey, setConfirmingCandidateKey] = useState<string | null>(null);
  const [actionCandidateKey, setActionCandidateKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setScanError(null);
    setCandidates([]);
    setStats(EMPTY_STATS);
    setTotal(0);
    setTotalPages(0);
    api.listWorkMatches({ filter, page, pageSize: PAGE_SIZE })
      .then((response) => {
        if (!active) return;
        const validPage = response.totalPages === 0
          ? 1
          : Math.min(page, response.totalPages);
        if (validPage !== page) {
          setPage(validPage);
          return;
        }
        setCandidates(response.data);
        setStats(response.stats);
        setTotal(response.total);
        setTotalPages(response.totalPages);
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
          setScanError(caught instanceof Error ? caught.message : 'Failed to scan global works');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
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
    setConfirmingCandidateKey(null);
    setRefreshVersion((current) => current + 1);
  };

  const saveDecision = async (candidate: WorkMatchCandidate, decision: WorkMatchDecision) => {
    setActionCandidateKey(candidate.candidateKey);
    setActionError(null);
    setMessage(null);
    try {
      await api.reviewWorkMatch({
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        workIds: candidate.works.map((work) => work.id),
        decision,
        note: notes[candidateReviewStateKey(candidate)] ?? '',
      });
      setMessage(decision === 'not_duplicate' ? 'Saved as not duplicate.' : 'Saved for source research.');
      refresh();
    } catch (caught: unknown) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to save review decision');
      refresh();
    } finally {
      setActionCandidateKey(null);
    }
  };

  const confirmMerge = async (
    candidate: WorkMatchCandidate,
    canonicalWorkId: string,
    sourceWorkIds: string[],
  ) => {
    setActionCandidateKey(candidate.candidateKey);
    setActionError(null);
    setMessage(null);
    try {
      const result = await api.mergeWorkMatch({
        candidateKey: candidate.candidateKey,
        fingerprint: candidate.fingerprint,
        catalogRevision: candidate.catalogRevision,
        canonicalWorkId,
        sourceWorkIds,
      });
      setMessage(
        `Merged ${result.mergedWorks} work ID(s); preserved ${result.preservedSongs} songs and ${result.preservedPerformances} performances.`,
      );
      refresh();
    } catch (caught: unknown) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to merge global works');
      refresh();
    } finally {
      setActionCandidateKey(null);
    }
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

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
            onClick={() => {
              setActionError(null);
              setMessage(null);
              setFilter(option.value);
              setPage(1);
              setConfirmingCandidateKey(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
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
            const acting = actionCandidateKey === candidate.candidateKey;
            const isConfirming = confirmingCandidate?.candidateKey === candidate.candidateKey;
            const sourceWorkIds = selectMergeSourceWorkIds(candidate, selectedCanonical);
            const deferredSourceCount = candidate.works.length - 1 - sourceWorkIds.length;
            const noteStateKey = candidateReviewStateKey(candidate);
            return (
              <section
                key={candidate.candidateKey}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        High confidence
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {decisionLabel(candidate.decision)}
                      </span>
                      {candidate.reasons.map((reason) => (
                        <span key={reason} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {REASON_LABELS[reason]}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {candidate.works.length} work IDs · {candidate.songCount} local songs ·{' '}
                      {candidate.performanceCount} performances · {candidate.streamerCount} VTubers
                    </p>
                  </div>
                  <code className="text-xs text-slate-400" title={candidate.candidateKey}>
                    {candidate.candidateKey.slice(0, 12)}
                  </code>
                </div>

                <fieldset className="mt-4 overflow-hidden rounded-md border border-slate-200">
                  <legend className="sr-only">Choose the canonical global work</legend>
                  {candidate.works.map((work) => (
                    <label
                      key={work.id}
                      className={`grid cursor-pointer gap-3 border-b border-slate-100 p-3 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto] ${
                        selectedCanonical === work.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`canonical-${candidate.candidateKey}`}
                        value={work.id}
                        checked={selectedCanonical === work.id}
                        onChange={() => setCanonicalByCandidate((current) => ({
                          ...current,
                          [candidate.candidateKey]: work.id,
                        }))}
                        className="mt-1 h-4 w-4 border-slate-300 text-blue-600"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-800">{work.title}</span>
                          <span className="text-slate-500">— {work.originalArtist}</span>
                          {work.id === candidate.suggestedCanonicalWorkId && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                              Suggested by usage
                            </span>
                          )}
                        </div>
                        <p className="mt-1 break-all font-mono text-xs text-slate-400">{work.id}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {work.streamerIds.map((streamerId) => (
                            <span key={streamerId} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {streamerId}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right text-xs tabular-nums text-slate-500">
                        <p>{work.songCount} songs</p>
                        <p>{work.performanceCount} performances</p>
                        {work.pendingSongCount > 0 && (
                          <p className="text-amber-700">{work.pendingSongCount} pending</p>
                        )}
                      </div>
                    </label>
                  ))}
                </fieldset>

                {candidate.localDuplicates.length > 0 && (
                  <p className="mt-3 rounded-md bg-violet-50 p-2 text-sm text-violet-800">
                    Local follow-up required after a global merge:{' '}
                    {candidate.localDuplicates.map((item) => `${item.streamerId} (${item.songCount})`).join(', ')}.
                    This action will not merge those local song rows.
                  </p>
                )}

                {deferredSourceCount > 0 && (
                  <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                    This reviewed batch will retire {sourceWorkIds.length} source work IDs;{' '}
                    {deferredSourceCount} will remain and reappear for another confirmed batch.
                  </p>
                )}

                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Review note (optional)
                  <textarea
                    value={notes[noteStateKey] ?? ''}
                    maxLength={2000}
                    onChange={(event) => setNotes((current) => ({
                      ...current,
                      [noteStateKey]: event.target.value,
                    }))}
                    rows={2}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Source or reason for the review decision"
                  />
                </label>

                {isConfirming ? (
                  <div className="mt-4 space-y-3">
                    <MergeImpact
                      candidate={candidate}
                      canonicalWorkId={selectedCanonical}
                      sourceWorkIds={sourceWorkIds}
                    />
                    <p className="break-all text-xs text-slate-500">
                      Canonical: <code>{selectedCanonical}</code><br />
                      Retire: <code>{sourceWorkIds.join(', ')}</code>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void confirmMerge(
                          candidate,
                          selectedCanonical,
                          sourceWorkIds,
                        )}
                        className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        {acting ? 'Merging...' : 'Confirm global work merge'}
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => setConfirmingCandidateKey(null)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => setConfirmingCandidateKey(candidate.candidateKey)}
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                    >
                      Review merge impact
                    </button>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void saveDecision(candidate, 'needs_research')}
                      className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Needs research
                    </button>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void saveDecision(candidate, 'not_duplicate')}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Not duplicate
                    </button>
                  </div>
                )}
              </section>
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
                setActionError(null);
                setMessage(null);
                setConfirmingCandidateKey(null);
                setPage((current) => Math.max(1, current - 1));
              }}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setMessage(null);
                setConfirmingCandidateKey(null);
                setPage((current) => Math.min(totalPages, current + 1));
              }}
              disabled={page >= totalPages}
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

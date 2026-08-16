import type {
  WorkMatchCandidate,
  WorkMatchDecision,
  WorkMatchReason,
} from '../../../shared/types';
import { selectMergeSourceWorkIds } from '../lib/global-work-review';

const REASON_LABELS: Record<WorkMatchReason, string> = {
  case_width_whitespace: 'Case / width / whitespace',
  punctuation_spacing: 'Punctuation / spacing',
  diacritic_variant: 'Latin diacritic variant',
};

function decisionLabel(decision: WorkMatchDecision | null): string {
  if (decision === 'not_duplicate') return 'Not duplicate';
  if (decision === 'needs_research') return 'Needs research';
  return 'Pending review';
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
  const selectedWorks = candidate.works
    .filter((work) => selectedWorkIds.has(work.id))
    .sort((left, right) => {
      if (left.id === canonicalWorkId) return -1;
      if (right.id === canonicalWorkId) return 1;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
  const selectedStreamers = new Set(selectedWorks.flatMap((work) => work.streamerIds));
  const selectedSongs = selectedWorks.reduce((sum, work) => sum + work.songCount, 0);
  const selectedPerformances = selectedWorks.reduce(
    (sum, work) => sum + work.performanceCount,
    0,
  );
  const canonicalTags = new Set(
    selectedWorks.find((work) => work.id === canonicalWorkId)?.tags ?? [],
  );
  const resultingTags = [...new Set(selectedWorks.flatMap((work) => work.tags))];
  const addedTags = resultingTags.filter((tag) => !canonicalTags.has(tag));
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Site-wide identity change</p>
      <p className="mt-1">
        This retires {sourceWorkIds.length} work ID(s) while keeping{' '}
        {selectedSongs} local song record(s) across {selectedStreamers.size} VTuber(s).
        Source song-to-work links are repointed to the surviving identity.
      </p>
      <p className="mt-1">
        Canonical tags after merge: {resultingTags.length > 0 ? resultingTags.join(', ') : 'none'}.
        {addedTags.length > 0 ? ` Adds: ${addedTags.join(', ')}.` : ' No tags are added.'}
      </p>
      <p className="mt-1 font-medium">
        All {selectedPerformances} performances and their performance IDs are preserved.
        No song or performance row is deleted.
      </p>
    </div>
  );
}

interface WorkMatchCandidateCardProps {
  candidate: WorkMatchCandidate;
  selectedCanonicalWorkId: string;
  note: string;
  queueBusy: boolean;
  acting: boolean;
  isConfirming: boolean;
  onCanonicalChange: (workId: string) => void;
  onNoteChange: (note: string) => void;
  onReviewMergeImpact: () => void;
  onCancelMerge: () => void;
  onConfirmMerge: (canonicalWorkId: string, sourceWorkIds: string[]) => void;
  onSaveDecision: (decision: WorkMatchDecision) => void;
}

export default function WorkMatchCandidateCard({
  candidate,
  selectedCanonicalWorkId,
  note,
  queueBusy,
  acting,
  isConfirming,
  onCanonicalChange,
  onNoteChange,
  onReviewMergeImpact,
  onCancelMerge,
  onConfirmMerge,
  onSaveDecision,
}: WorkMatchCandidateCardProps) {
  const sourceWorkIds = selectMergeSourceWorkIds(candidate, selectedCanonicalWorkId);
  const deferredSourceCount = candidate.works.length - 1 - sourceWorkIds.length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
              selectedCanonicalWorkId === work.id ? 'bg-blue-50' : 'hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name={`canonical-${candidate.candidateKey}`}
              value={work.id}
              checked={selectedCanonicalWorkId === work.id}
              disabled={queueBusy}
              onChange={() => onCanonicalChange(work.id)}
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
        Review note (optional — saved with the decision or merge)
        <textarea
          value={note}
          maxLength={2000}
          disabled={queueBusy}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Source or reason for the review decision"
        />
      </label>

      {isConfirming ? (
        <div className="mt-4 space-y-3">
          <MergeImpact
            candidate={candidate}
            canonicalWorkId={selectedCanonicalWorkId}
            sourceWorkIds={sourceWorkIds}
          />
          <p className="break-all text-xs text-slate-500">
            Canonical: <code>{selectedCanonicalWorkId}</code><br />
            Retire: <code>{sourceWorkIds.join(', ')}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={queueBusy}
              onClick={() => onConfirmMerge(selectedCanonicalWorkId, sourceWorkIds)}
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {acting ? 'Merging...' : 'Confirm global work merge'}
            </button>
            <button
              type="button"
              disabled={queueBusy}
              onClick={onCancelMerge}
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
            disabled={queueBusy}
            onClick={onReviewMergeImpact}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            Review merge impact
          </button>
          <button
            type="button"
            disabled={queueBusy}
            onClick={() => onSaveDecision('needs_research')}
            className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            Needs research
          </button>
          <button
            type="button"
            disabled={queueBusy}
            onClick={() => onSaveDecision('not_duplicate')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Not duplicate
          </button>
        </div>
      )}
    </section>
  );
}

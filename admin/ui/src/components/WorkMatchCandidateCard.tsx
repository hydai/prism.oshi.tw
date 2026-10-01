import type {
  WorkMatchCandidate,
  WorkMatchDecision,
  WorkMatchReason,
} from '../../../shared/types';
import { decisionPill, selectMergeSourceWorkIds } from '../lib/global-work-review';
import { Button } from './ui/Button';
import { GlassCard } from './ui/Display';
import { Textarea } from './ui/Fields';
import { Icon } from './ui/Icon';
import { MICRO_LABEL } from './ui/micro-label';
import { Note } from './ui/Note';
import { Pill, type Tone } from './ui/Pill';

const REASON_LABELS: Record<WorkMatchReason, string> = {
  case_width_whitespace: 'Case / width / whitespace',
  punctuation_spacing: 'Punctuation / spacing',
  diacritic_variant: 'Latin diacritic variant',
};

/** A bold count and its noun, singular for one. */
function Counted({ count, one, many }: { count: number; one: string; many: string }) {
  return (
    <>
      <b className="font-bold text-fg">{count}</b> {count === 1 ? one : many}
    </>
  );
}

/**
 * One info pill per Tier A reason: the card's top row, and each row of the review queue's list
 * (neutral, through `tone`, on a row decided in this view).
 */
export function ReasonPills({ reasons, tone = 'info' }: { reasons: readonly WorkMatchReason[]; tone?: Tone }) {
  return (
    <>
      {reasons.map((reason) => (
        <Pill key={reason} tone={tone}>
          {REASON_LABELS[reason]}
        </Pill>
      ))}
    </>
  );
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
    <Note tone="warn" icon="alert" title="Site-wide identity change">
      <p className="mt-1">
        This retires {sourceWorkIds.length} work ID(s) while keeping{' '}
        {selectedSongs} local song record(s) across {selectedStreamers.size} VTuber(s).
        Source song-to-work links are repointed to the surviving identity.
      </p>
      <p className="mt-1">
        {/* One text run: the tag union reads as one sentence wherever the page's text is searched. */}
        {`Canonical tags after merge: ${resultingTags.length > 0 ? resultingTags.join(', ') : 'none'}.`}
        {addedTags.length > 0 ? ` Adds: ${addedTags.join(', ')}.` : ' No tags are added.'}
      </p>
      <p className="mt-1 font-semibold">
        All {selectedPerformances} performances and their performance IDs are preserved.
        No song or performance row is deleted.
      </p>
    </Note>
  );
}

interface WorkMatchCandidateCardProps {
  candidate: WorkMatchCandidate;
  selectedCanonicalWorkId: string;
  note: string;
  /** The queue is busy (a decision, a merge or a re-read is running, or the last re-read failed):
   *  every decision and merge button waits. */
  queueBusy: boolean;
  /** This candidate's own decision or merge is saving: its identity choice and its note freeze too.
   *  While only the queue is busy they stay editable, so the curator can go on typing the next
   *  row's note while the page re-reads. */
  acting: boolean;
  isConfirming: boolean;
  onCanonicalChange: (workId: string) => void;
  onNoteChange: (note: string) => void;
  onReviewMergeImpact: () => void;
  onCancelMerge: () => void;
  onConfirmMerge: (canonicalWorkId: string, sourceWorkIds: string[]) => void;
  onSaveDecision: (decision: WorkMatchDecision) => void;
}

/**
 * The review queue's detail for one candidate (spec §8.6, the mockup's `.det`): its pills and key,
 * the summary, the "Keep which work identity?" radio cards, the follow-up and deferred-batch notes,
 * the review note and the actions. "Review merge impact" opens the second step in place: the
 * `MergeImpact`, the IDs kept and retired, and "Confirm global work merge".
 */
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
  const review = decisionPill(candidate.decision);

  return (
    <GlassCard
      as="section"
      aria-label="Selected candidate"
      padding="none"
      className="flex flex-col gap-3 px-[18px] py-3.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone="ok">High confidence</Pill>
        <Pill tone={review.tone}>{review.label}</Pill>
        <ReasonPills reasons={candidate.reasons} />
        <code className="ml-auto font-mono text-meta text-fg-subtle" title={candidate.candidateKey}>
          {candidate.candidateKey.slice(0, 12)}
        </code>
      </div>

      <p className="text-[12px] text-fg-muted">
        <Counted count={candidate.works.length} one="work ID" many="work IDs" />
        {' · '}
        <Counted count={candidate.songCount} one="local song" many="local songs" />
        {' · '}
        <Counted count={candidate.performanceCount} one="performance" many="performances" />
        {' · '}
        <Counted count={candidate.streamerCount} one="VTuber" many="VTubers" />
      </p>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="sr-only">Choose the canonical global work</legend>
        {/* The legend names the group for assistive tech; this is its visible twin. */}
        <p aria-hidden="true" className={MICRO_LABEL}>
          Keep which work identity?
        </p>
        {candidate.works.map((work) => {
          const chosen = selectedCanonicalWorkId === work.id;
          return (
            <label
              key={work.id}
              className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[14px] border px-3 py-2.5 transition-colors ${
                chosen ? 'border-hot-line bg-selected' : 'border-field-line bg-field hover:bg-row-hover'
              }`}
            >
              <input
                type="radio"
                name={`canonical-${candidate.candidateKey}`}
                value={work.id}
                checked={chosen}
                disabled={acting}
                onChange={() => onCanonicalChange(work.id)}
                className="mt-0.5 h-4 w-4 appearance-none rounded-full border border-field-line bg-field checked:border-4 checked:border-accent-fg focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="text-[13px] font-[650] text-fg">{work.title}</span>
                  <span className="text-[12px] text-fg-muted">— {work.originalArtist}</span>
                  {work.id === candidate.suggestedCanonicalWorkId ? (
                    <Pill tone="info">Suggested by usage</Pill>
                  ) : null}
                </span>
                <span className="mb-[5px] mt-[3px] block break-all font-mono text-meta text-fg-subtle">{work.id}</span>
                <span className="flex flex-wrap gap-1">
                  {work.streamerIds.map((streamerId) => (
                    <span
                      key={streamerId}
                      className="whitespace-nowrap rounded-radius-pill border border-field-line bg-field px-[7px] py-0.5 text-meta font-medium text-fg-muted"
                    >
                      {streamerId}
                    </span>
                  ))}
                </span>
              </span>
              <span className="whitespace-nowrap text-right text-[11px] leading-normal tabular-nums text-fg-muted">
                <span className="block">
                  <Counted count={work.songCount} one="song" many="songs" />
                </span>
                <span className="block">
                  <Counted count={work.performanceCount} one="performance" many="performances" />
                </span>
                {work.pendingSongCount > 0 ? (
                  <span className="block text-tone-warn-fg">{work.pendingSongCount} pending</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      {candidate.localDuplicates.length > 0 ? (
        <Note tone="violet">
          Local follow-up required after a global merge:{' '}
          <b className="font-[750]">
            {candidate.localDuplicates.map((item) => `${item.streamerId} (${item.songCount})`).join(', ')}
          </b>
          . This action will not merge those local song rows.
        </Note>
      ) : null}

      {deferredSourceCount > 0 ? (
        <Note tone="warn">
          This reviewed batch will retire {sourceWorkIds.length} source work IDs;{' '}
          {deferredSourceCount} will remain and reappear for another confirmed batch.
        </Note>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className={MICRO_LABEL}>
          Review note{' '}
          <span className="font-medium normal-case tracking-normal">(optional — saved with the decision or merge)</span>
        </span>
        <Textarea
          value={note}
          maxLength={2000}
          disabled={acting}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          placeholder="Source or reason for the review decision"
        />
      </label>

      {isConfirming ? (
        <div className="flex flex-col gap-3">
          <MergeImpact
            candidate={candidate}
            canonicalWorkId={selectedCanonicalWorkId}
            sourceWorkIds={sourceWorkIds}
          />
          <p className="break-all text-meta text-fg-muted">
            Canonical: <code className="font-mono text-fg">{selectedCanonicalWorkId}</code><br />
            Retire: <code className="font-mono text-fg">{sourceWorkIds.join(', ')}</code>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={queueBusy}
              onClick={() => onConfirmMerge(selectedCanonicalWorkId, sourceWorkIds)}
            >
              {acting ? 'Merging...' : 'Confirm global work merge'}
            </Button>
            <Button size="sm" disabled={queueBusy} onClick={onCancelMerge}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" icon="merge" disabled={queueBusy} onClick={onReviewMergeImpact}>
            Review merge impact
          </Button>
          <Button size="sm" disabled={queueBusy} onClick={() => onSaveDecision('needs_research')}>
            <Icon name="flag" size={14} className="text-tone-warn-fg" />
            Needs research
          </Button>
          <Button size="sm" icon="x" disabled={queueBusy} onClick={() => onSaveDecision('not_duplicate')}>
            Not duplicate
          </Button>
          <span className="ml-auto text-meta text-fg-subtle">then jumps to the next candidate</span>
        </div>
      )}
    </GlassCard>
  );
}

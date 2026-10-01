import { useRef } from 'react';
import { Link } from 'react-router-dom';
import type { WorkMatchCandidate, WorkMatchFilter, WorkMatchStats } from '../../../shared/types';
import WorkMatchCandidateCard, { ReasonPills } from '../components/WorkMatchCandidateCard';
import { Button, IconButton } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { QueueLayout } from '../components/ui/QueueLayout';
import { Segmented } from '../components/ui/Toggles';
import { usePageHeaderHeight } from '../hooks/usePageHeaderHeight';
import { useQueueLeadHeight } from '../hooks/useQueueLeadHeight';
import { decisionPill } from '../lib/global-work-review';
import { useWorkReviewPage, type WorkReviewPage } from './useWorkReviewPage';
import type { WorkReviewOutcome } from './work-review-state';

export { MergeImpact } from '../components/WorkMatchCandidateCard';

const FILTERS: ReadonlyArray<{ value: WorkMatchFilter; label: string; stat: keyof WorkMatchStats }> = [
  { value: 'pending', label: 'Pending', stat: 'pendingCount' },
  { value: 'needs_research', label: 'Needs research', stat: 'needsResearchCount' },
  { value: 'not_duplicate', label: 'Not duplicate', stat: 'notDuplicateCount' },
  { value: 'all', label: 'All', stat: 'candidateCount' },
];

/** A decision's pill: in a list row, and in a decided row's read-only detail. */
function DecisionPill({ decision }: { decision: WorkReviewOutcome }) {
  const { label, tone } = decisionPill(decision);
  return <Pill tone={tone}>{label}</Pill>;
}

/** The icon buttons in the list footer: the mockup's round, outlined `.ib`. */
const OUTLINED_ICON_BUTTON = 'border border-field-line bg-field';

const candidateKeyOf = (candidate: WorkMatchCandidate): string => candidate.candidateKey;

/**
 * "{title A} ⇄ {title B} +{n}": the icon stands between the spellings, and assistive tech hears "and".
 * `muted`: the whole line, "+{n}" included, in the muted text colour (a list row decided in this view).
 */
function CandidateTitles({ candidate, muted = false }: { candidate: WorkMatchCandidate; muted?: boolean }) {
  const [first, second] = candidate.works;
  const more = candidate.works.length - 2;
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-[650] ${muted ? 'text-fg-muted' : 'text-fg'}`}>
      <span className="truncate">{first?.title}</span>
      <Icon name="gitCompare" size={12} className="text-fg-subtle" />
      <span className="sr-only"> and </span>
      <span className="truncate">{second?.title}</span>
      {more > 0 ? <span className={`shrink-0 ${muted ? 'text-fg-muted' : 'text-fg-subtle'}`}>{` +${more}`}</span> : null}
    </span>
  );
}

/**
 * A list row: both spellings, the artist and the reach, then the decision, confidence and reasons.
 * The decision is the one made in this view (`outcome`), or else the one saved on the server — a
 * pill only: a row decided elsewhere stays live here (not faded, still actionable, still counted).
 * A row decided in this view fades by colour, never by opacity, so every text keeps its contrast:
 * its titles and meta take the muted text colour and its confidence and reason pills turn neutral,
 * while its decision pill keeps its own tone.
 */
function CandidateRow({ candidate, outcome }: { candidate: WorkMatchCandidate; outcome: WorkReviewOutcome | undefined }) {
  const works = candidate.works.length;
  const vtubers = candidate.streamerCount;
  const decision = outcome ?? candidate.decision;
  const muted = outcome !== undefined;
  return (
    <>
      <CandidateTitles candidate={candidate} muted={muted} />
      <span className={`truncate text-[11px] ${muted ? 'text-fg-muted' : 'text-fg-subtle'}`}>
        {`${candidate.works[0]?.originalArtist ?? ''} · ${works} ${works === 1 ? 'work ID' : 'work IDs'} · ${vtubers} ${vtubers === 1 ? 'VTuber' : 'VTubers'}`}
      </span>
      <span className="mt-0.5 flex flex-wrap gap-[5px]">
        {decision ? <DecisionPill decision={decision} /> : null}
        <Pill tone={muted ? 'neutral' : 'ok'}>High</Pill>
        <ReasonPills reasons={candidate.reasons} tone={muted ? 'neutral' : 'info'} />
      </span>
    </>
  );
}

/** The Tier A boundary and the reach of the whole queue, above the list. */
function InfoStrip({ affectedWorks }: { affectedWorks: number }) {
  return (
    <GlassCard
      padding="none"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-[9px] text-[11.5px] text-fg-muted"
    >
      <Icon name="alert" size={14} className="text-tone-violet-fg" />
      <p className="min-w-0 flex-1 basis-64">
        Tier A finds formatting-only title and original-artist differences. Every result requires
        curator confirmation; this scanner never merges automatically.
      </p>
      <p className="whitespace-nowrap">
        <b className="font-bold text-fg">{affectedWorks.toLocaleString()}</b>{' '}
        {affectedWorks === 1 ? 'affected work ID' : 'affected work IDs'}
      </p>
    </GlassCard>
  );
}

/** A row decided in this view: read-only until a reload, a filter change or a page change drops it. */
function DecidedCandidate({ candidate, outcome }: { candidate: WorkMatchCandidate; outcome: WorkReviewOutcome }) {
  return (
    <GlassCard
      as="section"
      aria-label="Selected candidate"
      padding="none"
      className="flex flex-col gap-2.5 px-[18px] py-3.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <DecisionPill decision={outcome} />
      </div>
      <CandidateTitles candidate={candidate} />
      <p className="text-token-sm text-fg-muted">It leaves the list when you reload or change the filter.</p>
    </GlassCard>
  );
}

/**
 * The queue's detail: the selected row's card, or its read-only record once it is decided; with no
 * selection and every row decided, where to go next.
 */
function CandidateDetail({ review }: { review: WorkReviewPage }) {
  const { state, busy, reloadBlocked } = review;
  const selected = state.candidates.find((candidate) => candidate.candidateKey === state.selectedKey);
  if (selected) {
    const outcome = state.decided[selected.candidateKey];
    if (outcome) return <DecidedCandidate candidate={selected} outcome={outcome} />;
    return (
      <WorkMatchCandidateCard
        candidate={selected}
        selectedCanonicalWorkId={review.canonicalOf(selected)}
        note={review.noteOf(selected)}
        queueBusy={busy}
        acting={state.actionCandidateKey === selected.candidateKey}
        isConfirming={state.confirmingCandidateKey === selected.candidateKey}
        onCanonicalChange={(workId) => review.chooseCanonical(selected, workId)}
        onNoteChange={(note) => review.editNote(selected, note)}
        onReviewMergeImpact={() => review.reviewMergeImpact(selected)}
        onCancelMerge={review.cancelMerge}
        onConfirmMerge={(canonicalWorkId, sourceWorkIds) => void review.confirmMerge(selected, canonicalWorkId, sourceWorkIds)}
        onSaveDecision={(decision) => void review.saveDecision(selected, decision)}
      />
    );
  }
  if (state.candidates.length === 0 || !state.candidates.every((candidate) => candidate.candidateKey in state.decided)) {
    return null;
  }
  return (
    <GlassCard>
      <EmptyState
        icon="checkCircle"
        title="Every candidate on this page is decided"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {state.page < state.totalPages ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={review.nextPage}>
                Next page
              </Button>
            ) : null}
            <Button size="sm" icon="refresh" disabled={reloadBlocked} onClick={review.reload}>
              Reload
            </Button>
          </div>
        }
      />
    </GlassCard>
  );
}

/** The list of this page's candidates beside the selected one's detail, with the page steps below. */
function CandidateQueue({ review }: { review: WorkReviewPage }) {
  const { state, busy } = review;
  return (
    <QueueLayout
      listLabel="Candidates"
      listTitle="Candidates"
      listCount={review.rangeLabel}
      items={state.candidates}
      getKey={candidateKeyOf}
      selectedKey={state.selectedKey}
      onSelect={review.select}
      isDecided={(candidate) => candidate.candidateKey in state.decided}
      renderItem={(candidate) => <CandidateRow candidate={candidate} outcome={state.decided[candidate.candidateKey]} />}
      hint="next / previous"
      footer={
        <>
          <IconButton
            label="Previous page"
            icon="chevronLeft"
            size="sm"
            className={OUTLINED_ICON_BUTTON}
            disabled={busy || state.page <= 1}
            onClick={review.previousPage}
          />
          <IconButton
            label="Next page"
            icon="chevronRight"
            size="sm"
            className={OUTLINED_ICON_BUTTON}
            disabled={busy || state.page >= state.totalPages}
            onClick={review.nextPage}
          />
        </>
      }
      emptyList={
        state.loading ? (
          <div className="p-3.5">
            <Skeleton rows={6} label="Scanning global works..." />
          </div>
        ) : (
          <p className="px-3.5 py-6 text-center text-token-sm text-fg-muted">No candidates in this review state.</p>
        )
      }
      detail={<CandidateDetail review={review} />}
    />
  );
}

/**
 * The Work Review queue (spec §8.6): the Tier A candidates of one filter, 50 to a page, in a list
 * beside the selected candidate's detail. `useWorkReviewPage` holds the data and the flow: a decision
 * or a merge keeps its row, faded and read-only, and the page silently re-reads the same filter and
 * page before the next one can go out.
 */
export default function GlobalWorkReview() {
  const review = useWorkReviewPage();
  const { state, busy, reloadBlocked } = review;
  // The header is the root's first child on every render, the first included: it is measured there.
  const pageRef = useRef<HTMLDivElement>(null);
  usePageHeaderHeight(pageRef);
  // The lead above the queue is measured too: until the list card sticks, it sits that much lower.
  const leadRef = useRef<HTMLDivElement>(null);
  useQueueLeadHeight(pageRef, leadRef);

  return (
    // No blur, transform or overflow on this root: the header and the list card stick to <main>.
    <div ref={pageRef} className="flex flex-col">
      <PageHeader
        crumb="LIBRARY"
        title="Global Work Review"
        actions={
          <Link to="/works" className={buttonClasses({ variant: 'secondary' })}>
            <Icon name="library" size={14} />
            Global Library
          </Link>
        }
      >
        {/* Four options with their counts outgrow a phone: there the filter scrolls, not the page. */}
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Segmented
            label="Review filter"
            value={state.filter}
            onChange={review.changeFilter}
            options={FILTERS.map(({ value, label, stat }) => ({ value, label, count: state.stats[stat] }))}
            disabled={busy}
          />
        </div>
      </PageHeader>

      <div className="flex flex-col gap-3.5 p-4 lg:px-5 lg:pb-[18px]">
        {/* The queue's lead: the list card takes the room it takes (useQueueLeadHeight) off its height. */}
        <div ref={leadRef} className="flex flex-col gap-3.5">
          <InfoStrip affectedWorks={state.stats.affectedWorks} />

          {/* The rows on screen may carry stale versions now: nothing is decided until a reload lands. */}
          {state.rereadError !== null && !state.loading && state.scanError === null ? (
            <Note
              tone="danger"
              icon="alert"
              role="alert"
              title="Couldn't refresh this page."
              action={
                <Button size="sm" icon="refresh" disabled={reloadBlocked} onClick={review.reload}>
                  Reload
                </Button>
              }
            >
              Reload before the next decision.
            </Note>
          ) : null}
        </div>

        {state.scanError !== null ? (
          <Note
            tone="danger"
            icon="alert"
            role="alert"
            action={<Button size="sm" icon="refresh" onClick={review.reload}>Retry</Button>}
          >
            {state.scanError}
          </Note>
        ) : (
          <CandidateQueue review={review} />
        )}
      </div>
    </div>
  );
}

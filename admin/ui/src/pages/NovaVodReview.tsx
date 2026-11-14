import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AuthUser, NovaStatus } from '../../../shared/types';
import { summarizeCorrection } from '../../../shared/vod-correction';
import type { CorrectionApplyBody, NovaVodCorrectionView } from '../../../shared/vod-correction';
import { api, ApiError } from '../api/client';
import { useInboxCounts } from '../components/shell/InboxCounts';
import { Button } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { DetailField } from '../components/ui/DetailField';
import { GlassCard, Skeleton } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { StoredTime } from '../components/ui/StoredTime';
import { useToast } from '../components/ui/toast';
import { CorrectionRows } from '../components/vod-correction/CorrectionRows';
import { ReviewFooter, type ReviewAction } from '../components/vod-correction/ReviewFooter';
import { TimeFieldReport } from '../components/vod-correction/time-fields';
import { YouTubePlayer, type YouTubePlayerHandle } from '../components/YouTubePlayer';
import { useApproveWithoutApplying } from '../hooks/useApproveWithoutApplying';
import { usePageHeaderHeight } from '../hooks/usePageHeaderHeight';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { draftOperations, initialDraft, type CorrectionDraft } from '../lib/vod-correction-draft';

const APPLY_FAILED = '無法套用修正';

/** What the curator reads when the VOD's video has no stream now: there is nothing left here to review it against. */
const NO_TARGET_STREAM = '這支影片目前沒有對應的 stream，請回到列表重新審核';

/** What the curator reads when an apply or a rejection is refused because the submission was reviewed meanwhile. */
const ALREADY_REVIEWED = '這份投稿已審核過了';

/** The review of the VOD `id`. One whose video has no stream now is refused in words, not with the worker's code. */
async function loadReview(id: string): Promise<NovaVodCorrectionView> {
  try {
    return await api.getNovaVodCorrection(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && err.message === 'no_target_stream') throw new Error(NO_TARGET_STREAM);
    throw err;
  }
}

const NO_FIELDS: ReadonlySet<string> = new Set();

/**
 * What the last apply left the page to say, for the view it was sent against: the list changed under the review
 * (`stale`, until a reload brings the new one), or the catalog took the changes but the submission was not marked
 * reviewed (`recovery`, with the reviewer note the apply would have written).
 */
type Outcome = { view: NovaVodCorrectionView; kind: 'stale' } | { view: NovaVodCorrectionView; kind: 'recovery'; note: string };

/** How many performances a `would_publish_hidden` refusal names. */
function hiddenCount(error: ApiError): number {
  const performances = error.payload?.performances;
  return Array.isArray(performances) ? performances.length : 0;
}

/** The first problem an `invalid_operations` refusal names, else the refusal's own message. */
function firstDetail(error: ApiError): string {
  const details = error.payload?.details;
  return Array.isArray(details) && typeof details[0] === 'string' ? details[0] : error.message;
}

/**
 * The review's requests and what their answers do. An apply that lands, a rejection and the approval that applies
 * nothing toast, refresh the sidebar's count and go back to the list. An apply refused as `stale`, or one that reached
 * the catalog and failed after it (502 `appliedToCatalog`), leaves an outcome for the page to show. An apply or a
 * rejection refused as `not_pending` (the submission was reviewed meanwhile) says so and asks for the review again
 * (`reload`), which then reads as reviewed. The other refusals are error toasts, the first detail of an
 * `invalid_operations` one included.
 */
function useReviewActions(view: NovaVodCorrectionView, draft: CorrectionDraft, note: string, reload: () => void) {
  const toast = useToast();
  const navigate = useNavigate();
  const approveWithoutApplying = useApproveWithoutApplying();
  const { refresh: refreshInboxCounts } = useInboxCounts();
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const id = view.submission.id;

  const landed = () => {
    refreshInboxCounts('vods');
    navigate('/nova/vods');
  };

  const apply = async () => {
    const { operations, skipped } = draftOperations(draft, view);
    const body: CorrectionApplyBody = { fingerprint: view.fingerprint, ...(note.trim() === '' ? {} : { reviewerNote: note }), operations, skipped };
    setBusy('apply');
    try {
      const result = await api.applyNovaVodCorrection(id, body);
      toast.success('修正已套用', result.summary);
      landed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message === 'stale') {
        setOutcome({ view, kind: 'stale' });
      } else if (err instanceof ApiError && err.status === 502 && err.payload?.appliedToCatalog === true) {
        // The note the worker would have written: the recovery's approval overwrites the reviewer note with it.
        setOutcome({ view, kind: 'recovery', note: [note.trim(), summarizeCorrection(operations, skipped)].filter(Boolean).join('\n') });
      } else if (err instanceof ApiError && err.status === 409 && err.message === 'would_publish_hidden') {
        toast.error(`${APPLY_FAILED}：會讓 ${hiddenCount(err)} 場演出跟著公開`, { detail: '這些演出所在的 stream 還沒公開，套用卻會讓它們出現在網站上。請先處理這些演出。' });
      } else if (err instanceof ApiError && err.status === 409 && err.message === 'not_pending') {
        toast.error(ALREADY_REVIEWED);
        reload();
      } else if (err instanceof ApiError && err.status === 400) {
        toast.error(APPLY_FAILED, { detail: firstDetail(err) });
      } else {
        toast.error(APPLY_FAILED, { detail: errorMessage(err, '') });
      }
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy('reject');
    try {
      await api.updateNovaVodStatus(id, { status: 'rejected', reviewer_note: note });
      toast.success('修正已退回', view.submission.stream_title || view.submission.video_id);
      landed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message === 'not_pending') {
        toast.error(ALREADY_REVIEWED);
        reload();
      } else {
        toast.error('無法退回修正', { detail: errorMessage(err, '') });
      }
    } finally {
      setBusy(null);
    }
  };

  const current = outcome !== null && outcome.view === view ? outcome : null;

  // 「直接通過（不套用）」 after a 502 that reached the catalog: it asks first, and toasts itself.
  const recover = async () => {
    if (current?.kind !== 'recovery') return;
    setBusy('recover');
    try {
      if ((await approveWithoutApplying(id, current.note)) !== null) landed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && err.message === 'no_target_stream') toast.error(NO_TARGET_STREAM);
      else toast.error(errorMessage(err, 'Action failed'));
    } finally {
      setBusy(null);
    }
  };

  return { busy, outcome: current, apply, reject, recover };
}

/**
 * The stream as the catalog has it against the one submitted (for reference: a correction changes only the songs),
 * a warning when the stream is not public, the submitter note, and the other corrections of the stream still to
 * review.
 */
function StreamFacts({ view }: { view: NovaVodCorrectionView }) {
  const { stream, submission } = view;
  return (
    <GlassCard padding="sm" className="flex flex-col gap-3">
      <p className="text-token-sm text-fg-muted">{`${submission.streamer_slug} · 目前 ${view.current.length} 首 → 投稿 ${view.proposed.length} 首`}</p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <DetailField label="目前">{`${stream.title} · ${stream.date}`}</DetailField>
        <DetailField label="投稿">{`${submission.stream_title} · ${submission.stream_date}`}</DetailField>
      </dl>
      {stream.status !== 'approved' ? (
        <Note tone="warn" icon="alert">{`這場 stream 目前不是公開狀態（${stream.status}）`}</Note>
      ) : null}
      <dl>
        <DetailField label="Submitter Note">
          <span className="whitespace-pre-wrap">{submission.submitter_note || '—'}</span>
        </DetailField>
      </dl>
      {view.otherPendingCount > 0 ? <Note tone="info" icon="inbox">{`這場還有 ${view.otherPendingCount} 份待審修正`}</Note> : null}
    </GlassCard>
  );
}

/**
 * The review of one loaded correction (layout B): the player and the stream's facts on the left, the rows and the
 * footer on the right. The draft belongs to the view it was made for, so a new view (a reload after `stale`) starts
 * from its own initial draft; the reviewer note is the curator's and stays. 套用 waits while a time field holds text
 * that does not read (`TimeFieldReport`).
 */
function ReviewWorkspace({ view, reloading, onReload }: { view: NovaVodCorrectionView; reloading: boolean; onReload: () => void }) {
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const fresh = useMemo(() => initialDraft(view), [view]);
  const [edited, setEdited] = useState<{ view: NovaVodCorrectionView; draft: CorrectionDraft } | null>(null);
  const draft = edited !== null && edited.view === view ? edited.draft : fresh;
  const [note, setNote] = useState('');
  const [unreadableTimes, setUnreadableTimes] = useState(NO_FIELDS);
  // Stable for the page's life: each field's cleanup is keyed on it, and must not run while the field stays.
  const reportTime = useCallback((field: string, unreadable: boolean) => {
    setUnreadableTimes((fields) => {
      if (fields.has(field) === unreadable) return fields;
      const next = new Set(fields);
      if (unreadable) next.add(field);
      else next.delete(field);
      return next;
    });
  }, []);
  const { busy, outcome, apply, reject, recover } = useReviewActions(view, draft, note, onReload);
  const { appliedCount, skippedCount } = draftOperations(draft, view);
  const seek = useCallback((seconds: number) => playerRef.current?.seekTo(seconds), []);

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[calc(var(--page-header-h,62px)_+_1rem)]">
        <YouTubePlayer ref={playerRef} videoId={view.stream.videoId} />
        <StreamFacts view={view} />
      </div>
      <GlassCard padding="sm" className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 border-b border-line-soft px-1.5 pb-2">
          <h2 className="text-token-md font-bold text-fg">逐首對照</h2>
          <span className="text-meta text-fg-muted">依時間自動配對</span>
        </div>
        <TimeFieldReport.Provider value={reportTime}>
          <CorrectionRows view={view} draft={draft} onDraft={(next) => setEdited({ view, draft: next })} onSeek={seek} />
        </TimeFieldReport.Provider>
        <ReviewFooter
          appliedCount={appliedCount}
          skippedCount={skippedCount}
          note={note}
          onNoteChange={setNote}
          busy={busy}
          applyBlocked={outcome !== null}
          timesUnreadable={unreadableTimes.size > 0}
          rejectBlocked={outcome?.kind === 'recovery'}
          onApply={apply}
          onReject={reject}
        >
          {outcome?.kind === 'stale' ? (
            <Note
              tone="warn"
              icon="alert"
              role="alert"
              action={
                <Button size="sm" icon="refresh" busy={reloading} onClick={onReload}>
                  重新載入
                </Button>
              }
            >
              這場歌單在你審核時被改過
            </Note>
          ) : null}
          {outcome?.kind === 'recovery' ? (
            <Note
              tone="danger"
              icon="alert"
              role="alert"
              action={
                <Button size="sm" icon="checkCircle" busy={busy === 'recover'} onClick={recover}>
                  直接通過（不套用）
                </Button>
              }
            >
              歌單已套用變更，但這份投稿沒能標成已審核。請直接通過，不必再套用一次。
            </Note>
          ) : null}
        </ReviewFooter>
      </GlassCard>
    </div>
  );
}

/**
 * A submission that is no longer pending (Back after an apply, a bookmark, another tab): nothing on this page may be
 * sent for it, so the review is not offered, only the way back to the list.
 */
function ReviewedNotice({ status }: { status: NovaStatus }) {
  return (
    <Note
      tone="info"
      icon="checkCircle"
      role="status"
      action={
        <Link to="/nova/vods" className={buttonClasses({ size: 'sm' })}>
          回到列表
        </Link>
      }
    >
      {`這份投稿已審核過了（${status === 'approved' ? '已通過' : '已退回'}），不能再套用或退回。`}
    </Note>
  );
}

function ReviewHeader({ view, today }: { view: NovaVodCorrectionView | null; today: Date }) {
  return (
    <PageHeader
      recordTitle
      crumb={
        <Link to="/nova/vods" className="inline-flex items-center gap-1 rounded-radius-xs transition-colors hover:text-accent-fg">
          <Icon name="chevronLeft" size={12} />
          Nova VODs
        </Link>
      }
      title="修正審核"
      meta={
        view === null ? undefined : (
          <>
            <Pill tone={view.submission.kind === 'correction' ? 'violet' : 'neutral'}>
              {view.submission.kind === 'correction' ? '修正' : '對應既有 stream'}
            </Pill>
            <span>{view.submission.streamer_slug}</span>
            <span className="font-mono">{view.submission.id}</span>
            <span>
              <StoredTime value={view.submission.submitted_at} today={today} /> 提交
            </span>
          </>
        )
      }
    />
  );
}

/** The page: the review of the VOD in the URL, loaded once on mount (and again on a reload), with its states. */
function ReviewPage() {
  const { id = '' } = useParams<{ id: string }>();
  const pageRef = useRef<HTMLDivElement>(null);
  usePageHeaderHeight(pageRef);
  const correction = useApiResource(() => loadReview(id), [id]);
  // When the page opened: the submitted time only needs it to leave out the current year.
  const [today] = useState(() => new Date());
  const view = correction.data;

  return (
    // No blur, transform or overflow on this root: the header sticks to <main>.
    <div ref={pageRef} className="flex flex-col">
      <ReviewHeader view={view} today={today} />
      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        {correction.error !== null ? (
          <Note
            tone="danger"
            icon="alert"
            role="alert"
            title="無法載入這份修正。"
            action={
              <Button size="sm" icon="refresh" onClick={correction.reload}>
                Retry
              </Button>
            }
          >
            {correction.error}
          </Note>
        ) : null}
        {view === null && correction.loading ? (
          <GlassCard>
            <Skeleton rows={8} label="Loading correction…" />
          </GlassCard>
        ) : null}
        {view !== null && view.submission.status !== 'pending' ? <ReviewedNotice status={view.submission.status} /> : null}
        {view !== null && view.submission.status === 'pending' ? (
          <ReviewWorkspace view={view} reloading={correction.loading} onReload={correction.reload} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The review of a Nova VOD whose video already has a stream (spec §6.6): the submission's song list against the
 * stream's, row by row, with the video to check them against. The curator ticks and edits what to change and applies
 * it in one write, or rejects the submission. Curators only: anyone else gets the guard, and the page, with every
 * request it makes, never mounts.
 */
export default function NovaVodReview({ user }: { user: AuthUser }) {
  if (user.role !== 'curator') {
    return (
      <div className="p-4 lg:px-5">
        <Note tone="danger" icon="lock">
          Curator access is required.
        </Note>
      </div>
    );
  }
  return <ReviewPage />;
}

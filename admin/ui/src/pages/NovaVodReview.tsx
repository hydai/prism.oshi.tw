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
import { MARK_APPLIED_APPROVED, useApproveWithoutApplying } from '../hooks/useApproveWithoutApplying';
import { usePageHeaderHeight } from '../hooks/usePageHeaderHeight';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { draftFlags, draftOperations, type CorrectionDraft } from '../lib/vod-correction-draft';
import { guardedInitialDraft } from '../lib/vod-correction-guard';

const APPLY_FAILED = '無法套用修正';

/** What the curator reads when the VOD's video has no stream now: there is nothing left here to review it against. */
const NO_TARGET_STREAM = '這支影片目前沒有對應的 stream，請回到列表重新審核';

/**
 * What the curator reads when a request of this page finds the submission reviewed meanwhile (in another tab, or from
 * the list): an apply refused as `not_pending`, a rejection or an approval refused as `status_changed` (both carry
 * the `pending` this page shows), and an apply whose changes reached the catalog while another review landed.
 */
const ALREADY_REVIEWED = '這份投稿已審核過了';

/** The detail of the last of those: the catalog has the changes, and the other review was left as it is. */
const APPLIED_BUT_REVIEWED_ELSEWHERE = '變更已寫入歌單，但這份投稿在套用期間被另一位審核者處理了，它的狀態沒有被覆寫。';

/** A refusal saying that the submission no longer has the status a request of this page carried. */
function isStatusChanged(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.message === 'status_changed';
}

/**
 * A refusal saying that an apply of the submission reached the catalog and the submission was never marked reviewed:
 * an apply or a rejection of it is refused, and only the approval that recovers that apply may follow.
 */
function isAlreadyApplied(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.message === 'already_applied';
}

/** A refusal saying that the VOD's video has no stream now: there is nothing left to review it against. */
function isNoTargetStream(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 404 && err.message === 'no_target_stream';
}

/** The review of the VOD `id`. One whose video has no stream now is refused in words, not with the worker's code. */
async function loadReview(id: string): Promise<NovaVodCorrectionView> {
  try {
    return await api.getNovaVodCorrection(id);
  } catch (err) {
    if (isNoTargetStream(err)) throw new Error(NO_TARGET_STREAM);
    throw err;
  }
}

const NO_FIELDS: ReadonlySet<string> = new Set();

/**
 * What the page has to say about its view, beyond the review itself: the list changed under the review (`stale`, until
 * a reload brings the new one), or an apply's changes reached the catalog but the submission was not marked reviewed
 * (`recovery`). The recovery's approval writes the note the worker recorded with that apply; `note`, the one this page's
 * own apply would have written (it answered 502), is only what the worker falls back on when it finds no such record.
 * The recovery of an apply this page did not send (refused as `already_applied`, or a view that opens on one) has none.
 */
type Outcome = { view: NovaVodCorrectionView; kind: 'stale' } | { view: NovaVodCorrectionView; kind: 'recovery'; note?: string };

/**
 * How many performances a refusal lists: `performances` (`would_publish_hidden`, `would_publish_endless`) or
 * `performanceIds` (`would_unpublish`).
 */
function listedCount(error: ApiError, key: 'performances' | 'performanceIds'): number {
  const listed = error.payload?.[key];
  return Array.isArray(listed) ? listed.length : 0;
}

/** The first problem an `invalid_operations` refusal names, else the refusal's own message. */
function firstDetail(error: ApiError): string {
  const details = error.payload?.details;
  return Array.isArray(details) && typeof details[0] === 'string' ? details[0] : error.message;
}

/**
 * The review's requests and what their answers do. An apply that lands, a rejection and the approval that applies
 * nothing toast, refresh the sidebar's count and go back to the list. An apply refused as `stale`, or one that reached
 * the catalog and failed after it (502 `appliedToCatalog`), leaves an outcome for the page to show. So does an apply or
 * a rejection refused as `already_applied`: another apply's changes reached the catalog and the submission was never
 * marked reviewed, so only the recovery may follow, as it may on a view that opens on such an apply (`openApply`). When
 * the submission was reviewed meanwhile, an apply is refused as `not_pending`, or answers `status_changed` with
 * `appliedToCatalog` when another review landed while its changes reached the catalog, and the rejection and the
 * approval, which carry the `pending` the page shows, are refused as `status_changed`. Each says so and asks for the
 * review again (`reload`), which then reads as reviewed. An apply refused as `no_target_stream` (the stream went away)
 * says so in words and asks for the review again too. The other refusals are error toasts, the first detail of an
 * `invalid_operations` one included, and the count of performances a `would_publish_hidden`, `would_unpublish` or
 * `would_publish_endless` one names (on a stream that is not public, an apply may neither put rows on the site nor
 * take any off it; on a public one, it may not publish an approved row with no end, which stops the VOD export).
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
        // The note the apply would have written. The recovery's approval writes the note the worker recorded with the
        // apply; this one only when the worker finds no record of it.
        setOutcome({ view, kind: 'recovery', note: [note.trim(), summarizeCorrection(operations, skipped)].filter(Boolean).join('\n') });
      } else if (isAlreadyApplied(err)) {
        // Another apply's changes are in, not this draft's: its recovery sends no note of this page's.
        setOutcome({ view, kind: 'recovery' });
      } else if (isNoTargetStream(err)) {
        toast.error(NO_TARGET_STREAM);
        reload();
      } else if (err instanceof ApiError && err.status === 409 && err.message === 'would_publish_hidden') {
        toast.error(`${APPLY_FAILED}：會讓 ${listedCount(err, 'performances')} 場演出跟著公開`, { detail: '這些演出所在的 stream 還沒公開，套用卻會讓它們出現在網站上。請先處理這些演出。' });
      } else if (err instanceof ApiError && err.status === 409 && err.message === 'would_publish_endless') {
        toast.error(`${APPLY_FAILED}：會讓 ${listedCount(err, 'performances')} 場沒有結束時間的演出公開`, { detail: '這些演出已核准但沒有結束時間，套用會讓它們出現在網站上，VOD 匯出會因此停擺。請先替它們補上結束時間。' });
      } else if (err instanceof ApiError && err.status === 409 && err.message === 'would_unpublish') {
        toast.error(`套用會讓 ${listedCount(err, 'performanceIds')} 場演出從網站上消失`, { detail: '這些演出的 stream 還沒公開，改連到待審的歌會讓它們下架。請改連到已通過的歌。' });
      } else if (err instanceof ApiError && err.status === 409 && err.message === 'not_pending') {
        toast.error(ALREADY_REVIEWED);
        reload();
      } else if (isStatusChanged(err) && err.payload?.appliedToCatalog === true) {
        toast.error(ALREADY_REVIEWED, { detail: APPLIED_BUT_REVIEWED_ELSEWHERE });
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

  // The page offers its actions on a pending submission only, so its status changes carry `pending`.
  const reject = async () => {
    setBusy('reject');
    try {
      await api.updateNovaVodStatus(id, { status: 'rejected', expected_status: 'pending', reviewer_note: note });
      toast.success('修正已退回', view.submission.stream_title || view.submission.video_id);
      landed();
    } catch (err) {
      if (isStatusChanged(err)) {
        toast.error(ALREADY_REVIEWED);
        reload();
      } else if (isAlreadyApplied(err)) {
        setOutcome({ view, kind: 'recovery' });
      } else {
        toast.error('無法退回修正', { detail: errorMessage(err, '') });
      }
    } finally {
      setBusy(null);
    }
  };

  // A view that opens on an apply which reached the catalog (a reload, a reopen, another curator's) starts in recovery.
  // One without the field (a worker that predates it) has none.
  const opensInRecovery: Outcome | null = view.openApply ? { view, kind: 'recovery' } : null;
  const current = outcome !== null && outcome.view === view ? outcome : opensInRecovery;

  // 「直接通過（不套用）」 after an apply that reached the catalog: it asks to mark the submission approved, and toasts itself.
  const recover = async () => {
    if (current?.kind !== 'recovery') return;
    setBusy('recover');
    try {
      if ((await approveWithoutApplying(id, 'pending', MARK_APPLIED_APPROVED, current.note)) !== null) landed();
    } catch (err) {
      if (isStatusChanged(err)) {
        toast.error(ALREADY_REVIEWED);
        reload();
      } else if (isNoTargetStream(err)) toast.error(NO_TARGET_STREAM);
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
 * from its own initial draft, guarded (`guardedInitialDraft`), and with it what the guard held back and why, which the
 * rows show for as long as the view lasts; the reviewer note is the curator's and stays. 套用 waits while a time field
 * holds text that does not read (`TimeFieldReport`), and while the draft cannot be applied (`canApply`).
 */
function ReviewWorkspace({ view, reloading, onReload }: { view: NovaVodCorrectionView; reloading: boolean; onReload: () => void }) {
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const fresh = useMemo(() => guardedInitialDraft(view), [view]);
  const [edited, setEdited] = useState<{ view: NovaVodCorrectionView; draft: CorrectionDraft } | null>(null);
  const draft = edited !== null && edited.view === view ? edited.draft : fresh.draft;
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
  // Worked out once per draft: the footer's counts, and each row's marks.
  const { appliedCount, skippedCount, needsEndCount, canApply } = useMemo(() => draftOperations(draft, view), [draft, view]);
  const flags = useMemo(() => draftFlags(draft, view), [draft, view]);
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
          <span className="text-meta text-fg-muted">依歌名與時間自動配對</span>
        </div>
        <TimeFieldReport.Provider value={reportTime}>
          <CorrectionRows
            view={view}
            draft={draft}
            guard={fresh.guard}
            flags={flags}
            onDraft={(next) => setEdited({ view, draft: next })}
            onSeek={seek}
          />
        </TimeFieldReport.Provider>
        <ReviewFooter
          appliedCount={appliedCount}
          skippedCount={skippedCount}
          needsEndCount={needsEndCount}
          canApply={canApply}
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
        {/* A load that failed leaves the last review behind, stale: 套用 would only meet the same refusal again. */}
        {view !== null && view.submission.status === 'pending' && correction.error === null ? (
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

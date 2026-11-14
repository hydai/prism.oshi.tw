import { useState, type RefObject } from 'react';
import type { NovaStatus, NovaVodListItem, NovaVodSubmission } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { useInboxCounts } from '../components/shell/InboxCounts';
import { useConfirm } from '../components/ui/confirm';
import { useToast } from '../components/ui/toast';
import { errorMessage, type ApiResource } from '../lib/apiResource';
import { removeById } from '../lib/status-totals';
import { MARK_APPLIED_APPROVED, useApproveWithoutApplying } from './useApproveWithoutApplying';
import type { RowDrafts } from './useRowDrafts';

/** What a VOD's request is out for: the status it is heading for, its approval without applying anything, or its deletion. */
export type VodAction = NovaStatus | 'approveWithoutApplying' | 'delete';

/** Where the focus goes once a landed request's answer is on screen, if nothing else has it by then. */
export type Handoff = { kind: 'row'; id: string; slug: string } | { kind: 'next'; next: HTMLElement | null };

/** The VODs with a request out, each with what it is out for. */
const NO_ACTIONS: ReadonlyMap<string, VodAction> = new Map();

const STATUS_TOASTS: Record<NovaStatus, string> = {
  approved: 'VOD approved',
  rejected: 'VOD rejected',
  pending: 'VOD reverted to pending',
};

/**
 * What the curator reads when an Approve is refused because the VOD's video has a stream the list did not know of: the
 * review applies what the submission changes, and 直接通過（不套用） approves one that changes nothing.
 */
const STREAM_EXISTS_TOAST = '這支影片已有 stream，請改用「審核修正」；沒有要套用的變更就按「直接通過（不套用）」';

/**
 * What the curator reads when a Reject is refused because an apply of the correction reached the catalog and the
 * submission was never marked reviewed: only 直接通過（不套用） on its review page completes it.
 */
const ALREADY_APPLIED_TOAST = '這份修正已套用到歌單，請到「審核修正」按「直接通過（不套用）」完成';

/** What the curator reads when 「直接通過（不套用）」 is refused because the VOD's video has lost the stream the list showed. */
const NO_STREAM_TOAST = '找不到對應的 stream，列表已重新載入';

/** What the curator reads when a status change is refused because the VOD's status is no longer the one the row showed. */
const STATUS_CHANGED_TOAST = '這份投稿的狀態已經變了，已重新載入';

/** The VOD as a row names it for assistive technology, a toast and a confirm: its title, or its video id when it has none. */
export function vodLabel(vod: NovaVodSubmission): string {
  return vod.stream_title || vod.video_id;
}

/**
 * The list with the worker's answer to a review laid over its row. An answer is the submission alone. It has no
 * `target_stream` (only the list says which stream a video has), so the row keeps the one it was listed with. Nor has
 * it an `open_apply`, but the row does not keep that one: an answer that lands has closed the apply's record (the
 * approval that recovers it, or a Revert, which closes every record) or found none. Kept, the flag would mark the
 * pending row that a Revert brings back, and its next 直接通過（不套用） would be worded as the recovery of an apply
 * that is gone.
 */
function withAnswer(rows: NovaVodListItem[], answer: NovaVodSubmission): NovaVodListItem[] {
  return rows.map((row) => (row.id === answer.id ? { ...row, ...answer, open_apply: false } : row));
}

/**
 * Whether the list must be loaded again once `answer` lands on a row shown `shown` and listed with `listed`. The row
 * keeps the stream it was listed with (withAnswer), which an Approve of a VOD whose video had no stream made stale:
 * that approval imported one. So once such a VOD's Revert lands, only a reload makes the pending row offer what the
 * worker takes for a video with a stream (審核修正, 直接通過（不套用）), not Approve.
 */
function needsItsStream(shown: NovaStatus, listed: NovaVodListItem['target_stream'], answer: NovaVodSubmission): boolean {
  return answer.status === 'pending' && shown === 'approved' && listed === null;
}

/**
 * What a refused review of a VOD says, and whether the list reloads first. Three refusals mean that the list the page
 * holds is out of date about the VOD, not that the request was wrong: a status change of a VOD whose status is no
 * longer the one the row shows (409 status_changed: it was reviewed in another tab, or by another curator; the one such
 * change the worker takes is an Approve on Pending of a VOD approved with no stream, the retry of an import that failed),
 * an Approve of a VOD whose video has a stream now (409 use_correction_review: the approval of another submission of
 * the video imported one after the list was loaded), and 「直接通過（不套用）」 of a VOD whose video has none now (404
 * no_target_stream: the stream was removed). Reloading lists the row as the worker has it, so it offers what the
 * worker will take. A Reject of a correction whose apply reached the catalog while its submission was never marked
 * reviewed (409 already_applied) says where to finish it, and reloads too. Any other refusal is the worker's own message.
 */
function refusalOf(err: unknown): { message: string; reload: boolean } {
  if (err instanceof ApiError && err.status === 409 && err.message === 'status_changed') {
    return { message: STATUS_CHANGED_TOAST, reload: true };
  }
  if (err instanceof ApiError && err.status === 409 && err.message === 'use_correction_review') {
    return { message: STREAM_EXISTS_TOAST, reload: true };
  }
  if (err instanceof ApiError && err.status === 409 && err.message === 'already_applied') {
    return { message: ALREADY_APPLIED_TOAST, reload: true };
  }
  if (err instanceof ApiError && err.status === 404 && err.message === 'no_target_stream') {
    return { message: NO_STREAM_TOAST, reload: true };
  }
  return { message: errorMessage(err, 'Action failed'), reload: false };
}

/** What the Nova VODs page hands its actions: the state and the elements they act on, which stay the page's. */
interface VodActionsPage {
  /** The page's list: a landed request lays its answer over a row, takes the row out, or asks for the list again. */
  list: Pick<ApiResource<NovaVodListItem[]>, 'mutate' | 'reload'>;
  /** Where the focus goes once a request's answer is on screen: set here, read by the page's layout effect. */
  handoffRef: RefObject<Handoff | null>;
  /** The element that holds the rows: a delete reads the next row's name button from it while its own is on screen. */
  listRef: RefObject<HTMLElement | null>;
  /** The page's store of rejection notes, used up by a review that lands and by a delete. */
  rejectNotes: RowDrafts;
  /** Keeps a VOD just reviewed in the list until a filter changes, so that it does not vanish under the cursor. */
  keepVisible: (id: string) => void;
  /** The name button of the row after the one for `id` under `root`, or null when it is the last. */
  nextNameButton: (root: HTMLElement | null, id: string) => HTMLElement | null;
}

/**
 * The Nova VODs page's requests: a review (Approve, Reject, Revert), 「直接通過（不套用）」 and a delete, each with the toast
 * that says how it went, the list's answer to it and the focus it hands on. `acting` is what each VOD's request is out
 * for; it lives here, not in the row, which can unmount meanwhile. A handler resolves true once the row may clear the
 * rejection note it just submitted (a delete, which asks first, resolves nothing).
 */
export function useNovaVodActions({ list, handoffRef, listRef, rejectNotes, keepVisible, nextNameButton }: VodActionsPage) {
  const toast = useToast();
  const confirm = useConfirm();
  const approveWithoutApplying = useApproveWithoutApplying();
  // The sidebar's pending badge loads this list separately: every change here reloads it too.
  const { refresh: refreshInboxCounts } = useInboxCounts();
  const [acting, setActing] = useState(NO_ACTIONS);

  /** Records what a VOD's request is out for, or (null) that it is done. Kept here, not in the row, which can unmount meanwhile. */
  const markActing = (id: string, action: VodAction | null) =>
    setActing((current) => {
      const next = new Map(current);
      if (action === null) next.delete(id);
      else next.set(id, action);
      return next;
    });

  /** A review that has landed: the row takes the worker's answer and stays in view, and its rejection note is used up. */
  const landReview = (id: string, answer: NovaVodSubmission, reloads = false) => {
    // Before the state changes that will show it: the page's layout effect reads the flag in the commit they land in.
    handoffRef.current = { kind: 'row', id, slug: answer.streamer_slug };
    list.mutate((rows) => withAnswer(rows, answer));
    if (reloads) list.reload();
    refreshInboxCounts('vods');
    keepVisible(id);
    rejectNotes.clear(id);
  };

  /**
   * Resolves true once the row may clear the note it just submitted. It carries the status the row shows (`shown`, a
   * review's answer laid over the row included), which the worker refuses once the VOD no longer has it, but for an
   * Approve that retries a failed import (see refusalOf).
   */
  const handleAction = async ({ id, status: shown, target_stream: listed }: NovaVodListItem, status: NovaStatus, rejectNote: string): Promise<boolean> => {
    markActing(id, status);
    try {
      const updated = await api.updateNovaVodStatus(id, {
        status,
        expected_status: shown,
        reviewer_note: status === 'rejected' ? rejectNote : undefined,
      });
      landReview(id, updated, needsItsStream(shown, listed, updated));
      toast.success(STATUS_TOASTS[status], vodLabel(updated));
      return true;
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal.reload) list.reload();
      toast.error(refusal.message);
      return false;
    } finally {
      markActing(id, null);
    }
  };

  /**
   * 「直接通過（不套用）」, which asks first and says how it went (the hook's toast), carrying the status the row shows.
   * On a row whose apply reached the catalog (`open_apply`) it is the approval that recovers that apply (the worker writes
   * the note recorded with it and announces it), so it asks, and toasts, in MARK_APPLIED_APPROVED's words: not that nothing
   * is applied.
   * Resolves true once the row may clear its note; false when the curator cancelled (nothing was sent) or the worker refused.
   */
  const handleApproveWithoutApplying = async ({ id, status: shown, open_apply: landed }: NovaVodListItem): Promise<boolean> => {
    markActing(id, 'approveWithoutApplying');
    try {
      const updated = await approveWithoutApplying(id, shown, landed ? MARK_APPLIED_APPROVED : undefined);
      if (updated === null) return false;
      landReview(id, updated);
      return true;
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal.reload) list.reload();
      toast.error(refusal.message);
      return false;
    } finally {
      markActing(id, null);
    }
  };

  const handleDelete = async (vod: NovaVodSubmission) => {
    const confirmed = await confirm({
      title: 'Delete this VOD submission?',
      body: `Permanently delete VOD submission "${vod.id}" (${vodLabel(vod)}). This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    markActing(vod.id, 'delete');
    try {
      await api.deleteNovaVod(vod.id);
      // The next row is read while this one is still on screen: its button is the same element after the commit.
      handoffRef.current = { kind: 'next', next: nextNameButton(listRef.current, vod.id) };
      list.mutate((rows) => removeById(rows, vod.id));
      refreshInboxCounts('vods');
      rejectNotes.clear(vod.id);
      toast.success('VOD deleted', vodLabel(vod));
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      markActing(vod.id, null);
    }
  };

  return { acting, handleAction, handleApproveWithoutApplying, handleDelete };
}

import { useCallback } from 'react';
import type { NovaStatus, NovaVodSubmission } from '../../../shared/types';
import { api } from '../api/client';
import { useConfirm } from '../components/ui/confirm';
import { useToast } from '../components/ui/toast';

/** What an approval without applying says: its confirm (title, body, the button that approves) and its toast. */
interface ApprovalCopy {
  title: string;
  body: string;
  confirmLabel: string;
  success: string;
}

/** The approval of a VOD whose changes are not applied, and never will be by it: the list's 「直接通過（不套用）」. */
const APPROVE_AS_IS: ApprovalCopy = {
  title: '直接通過，不套用任何變更？',
  body: '這支影片已有 stream，直接通過不會套用任何變更。',
  confirmLabel: '直接通過',
  success: '已通過（未套用變更）',
};

/**
 * The approval that recovers an apply which reached the catalog but not the submission: the changes are in, so it
 * only marks the submission approved (the worker then tells the contributor), and never says that nothing is applied.
 * The review page's recovery asks in these words, and so does the list's 「直接通過（不套用）」 on a row whose apply is open.
 */
export const MARK_APPLIED_APPROVED: ApprovalCopy = {
  title: '把這份投稿標記為已通過？',
  body: '變更已經寫入歌單。這一步只會把投稿標記為已通過並通知投稿者，不會再套用一次。',
  confirmLabel: '標記為已通過',
  success: '已通過（變更先前已套用）',
};

/**
 * 「直接通過（不套用）」: approves a Nova VOD whose video already has a stream, applying nothing to it. The
 * worker refuses every other approval of such a VOD (`use_correction_review`), because the plain approval would
 * import nothing and drop the submission's changes without a word. This is for the curator who means exactly
 * that: re-approving after a Revert, or marking approved a correction whose apply reached the catalog but not the
 * submission. So it asks first, in the words of `copy`, which each call chooses: by default, that nothing is
 * applied. A caller whose changes are in already (the review page's recovery, a list row whose apply is open) says
 * so instead, with MARK_APPLIED_APPROVED.
 *
 * The returned function resolves with the approved submission once the worker has answered (the success toast is
 * raised here), or with `null` when the curator cancels the confirm: nothing was sent. A request the worker
 * refuses rejects, for the caller to report the way it reports its other failed actions; that includes a VOD
 * whose status is no longer `expectedStatus`, the status the caller's page shows (409 `status_changed`).
 * `reviewerNote`, when there is one, goes with the approval. When the worker finds a record of an apply of the
 * submission that was never announced, it writes the note recorded with that apply instead, and announces it:
 * the note sent here is the one it falls back on when it finds none. Nothing here knows the page it is used on.
 */
export function useApproveWithoutApplying(): (
  id: string,
  expectedStatus: NovaStatus,
  copy?: ApprovalCopy,
  reviewerNote?: string,
) => Promise<NovaVodSubmission | null> {
  const confirm = useConfirm();
  const toast = useToast();

  return useCallback(
    async (id, expectedStatus, copy = APPROVE_AS_IS, reviewerNote) => {
      const confirmed = await confirm({ title: copy.title, body: copy.body, confirmLabel: copy.confirmLabel });
      if (!confirmed) return null;
      const updated = await api.updateNovaVodStatus(id, {
        status: 'approved',
        without_applying: true,
        expected_status: expectedStatus,
        ...(reviewerNote ? { reviewer_note: reviewerNote } : {}),
      });
      toast.success(copy.success);
      return updated;
    },
    [confirm, toast],
  );
}

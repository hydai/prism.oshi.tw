import { useCallback } from 'react';
import type { NovaVodSubmission } from '../../../shared/types';
import { api } from '../api/client';
import { useConfirm } from '../components/ui/confirm';
import { useToast } from '../components/ui/toast';

/**
 * 「直接通過（不套用）」: approves a Nova VOD whose video already has a stream, applying nothing to it. The
 * worker refuses every other approval of such a VOD (`use_correction_review`), because the plain approval would
 * import nothing and drop the submission's changes without a word. This is for the curator who means exactly
 * that: re-approving after a Revert, or approving a correction whose apply reached the catalog but not the
 * submission. So it asks first, and says that nothing is applied.
 *
 * The returned function resolves with the approved submission once the worker has answered (the success toast is
 * raised here), or with `null` when the curator cancels the confirm: nothing was sent. A request the worker
 * refuses rejects, for the caller to report the way it reports its other failed actions. `reviewerNote`, when
 * there is one, goes with the approval. Nothing here knows the page it is used on.
 */
export function useApproveWithoutApplying(): (id: string, reviewerNote?: string) => Promise<NovaVodSubmission | null> {
  const confirm = useConfirm();
  const toast = useToast();

  return useCallback(
    async (id, reviewerNote) => {
      const confirmed = await confirm({
        title: '直接通過，不套用任何變更？',
        body: '這支影片已有 stream，直接通過不會套用任何變更。',
        confirmLabel: '直接通過',
      });
      if (!confirmed) return null;
      const updated = await api.updateNovaVodStatus(id, {
        status: 'approved',
        without_applying: true,
        ...(reviewerNote ? { reviewer_note: reviewerNote } : {}),
      });
      toast.success('已通過（未套用變更）');
      return updated;
    },
    [confirm, toast],
  );
}

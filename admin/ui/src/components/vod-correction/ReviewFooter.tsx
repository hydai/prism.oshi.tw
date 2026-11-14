import { useId, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Fields';
import { MICRO_LABEL } from '../ui/micro-label';

/** What a review request is out for: the apply, the rejection, or the approval that applies nothing. */
export type ReviewAction = 'apply' | 'reject' | 'recover';

/**
 * The foot of the review: what the page has to say about the last apply (`children`), the reviewer note, the counts
 * of ticked and unticked items, 「退回」 and 「套用 {a} 項」. The apply is disabled while there is nothing to apply
 * (the worker refuses an empty one). While a request is out its button is busy and keeps the focus, and the other is
 * unavailable; `applyBlocked` and `rejectBlocked` hold a button back for what `children` says.
 *
 * The apply is also held while the draft cannot be sent (`canApply`, the draft's own verdict), with the reason beside
 * it as its description: rows the apply still refuses without an end (`needsEndCount`). A press of it still
 * moves the focus, so an end just typed is committed before the click lands, and the click applies.
 *
 * `timesUnreadable` (a time field holds text that does not read) holds the apply back too, and a press of it then
 * leaves the focus where it is. Moving the focus would leave that field, which drops the text and so the hold, before
 * the click arrives: the click would apply.
 */
export function ReviewFooter({
  appliedCount,
  skippedCount,
  needsEndCount,
  canApply,
  note,
  onNoteChange,
  busy,
  applyBlocked,
  rejectBlocked,
  timesUnreadable,
  onApply,
  onReject,
  children,
}: {
  appliedCount: number;
  skippedCount: number;
  needsEndCount: number;
  canApply: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  busy: ReviewAction | null;
  applyBlocked: boolean;
  rejectBlocked: boolean;
  timesUnreadable: boolean;
  onApply: () => void;
  onReject: () => void;
  children?: ReactNode;
}) {
  const noteId = useId();
  const reasonId = useId();
  const reason = needsEndCount > 0 ? `還有 ${needsEndCount} 列需要結束時間` : null;
  return (
    <div className="flex flex-col gap-2.5 border-t border-line-soft px-1.5 pt-3">
      {children}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className={MICRO_LABEL}>
          Reviewer Note (optional, shown on reject)
        </label>
        <Textarea id={noteId} value={note} onChange={(event) => onNoteChange(event.target.value)} rows={2} className="block resize-y" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-token-sm text-fg-muted">{`已勾選 ${appliedCount} 項 · 未勾 ${skippedCount} 項`}</p>
        <span className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {reason === null ? null : (
            <span id={reasonId} className="text-token-sm font-semibold text-tone-danger-fg">
              {reason}
            </span>
          )}
          <Button
            icon="x"
            busy={busy === 'reject'}
            aria-disabled={rejectBlocked || (busy !== null && busy !== 'reject') ? true : undefined}
            onClick={onReject}
          >
            退回
          </Button>
          <Button
            variant="primary"
            icon="check"
            busy={busy === 'apply'}
            disabled={appliedCount === 0}
            aria-disabled={!canApply || applyBlocked || timesUnreadable || (busy !== null && busy !== 'apply') ? true : undefined}
            aria-describedby={reason === null ? undefined : reasonId}
            onMouseDown={(event) => {
              if (timesUnreadable) event.preventDefault();
            }}
            onClick={onApply}
          >
            {`套用 ${appliedCount} 項`}
          </Button>
        </span>
      </div>
    </div>
  );
}

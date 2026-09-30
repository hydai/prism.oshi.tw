import { Button } from './ui/Button';

/**
 * Footer for the server-paged lists: which rows are on screen, which page they
 * are, and the two steps either way. An unpaged list (`totalPages` 0) renders
 * nothing, so callers don't repeat that guard.
 *
 * A step at the end of the range is `aria-disabled`, not `disabled`: the press
 * that reaches the last (or first) page is what makes its button unavailable,
 * and a browser drops the keyboard focus from a button that turns disabled.
 * The kit Button ignores activation while it is `aria-disabled`, so the step
 * still does nothing there. `disabled` (the prop) is a lock a caller puts on
 * both steps, and stays the attribute.
 */
export function Pagination({
  page,
  totalPages,
  total,
  shown,
  onPrev,
  onNext,
  disabled = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  /** 1-based, inclusive index range of the rows currently rendered. */
  shown: { start: number; end: number };
  onPrev: () => void;
  onNext: () => void;
  /** Both steps are unavailable while the page is mid-action (e.g. a merge). */
  disabled?: boolean;
}) {
  if (totalPages <= 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-token-sm text-fg-muted">
      <span>Showing {shown.start}–{shown.end} of {total}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onPrev} disabled={disabled} aria-disabled={page <= 1 || undefined}>
          Previous
        </Button>
        <span>Page {page} of {totalPages}</span>
        <Button size="sm" onClick={onNext} disabled={disabled} aria-disabled={page >= totalPages || undefined}>
          Next
        </Button>
      </div>
    </div>
  );
}

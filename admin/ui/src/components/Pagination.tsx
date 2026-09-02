const BUTTON_CLASS =
  'rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Footer for the server-paged lists: which rows are on screen, which page they
 * are, and the two steps either way. An unpaged list (`totalPages` 0) renders
 * nothing, so callers don't repeat that guard.
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
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>Showing {shown.start}–{shown.end} of {total}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onPrev} disabled={disabled || page <= 1} className={BUTTON_CLASS}>
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button type="button" onClick={onNext} disabled={disabled || page >= totalPages} className={BUTTON_CLASS}>
          Next
        </button>
      </div>
    </div>
  );
}

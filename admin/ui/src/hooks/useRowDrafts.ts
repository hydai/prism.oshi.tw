import { useRef } from 'react';

/**
 * The text a curator is part-way through typing into one row — a rejection note,
 * a reply.
 *
 * It belongs to the row (one keystroke must re-render that row and nothing else),
 * but it has to outlive the row's mount: rows unmount when a streamer group
 * collapses, when the view mode switches, when a filter or search moves the row
 * out of the table, and while a reload shows the loading state. So the text lives
 * in this page-level store, which rows seed their local state from on mount and
 * write through to on change; the page drops an id once an action has consumed
 * the draft, or the row is gone for good.
 */
export interface RowDrafts {
  /** The draft held for this row, or `''` when there is none. */
  read(id: string): string;
  write(id: string, draft: string): void;
  /** Forget this row's draft: its action landed, or its row was deleted. */
  clear(id: string): void;
}

/** Plain store, so it can be seeded and inspected without React. */
export function createRowDrafts(): RowDrafts {
  const drafts = new Map<string, string>();
  return {
    read: (id) => drafts.get(id) ?? '',
    write: (id, draft) => {
      // An emptied editor holds nothing worth restoring.
      if (draft === '') drafts.delete(id);
      else drafts.set(id, draft);
    },
    clear: (id) => {
      drafts.delete(id);
    },
  };
}

/** A ref, not state: writing a draft must never re-render the page around the row. */
export function useRowDrafts(): RowDrafts {
  const drafts = useRef<RowDrafts | null>(null);
  drafts.current ??= createRowDrafts();
  return drafts.current;
}

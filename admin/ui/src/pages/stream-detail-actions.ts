import type { Status } from '../../../shared/types';
import type { IconName } from '../components/ui/Icon';
import { statusTone, TONE_TEXT_CLASS } from '../components/ui/pill-core';

/** One status change Stream Detail's header offers: the words on the control and the status it sets. */
interface StreamStatusAction {
  label: string;
  status: Status;
}

/**
 * What Stream Detail's header offers a curator for a stream in `status` (spec §8.3): one primary
 * action on its own button, the rest in the ⋯ menu, and whether Delete stream follows them there.
 * Only the changes the worker accepts from `status` are offered (`ALLOWED_TRANSITIONS` in
 * admin/src/status.ts), since any other answers 400. An approved stream is never offered Delete
 * stream either: the worker refuses to hard-delete one, so it has to be unapproved first.
 */
export function streamStatusActions(status: Status): {
  primary: StreamStatusAction | null;
  menu: StreamStatusAction[];
  canDelete: boolean;
} {
  switch (status) {
    case 'pending':
    case 'extracted':
      return {
        primary: { label: 'Approve stream', status: 'approved' },
        menu: [
          { label: 'Reject', status: 'rejected' },
          { label: 'Exclude', status: 'excluded' },
        ],
        canDelete: true,
      };
    case 'rejected':
      // Back to pending first: the worker refuses rejected → approved. Once pending, the header
      // offers Approve stream as usual.
      return {
        primary: { label: 'Restore', status: 'pending' },
        menu: [{ label: 'Exclude', status: 'excluded' }],
        canDelete: true,
      };
    case 'approved':
      // Unapprove is all: the worker refuses approved → excluded, as it refuses the delete.
      return {
        primary: { label: 'Unapprove', status: 'pending' },
        menu: [],
        canDelete: false,
      };
    case 'excluded':
      return {
        primary: { label: 'Restore', status: 'pending' },
        menu: [],
        canDelete: true,
      };
    default:
      // Every `Status` has its case above: a new one fails to compile here until it gets its own.
      status satisfies never;
      // A status this build does not know yet (the server moved on first): offer nothing, rather
      // than guess which change — or which delete — would be safe.
      return { primary: null, menu: [], canDelete: false };
  }
}

/** One status change a performance row's own action button offers: its words, the status it sets and its icon. */
interface PerformanceStatusAction {
  label: string;
  status: Status;
  icon: IconName;
}

/**
 * The one action a performance row's own button offers for a performance in `status` (spec §8.3),
 * derived from the very same worker transitions `streamStatusActions` reads (`ALLOWED_TRANSITIONS`
 * in admin/src/status.ts): pending and extracted approve; approved unapproves; rejected and
 * excluded restore to pending — the header's own word for that change. A status this build does
 * not know yet offers nothing, rather than guess.
 */
export function performanceStatusAction(status: Status): PerformanceStatusAction | null {
  switch (status) {
    case 'pending':
    case 'extracted':
      return { label: 'Approve performance', status: 'approved', icon: 'check' };
    case 'approved':
      return { label: 'Unapprove performance', status: 'pending', icon: 'undo' };
    case 'rejected':
    case 'excluded':
      return { label: 'Restore performance', status: 'pending', icon: 'undo' };
    default:
      // Every `Status` has its case above: a new one fails to compile here until it gets its own.
      status satisfies never;
      return null;
  }
}

/**
 * The review-state cell's mark for a performance in `status` (spec §8.3). Approved and pending
 * draw their own mark inline in the row (a check, a hollow ring) — only their accessible word is
 * here. The rest get a small icon, toned like `StatusPill` shows the same status (`statusTone`,
 * `ui/pill-core.ts` — the one place status → tone is decided, so this can never drift from the
 * pill). A status this build does not know yet reads as still pending, rather than guess.
 */
export function performanceReviewMark(status: Status):
  | { kind: 'approved'; word: string }
  | { kind: 'pending'; word: string }
  | { kind: 'other'; icon: IconName; word: string; className: string } {
  switch (status) {
    case 'approved':
      return { kind: 'approved', word: 'Approved' };
    case 'pending':
      return { kind: 'pending', word: 'Pending review' };
    case 'extracted':
      return { kind: 'other', icon: 'workflow', word: 'Extracted', className: TONE_TEXT_CLASS[statusTone(status)] };
    case 'rejected':
      return { kind: 'other', icon: 'x', word: 'Rejected', className: TONE_TEXT_CLASS[statusTone(status)] };
    case 'excluded':
      return { kind: 'other', icon: 'minus', word: 'Excluded', className: TONE_TEXT_CLASS[statusTone(status)] };
    default:
      status satisfies never;
      return { kind: 'pending', word: 'Pending review' };
  }
}

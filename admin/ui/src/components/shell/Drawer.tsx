import { useEffect, useEffectEvent, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { isImeKeyDown } from '../ui/keyboard';

/** What Tab can reach; `closest('[hidden]')` below also drops the contents of a closed popover. */
const TABBABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Wraps Tab around the ends of `sheet`, and pulls a focus that is outside it back in. */
function keepTabInside(sheet: HTMLElement, event: KeyboardEvent): void {
  const tabbables = Array.from(sheet.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) => element.closest('[hidden]') === null,
  );
  const first = tabbables[0];
  const last = tabbables[tabbables.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    sheet.focus();
    return;
  }

  const active = sheet.ownerDocument.activeElement;
  const inside = active !== null && active !== sheet && sheet.contains(active);
  if (event.shiftKey ? !inside || active === first : !inside || active === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/**
 * The narrow-screen navigation: a 272 px modal sheet (`children`, mounted only while open) over a
 * scrim, above the page's sticky header (z-20) and bulk bar (z-30). Opening moves focus into the
 * sheet; while open Tab cycles inside it and the root carries `data-overlay-open`, so the editor
 * shortcut guard stays quiet behind it. Escape and a scrim click ask the owner to close
 * (`onClose`) — an Escape something inside already handled (an open popover), or one that belongs
 * to an IME composition, is left alone — and closing hands focus back to `returnFocusRef`. The sheet
 * is its popovers' placement boundary (`data-popover-boundary`, read by `ui/popover-position.ts`): an
 * open panel is placed inside it, 12 px from its edges like its cards, not over the scrim, as far as
 * the panel's 240 px minimum width allows in a sheet narrowed below 264 px.
 * The sheet is `glass-pop`, not the sidebar's lighter glass: it lies over page content (the black
 * player, say) rather than the canvas, and its labels must stay legible there.
 */
export function Drawer({
  open,
  onClose,
  returnFocusRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const sheet = sheetRef.current;
    if (sheet === null || event.defaultPrevented || isImeKeyDown(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      keepTabInside(sheet, event);
    }
  });

  // On the document, not the sheet: a page behind the drawer that grabs focus must not strand
  // Escape or Tab outside it.
  useEffect(() => {
    if (!open) return undefined;
    const doc = rootRef.current?.ownerDocument ?? document;
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    doc.addEventListener('keydown', listener);
    return () => doc.removeEventListener('keydown', listener);
  }, [open]);

  // Layout effect: right after the mutation phase React re-focuses whatever had focus before the
  // commit, so moving focus any earlier would be undone.
  useLayoutEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      sheetRef.current?.focus();
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const root = rootRef.current;
    const doc = root?.ownerDocument ?? document;
    const active = doc.activeElement;
    // Focus that was in the drawer went with its content; focus the user moved elsewhere stays.
    if (active === null || active === doc.body || !active.isConnected || (root?.contains(active) ?? false)) {
      returnFocusRef.current?.focus();
    }
  }, [open, returnFocusRef]);

  return (
    <div ref={rootRef} id="app-drawer" hidden={!open} data-overlay-open={open ? '' : undefined}>
      {/* A pointer-only dismiss: the keyboard closes the drawer with Escape. */}
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim" onClick={onClose} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        data-popover-boundary=""
        className="glass-pop fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[calc(100%_-_3rem)] flex-col border-y-0 border-l-0 shadow-pop focus:outline-none focus-visible:shadow-pop"
      >
        {open ? children : null}
      </div>
    </div>
  );
}

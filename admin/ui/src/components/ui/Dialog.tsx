import {
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

type DialogSize = 'sm' | 'md' | 'lg';

/**
 * `sm` fits a confirm (the mockup's `.dlg`) and the Add Song form, `md` is the default, and `lg`
 * fits Paste Import's list preview. With the width class below, a phone keeps a 16 px gutter.
 */
const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

// No unconditional display utility: the UA's `dialog:not([open]) { display: none }` has to keep a
// closed dialog hidden, so the flex layout applies only while open (`open:flex`).
// R48: capped at 85% of the viewport height (85dvh behind a `supports-[height:100dvh]:` gate, since
// Tailwind sorts arbitrary-value utilities by their bracket content — "85dvh" before "85vh" — so two
// plain stacked classes would let the vh rule win the cascade even in a dvh-supporting browser; the
// `@supports` gate gives dvh the win there on its own terms, not on rule order) and laid out as a
// column so the body below can be the one flex item that scrolls — `overflow-hidden` keeps the
// <dialog> itself from ever becoming the scroller, so a press on a tall body's own scrollbar never
// lands on the <dialog> and reads as a backdrop click.
const DIALOG_CLASSES =
  'glass-pop m-auto open:flex w-[calc(100%_-_2rem)] max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] flex-col overflow-hidden rounded-[20px] text-fg shadow-pop backdrop:bg-scrim focus:outline-none';

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean' && node !== '';
}

/**
 * Focuses the element the owner named (`preferred`), or — with none named, or none left in the
 * document — the element that had focus before the dialog opened, if that is still in the document.
 */
function restoreFocus(
  openerRef: RefObject<HTMLElement | null>,
  preferred: RefObject<HTMLElement | null> | undefined,
): void {
  const opener = openerRef.current;
  openerRef.current = null;
  const named = preferred?.current;
  const target = named?.isConnected ? named : opener;
  if (target?.isConnected) target.focus();
}

/**
 * A modal on the native `<dialog>`: `showModal()` / `close()` follow `open`, so the browser supplies
 * the top layer and makes the page behind it inert. Escape (the `cancel` event) and — when
 * `dismissible` — a click on the backdrop ask the owner to close through `onClose`; the dialog stays
 * open until `open` turns false. Closing returns focus to the element focused before it opened, or
 * to `returnFocus.current` when the owner names another (the ref is read as the dialog closes; an
 * empty ref, or an element no longer in the page, leaves the opener to take the focus). An optional
 * `icon` sits above the title, outside the title and description that name the dialog. The header
 * and footer stay pinned; only the body (`children`) scrolls once the panel hits its height cap.
 */
export function Dialog({
  open,
  onClose,
  icon,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = 'md',
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  size?: DialogSize;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // True from `showModal()` until focus has been handed back: a dialog that never opened (mounted
  // closed, or unmounted closed) must not move focus, least of all to a named `returnFocus` target.
  const shownRef = useRef(false);
  const pressedBackdropRef = useRef(false);
  const requestClose = useEffectEvent(() => onClose());
  // An effect event, so `returnFocus` is read as the dialog closes and never sits in the open
  // effect's dependencies: a ref object made anew on every render would close and reopen the dialog.
  const giveFocusBack = useEffectEvent(() => {
    if (!shownRef.current) return;
    shownRef.current = false;
    restoreFocus(openerRef, returnFocus);
  });
  const described = hasContent(description);
  const hasChildren = hasContent(children);
  const hasFooter = hasContent(footer);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    if (!open) {
      // Just closed by the cleanup below, in this commit's mutation phase. Focus goes back from here, the
      // layout phase: right after the mutation phase React re-focuses whatever had focus before the
      // commit (a button still inside the dialog), which would undo a move made in the cleanup.
      giveFocusBack();
      return undefined;
    }

    // Taken in the commit that opens the dialog, not when an owner asked for it: a Menu item that asks
    // is hidden in this same commit, and its Popover has just handed focus back to the trigger.
    const doc = dialog.ownerDocument;
    const active = doc.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== doc.body ? active : null;
    shownRef.current = true;
    dialog.showModal();

    // Escape: the owner decides; the dialog stays open until `open` turns false.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    // Closed without React asking (a `<form method="dialog">`, a second Escape the browser no longer
    // lets us cancel): tell the owner, so `open` follows. A close event still queued from an earlier
    // close finds the dialog shown again and is ignored.
    const handleClose = () => {
      if (!dialog.open) requestClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      // Detached first, so the close React asks for below is never reported back as a request.
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  // Unmounted while open (an owner that renders the dialog only while it shows): no `open={false}`
  // commit will follow, so the unmount hands focus back — after the cleanup above has closed it. React's
  // post-mutation re-focus cannot undo this one: the element that had focus leaves with the dialog.
  useLayoutEffect(() => () => giveFocusBack(), []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDialogElement>) => {
    pressedBackdropRef.current = event.target === event.currentTarget;
  };

  // The header/body/footer sections between them cover the whole box, so only the ::backdrop (and, now
  // that the panel has a height cap, a scrollbar drawn on the body's own scroll container rather than
  // on the <dialog>) reports the <dialog> itself as the target. A press that began inside (a text
  // selection dragged out) is not a backdrop click.
  const handleClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    const pressedBackdrop = pressedBackdropRef.current;
    pressedBackdropRef.current = false;
    if (dismissible && pressedBackdrop && event.target === event.currentTarget) onClose();
  };

  return (
    // A ::backdrop click reaches the <dialog> (the pseudo-element has no node); keyboards dismiss with Escape.
    // react-doctor-disable-next-line react-doctor/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={described ? descriptionId : undefined}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`${DIALOG_CLASSES} ${SIZE_CLASSES[size]}`}
    >
      {/* Header: icon, title, description — pinned, never part of the scrolling body (R48). */}
      <div className={`shrink-0 px-[18px] pt-[18px]${hasChildren || hasFooter ? '' : ' pb-[18px]'}`}>
        {hasContent(icon) ? icon : null}
        <h2 id={titleId} className="text-[14.5px] font-[750] text-fg">
          {title}
        </h2>
        {described ? (
          <div id={descriptionId} className="mt-1 text-xs leading-normal text-fg-muted">
            {description}
          </div>
        ) : null}
      </div>
      {/* Body: the only section that scrolls once the panel hits its max-height (R48). */}
      {hasChildren ? (
        <div className={`min-h-0 flex-1 overflow-y-auto px-[18px] pt-3.5${hasFooter ? '' : ' pb-[18px]'}`}>
          {children}
        </div>
      ) : null}
      {/* Footer: pinned below the scrolling body, never inside it (R48). */}
      {hasFooter ? (
        <div className="shrink-0 flex flex-wrap justify-end gap-2 px-[18px] pb-[18px] pt-3.5">{footer}</div>
      ) : null}
    </dialog>
  );
}

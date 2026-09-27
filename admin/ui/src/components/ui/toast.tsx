import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ShowToast } from '../../hooks/useToast';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';

type ToastKind = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: ToastAction;
}

interface Timers {
  setTimeout: (run: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

interface ToastActions {
  success: (message: string, detail?: string) => void;
  error: (message: string, options?: { detail?: string; action?: ToastAction }) => void;
  info: (message: string, detail?: string) => void;
}

/** Bottom-centre stack keeps at most this many toasts; a new one past it drops one (see R25). */
const MAX_TOASTS = 3;
const OK_DURATION_MS = 4000;
const ERROR_DURATION_MS = 8000;

// The real clock, wrapped to the shape `ToastProvider` takes so tests can inject a fake one.
// Every timer is armed in the call that shows the toast (never in an effect), through this.
const DEFAULT_TIMERS: Timers = {
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

// One stable object for every call outside a provider. Kept module-private, not exported: a .tsx
// that exports components must export no other runtime value (react-doctor only-export-components).
const NOOP_ACTIONS: ToastActions = {
  success: () => {},
  error: () => {},
  info: () => {},
};

const ToastContext = createContext<ToastActions | null>(null);

/** A toast keeps a timer (and so is eligible to be dropped by R25) unless it's a persistent
 * error+action — the only kind that stays until Dismiss or its action runs. */
function hasTimer(toast: ToastRecord): boolean {
  return !(toast.kind === 'error' && toast.action);
}

/** R26: success is the tone-ok dot with `check`, info is tone-info with `message` (a distinct
 * glyph from success — not an unrelated "warning" triangle for a neutral notice), error is
 * unchanged (the danger fill, white icon, per R10). */
function discIcon(kind: ToastKind): IconName {
  if (kind === 'error') return 'x';
  if (kind === 'info') return 'message';
  return 'check';
}

function discToneClasses(kind: ToastKind): string {
  if (kind === 'error') return 'bg-danger-solid text-white';
  if (kind === 'info') return 'bg-tone-info-bg text-tone-info-fg';
  return 'bg-tone-ok-bg text-tone-ok-fg';
}

const TOAST_CLASSES =
  'glass-pop pointer-events-auto flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-fg shadow-pop';
const DISC_CLASSES = 'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full';

/** One visible toast: icon disc, message (+ optional detail), optional action, always a Dismiss. */
function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  // Dismiss first, then run the action: a throwing onClick still leaves the toast gone (not
  // stranded), and an onClick that itself shows a new toast does so against a slot this one has
  // already freed, rather than evicting some unrelated toast to make room.
  const runAction = () => {
    onDismiss(toast.id);
    toast.action?.onClick();
  };

  return (
    <li className={TOAST_CLASSES}>
      <span aria-hidden="true" className={`${DISC_CLASSES} ${discToneClasses(toast.kind)}`}>
        <Icon name={discIcon(toast.kind)} size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold text-fg">{toast.message}</p>
        {toast.detail ? <p className="text-[11px] text-fg-muted">{toast.detail}</p> : null}
      </div>
      {toast.action ? (
        <button type="button" className="shrink-0 text-[11.5px] font-bold text-accent-fg" onClick={runAction}>
          {toast.action.label}
        </button>
      ) : null}
      <IconButton label="Dismiss notification" icon="x" size="sm" onClick={() => onDismiss(toast.id)} />
    </li>
  );
}

// UA `[popover]` defaults (inset:0, margin:auto, border:solid, padding:.25em .75em, overflow:auto,
// Canvas/CanvasText colours) would centre it full-screen; every one of those is overridden here so
// it stays a bottom-centre stack. The width trick matches Dialog's `w-[calc(100%_-_2rem)]` (a 16px
// gutter on phones).
//
// The section stays laid out (an author `display: flex`) even while empty/closed, rather than
// relying on the UA's `[popover]:not(:popover-open) { display: none }` — that UA rule can't win
// against it anyway (author-origin `display` always beats user-agent-origin for normal-priority
// declarations, regardless of selector specificity), and `display: none` was rejected on purpose:
// it would pull both always-present live regions out of the accessibility tree, so the first toast
// added to an empty page would never be announced. Because it stays laid out, `pointer-events-none`
// here (undone per toast card via `pointer-events-auto` above) keeps this fixed, currently-empty
// box from swallowing clicks to whatever sits underneath it. No section-level gap either: `gap`
// between the two `<ul>`s would add space even when one (or both) holds nothing, since it applies
// between the generated boxes regardless of their content — spacing between the lists is added only
// when both actually hold a toast (see the conditional class below). z-50 is only a fallback for
// when the Popover API (and so the top layer) is unavailable; a shown popover's own top-layer
// stacking ignores z-index entirely.
//
// R23: while a BulkBar (ui/BulkBar.tsx) is mounted it marks `document.documentElement` with
// `data-bulk-bar=""` and publishes the bar's own measured height as `--bulk-bar-h`, and this
// section lifts clear of it under that attribute — otherwise a toast would show up underneath the
// bulk bar's own fixed pill. The arbitrary variant reads as "when this element is a descendant of
// html[data-bulk-bar]", which is trivially true of every element once the attribute is set (`html`
// is an ancestor of everything in the document) — this section itself renders inline wherever
// `ToastProvider` is mounted, not necessarily as a direct child of `<body>` (M8 correction).
//
// R23b: the lift is `calc(var(--bulk-bar-h) + 22px + 16px)`, not a static 84px — a wrapped BulkBar
// (its own `max-lg:flex-wrap`) can be taller than the one-line pill the static value assumed. The
// 22px is the bar's own `bottom-[22px]` offset and the 16px is breathing room above it; both are
// duplicated here as literals because CSS can't reference another file's Tailwind arbitrary value —
// if BulkBar's bottom offset ever changes, update it here too.
//
// R33: at ≥1024px the section also recentres on the content pane, matching BulkBar — see the
// `lg:` classes below and BulkBar.tsx's own comment for the 112px (half of Task 11's 224px
// sidebar) derivation.
const SECTION_CLASSES =
  'fixed inset-x-0 top-auto bottom-4 [html[data-bulk-bar]_&]:bottom-[calc(var(--bulk-bar-h)_+_22px_+_16px)] z-50 my-0 mx-auto w-[calc(100%_-_2rem)] max-w-sm border-0 bg-transparent p-0 text-fg overflow-visible pointer-events-none flex flex-col lg:right-auto lg:left-[calc(50%_+_112px)] lg:-translate-x-1/2';
const LIST_CLASSES = 'flex flex-col gap-2.5 list-none p-0 m-0';

function Notifications({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: number) => void }) {
  const sectionRef = useRef<HTMLElement>(null);

  // R20: a native <dialog> sits in the browser's top layer above everything else, so a plain
  // fixed toast shown while a dialog is open would sit under its scrim. `popover="manual"` puts
  // this section in the top layer too. Keyed on the newest toast's id (not the list itself, and
  // not its length — dropping the oldest while adding a 4th leaves the length unchanged, but a
  // toast still needs to be shown), so it fires only when a toast is *added*: React runs the
  // previous render's cleanup (hidePopover) before this one's setup (showPopover) whenever the id
  // changes, and runs only the cleanup once the list empties (a fresh `showPopover()` on an
  // already-open manual popover is a silent Chromium no-op, not a re-raise — it would leave the
  // toast under a modal opened since the last raise — so it's the cleanup-then-setup sequence
  // itself that does the re-raising, not a manual "was it open" check). Dismissing toasts (not the
  // newest) does not change this id, so it does not re-raise at all. happy-dom 20.14.5 has no
  // Popover API at all (HTMLElement has no showPopover / hidePopover there), so this is skipped in
  // most tests via the feature check below; tests/ui-toast.test.tsx stubs both methods on the
  // prototype for one block to drive and record the real sequence. Known, accepted limitation: a
  // toast raised over an already-open modal is visible but inert until the modal closes.
  // Plain index access, not `.at(-1)`: the base tsconfig's `lib` stops at ES2020 (tests override it
  // to ES2022 for `Array.prototype.at`, but src/ does not), and `toasts[toasts.length - 1]` gives
  // the identical `undefined` on an empty array under `noUncheckedIndexedAccess`.
  const newestToastId = toasts[toasts.length - 1]?.id ?? null;
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof section.showPopover !== 'function' || typeof section.hidePopover !== 'function') {
      return undefined;
    }
    if (newestToastId === null) return undefined;
    section.showPopover();
    return () => {
      section.hidePopover();
    };
  }, [newestToastId]);

  // Split by kind, not a separate list, so array order (oldest → newest) stays intact within each
  // region: `aria-live="polite"` for success/info, `aria-live="assertive"` for errors. Both regions
  // always render, even empty — a live region must already exist for content added to it later to
  // be announced.
  const politeToasts = toasts.filter((toast) => toast.kind !== 'error');
  const assertiveToasts = toasts.filter((toast) => toast.kind === 'error');
  const bothPopulated = politeToasts.length > 0 && assertiveToasts.length > 0;

  return (
    <section ref={sectionRef} aria-label="Notifications" popover="manual" className={SECTION_CLASSES}>
      <ul aria-live="polite" className={LIST_CLASSES}>
        {politeToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </ul>
      <ul aria-live="assertive" className={`${LIST_CLASSES}${bothPopulated ? ' mt-2.5' : ''}`}>
        {assertiveToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Notification toasts: `success` / `info` (4s) and `error` (8s, or until dismissed / its action
 * runs when it has one) stack bottom-centre, max 3. `useToast()` and its three functions are
 * created once per provider and never change identity; the toast list is kept as separate internal
 * state passed to `Notifications` by props (never through context), so showing a toast re-renders
 * only `Notifications` — React bails out reconciling `children`, passed through unchanged, whenever
 * only `toasts` changes. Every timer is armed in the call that shows the toast, never in an effect;
 * dropping a toast (R25), Dismiss, running an action and unmounting all clear the timer(s) they
 * make obsolete. `timers` (default: `window.setTimeout` / `clearTimeout`) is read once, at mount,
 * like a `useState` initial value — this provider does not support changing it afterwards, so a
 * caller re-rendering with a new `timers` object (R27) neither destabilises `useToast()` nor clears
 * an already-pending timer.
 */
export function ToastProvider({ children, timers: timersProp }: { children: ReactNode; timers?: Timers }) {
  const [timers] = useState(() => timersProp ?? DEFAULT_TIMERS);
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  // Mirrors `toasts`, read/written synchronously by show/dismiss so they never act on a stale
  // list — the same pattern ConfirmProvider uses for its pending request.
  const toastsRef = useRef<ToastRecord[]>([]);
  const timerIdsRef = useRef(new Map<number, number>());
  const nextIdRef = useRef(0);

  const clearToastTimer = useCallback(
    (id: number) => {
      const timerId = timerIdsRef.current.get(id);
      if (timerId !== undefined) {
        timers.clearTimeout(timerId);
        timerIdsRef.current.delete(id);
      }
    },
    [timers],
  );

  const dismiss = useCallback(
    (id: number) => {
      clearToastTimer(id);
      toastsRef.current = toastsRef.current.filter((toast) => toast.id !== id);
      setToasts(toastsRef.current);
    },
    [clearToastTimer],
  );

  const show = useCallback(
    (kind: ToastKind, message: string, detail: string | undefined, action: ToastAction | undefined) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;

      const existing = toastsRef.current;
      let next = [...existing, { id, kind, message, detail, action }];
      if (next.length > MAX_TOASTS) {
        // R25: prefer dropping the oldest *existing* toast that still has a timer over one a
        // curator deliberately kept around with an action; only when every existing toast is
        // itself a persistent error+action does the plain oldest (index 0) go instead. The
        // just-added toast is never a candidate — it's what's being shown right now. `existing`'s
        // indices line up with `next`'s first three, so the found index applies to either.
        const droppableIndex = existing.findIndex(hasTimer);
        const dropIndex = droppableIndex === -1 ? 0 : droppableIndex;
        const dropped = next[dropIndex];
        next = next.filter((_, index) => index !== dropIndex);
        if (dropped) clearToastTimer(dropped.id);
      }
      toastsRef.current = next;
      setToasts(next);

      // error with an action stays until Dismiss or the action runs; every other toast times out.
      const duration = kind === 'error' ? (action ? null : ERROR_DURATION_MS) : OK_DURATION_MS;
      if (duration !== null) {
        const timerId = timers.setTimeout(() => dismiss(id), duration);
        timerIdsRef.current.set(id, timerId);
      }
    },
    [timers, dismiss, clearToastTimer],
  );

  // Unmounted with toasts still showing: their timers must not fire against a gone provider.
  // The map itself is never reassigned (only mutated), so capturing it here and reading it again
  // in the cleanup still sees whatever is pending at unmount time — it just avoids reading
  // `timerIdsRef.current` directly inside the cleanup closure (react-hooks/refs). `timers` is
  // frozen at mount (R27), so this effect's dependency never actually changes before a real
  // unmount — a caller passing a fresh `timers` object on a later render cannot trigger this
  // cleanup early and wrongly clear every pending timer.
  useEffect(() => {
    const timerIds = timerIdsRef.current;
    return () => {
      for (const timerId of timerIds.values()) {
        timers.clearTimeout(timerId);
      }
      timerIds.clear();
    };
  }, [timers]);

  const actions = useMemo<ToastActions>(
    () => ({
      success: (message, detail) => show('success', message, detail, undefined),
      error: (message, options) => show('error', message, options?.detail, options?.action),
      info: (message, detail) => show('info', message, detail, undefined),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={actions}>
      {children}
      <Notifications toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** The provider's stable `{ success, error, info }`; outside a provider, a stable no-op object. */
export function useToast(): ToastActions {
  return useContext(ToastContext) ?? NOOP_ACTIONS;
}

/** Adapter for legacy call sites: `(message, isError?)`, stable identity, routed to success/error. */
export function useShowToast(): ShowToast {
  const { success, error } = useToast();
  return useCallback<ShowToast>(
    (message, isError = false) => {
      if (isError) error(message);
      else success(message);
    },
    [success, error],
  );
}

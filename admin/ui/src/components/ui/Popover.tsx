import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Icon, type IconName } from './Icon';
import { isImeKeyDown } from './keyboard';

type PopoverKind = 'dialog' | 'menu' | 'listbox';

/**
 * Where focus lands when a panel opens. Buttons count even with `tabindex="-1"`: a Menu keeps all
 * but one item out of the tab order, yet its first item is still where focus belongs on open.
 */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// No display utility here: the `hidden` attribute has to win while the popover is closed.
const PANEL_CLASSES =
  'glass-pop absolute z-50 max-h-[min(70vh,28rem)] min-w-[240px] max-w-[calc(100vw-2rem)] overflow-auto rounded-2xl p-1.5 text-fg shadow-pop focus:outline-none';

/** Which side of its anchor the panel opens on. */
const SIDE_CLASSES: Record<'top' | 'bottom', string> = {
  bottom: 'top-full mt-2',
  top: 'bottom-full mb-2',
};

/** The label of the popover a Menu sits in, so the menu is named after it. */
const PopoverLabelContext = createContext<string | undefined>(undefined);

/**
 * Hands focus back to the trigger when closing would otherwise strand it — while it is inside the
 * panel about to hide, or already on <body>. Focus the user moved elsewhere is left alone.
 */
function returnFocusToTrigger(panel: HTMLElement | null, trigger: HTMLElement | null, options?: FocusOptions): void {
  if (!panel || !trigger) return;
  const active = panel.ownerDocument.activeElement;
  if (active === null || active === panel.ownerDocument.body || panel.contains(active)) {
    trigger.focus(options);
  }
}

/**
 * An anchored overlay: `trigger` renders the button (spread `triggerProps` onto it) and the panel
 * it opens holds `children` — or `children(close)` for content that closes it. Controlled when
 * `open` is given (then `onOpenChange` is the only way the state changes), otherwise it keeps its
 * own. The panel is always rendered, `hidden` while closed, and carries `data-overlay-open` while
 * open, which the editor shortcut guard looks for. Opening focuses the panel's first focusable
 * element. Escape, a pointerdown outside and focus moving outside close it; closing returns focus
 * to the trigger unless the user already moved it elsewhere. `className` is appended to the
 * wrapper (`relative inline-flex`) — e.g. `w-full` for a trigger that spans its container. With
 * `anchor="container"` the wrapper is not positioned, so the panel opens from, and aligns to, the
 * nearest positioned ancestor instead of the trigger (a small button at the end of a wide row).
 */
export function Popover({
  kind,
  label,
  side = 'bottom',
  align = 'start',
  anchor = 'trigger',
  open,
  onOpenChange,
  className,
  trigger,
  children,
}: {
  kind: PopoverKind;
  label: string;
  /** Below the trigger by default; `top` opens upward, for a trigger at the bottom of the viewport (a bulk bar). */
  side?: 'bottom' | 'top';
  align?: 'start' | 'end';
  anchor?: 'trigger' | 'container';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  trigger: (props: {
    open: boolean;
    triggerProps: {
      ref: Ref<HTMLButtonElement>;
      type: 'button';
      'aria-haspopup': PopoverKind;
      'aria-expanded': boolean;
      'aria-controls': string;
      onClick: () => void;
    };
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (next === isOpen) return;
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // Handed to `children`: only state, no refs — the layout effect below returns focus afterwards.
  const close = () => setOpen(false);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // An Escape that cancels an IME conversion in a field inside the panel is not a close request.
    if (event.key !== 'Escape' || !isOpen || event.defaultPrevented || isImeKeyDown(event)) return;
    // Innermost overlay first: an enclosing drawer or native <dialog> must not close with it.
    event.preventDefault();
    event.stopPropagation();
    returnFocusToTrigger(panelRef.current, triggerRef.current);
    setOpen(false);
  };

  const onPointerDownOutside = useEffectEvent((event: PointerEvent) => {
    if (wrapperRef.current?.contains(event.target as Node | null) ?? true) return;
    // The pointer is on its way somewhere else: don't scroll the page back to the trigger under it.
    returnFocusToTrigger(panelRef.current, triggerRef.current, { preventScroll: true });
    setOpen(false);
  });

  const onFocusOutside = useEffectEvent((event: FocusEvent) => {
    if (wrapperRef.current?.contains(event.target as Node | null) ?? true) return;
    // Tabbed or moved away: leave focus where it went, but don't leave the panel open behind it.
    setOpen(false);
  });

  useEffect(() => {
    if (!isOpen) return;
    const doc = wrapperRef.current?.ownerDocument ?? document;
    const handlePointerDown = (event: PointerEvent) => onPointerDownOutside(event);
    const handleFocusIn = (event: FocusEvent) => onFocusOutside(event);
    // Capture phase, so an outside handler that stops propagation still closes the popover.
    doc.addEventListener('pointerdown', handlePointerDown, true);
    doc.addEventListener('focusin', handleFocusIn);
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
      doc.removeEventListener('focusin', handleFocusIn);
    };
  }, [isOpen]);

  // A layout effect, not a cleanup: right after the mutation phase React re-focuses whatever had
  // focus before the commit, so a focus move made during that phase would be undone.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (isOpen) {
      wasOpenRef.current = true;
      // The panel lost `hidden` in this commit, so it can take focus now.
      (panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel)?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      // Closed by `close`, the trigger, or an owner flipping `open` — focus must not stay behind.
      returnFocusToTrigger(panel, triggerRef.current);
    }
  }, [isOpen]);

  const wrapperClasses = anchor === 'container' ? 'inline-flex' : 'relative inline-flex';

  return (
    <div
      ref={wrapperRef}
      className={className ? `${wrapperClasses} ${className}` : wrapperClasses}
      onKeyDown={handleKeyDown}
    >
      {trigger({
        open: isOpen,
        triggerProps: {
          ref: triggerRef,
          type: 'button',
          'aria-haspopup': kind,
          'aria-expanded': isOpen,
          'aria-controls': panelId,
          onClick: () => setOpen(!isOpen),
        },
      })}
      <div
        ref={panelRef}
        id={panelId}
        role={kind === 'dialog' ? 'dialog' : undefined}
        aria-label={kind === 'dialog' ? label : undefined}
        tabIndex={-1}
        hidden={!isOpen}
        data-overlay-open={isOpen ? '' : undefined}
        className={`${PANEL_CLASSES} ${SIDE_CLASSES[side]} ${align === 'end' ? 'right-0' : 'left-0'}`}
      >
        <PopoverLabelContext.Provider value={label}>
          {typeof children === 'function' ? children(close) : children}
        </PopoverLabelContext.Provider>
      </div>
    </div>
  );
}

export type MenuItem = {
  label: string;
  icon?: IconName;
  description?: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * The item a navigation key moves focus to, or `null` when the key is not one of Menu's. Disabled
 * items are skipped; arrows wrap; a printable character jumps to the next item starting with it.
 */
function nextMenuIndex(items: MenuItem[], current: number, key: string): number | null {
  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  const first = enabled[0];
  const last = enabled[enabled.length - 1];
  if (first === undefined || last === undefined) return null;

  switch (key) {
    case 'ArrowDown':
      return enabled.find((index) => index > current) ?? first;
    case 'ArrowUp':
      return [...enabled].reverse().find((index) => index < current) ?? last;
    case 'Home':
      return first;
    case 'End':
      return last;
  }

  if (key.length !== 1 || key === ' ') return null;
  const letter = key.toLocaleLowerCase();
  const matches = enabled.filter((index) => items[index]?.label.trim().toLocaleLowerCase().startsWith(letter));
  return matches.find((index) => index > current) ?? matches[0] ?? null;
}

const MENU_ITEM_CLASSES =
  'flex w-full items-center gap-2.5 rounded-radius-md px-2 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus';

/**
 * `role="menu"` of `menuitem` buttons with roving focus: ArrowUp / ArrowDown / Home / End and
 * first-letter type-ahead. Choosing an item (click or Enter) calls its `onSelect` once, then
 * `onDone` — pass the Popover's `close` there.
 */
export function Menu({ items, onDone }: { items: MenuItem[]; onDone?: () => void }) {
  const label = useContext(PopoverLabelContext);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const focusedItem = items[focusedIndex];
  // The one item in the tab order: the last focused one while it is still enabled, else the first enabled.
  const tabStop =
    focusedItem !== undefined && !focusedItem.disabled ? focusedIndex : items.findIndex((item) => !item.disabled);

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    item.onSelect();
    onDone?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isImeKeyDown(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = buttons.findIndex((button) => button === event.target);

    if (event.key === 'Enter') {
      const item = items[current];
      if (item === undefined) return;
      // Selected on keydown and cancelled, so the browser's own Enter-to-click can't select it twice.
      event.preventDefault();
      select(item);
      return;
    }

    const next = nextMenuIndex(items, current, event.key);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="flex w-[16.5rem] max-w-full flex-col gap-0.5"
    >
      {items.map((item, index) => {
        const danger = item.tone === 'danger';
        return (
          <button
            // Positional, like the menu's own focus state: items keep their order, and two may share a label.
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            key={index}
            type="button"
            role="menuitem"
            tabIndex={index === tabStop ? 0 : -1}
            disabled={item.disabled}
            onClick={() => select(item)}
            onFocus={() => setFocusedIndex(index)}
            className={`${MENU_ITEM_CLASSES} ${
              danger
                ? 'text-tone-danger-fg enabled:hover:bg-tone-danger-bg focus:bg-tone-danger-bg'
                : 'text-fg enabled:hover:bg-tone-neutral-bg focus:bg-tone-neutral-bg'
            }`}
          >
            {item.icon ? (
              <span
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-white ${
                  danger ? 'bg-danger-solid' : 'bg-accent'
                }`}
              >
                <Icon name={item.icon} size={14} />
              </span>
            ) : null}
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">{item.label}</span>
              {item.description ? <span className="text-meta text-fg-muted">{item.description}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

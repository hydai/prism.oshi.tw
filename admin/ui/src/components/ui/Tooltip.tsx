import {
  cloneElement,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { isImeKeyDown } from './keyboard';

const SIDE_CLASSES: Record<'top' | 'bottom', string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
};

export type TooltipAlign = 'center' | 'start' | 'end';

/**
 * Where the chip sits along its target: centred on it (`left-1/2` there, `-translate-x-1/2` later
 * in the class list, as the chip has always had them), or lined up with its start or end edge — a
 * target at the end of its container keeps its chip inside, growing away from that edge.
 */
const ALIGN_CLASSES: Record<TooltipAlign, { edge: string; shift: string }> = {
  center: { edge: 'left-1/2', shift: ' -translate-x-1/2' },
  start: { edge: 'left-0', shift: '' },
  end: { edge: 'right-0', shift: '' },
};

/**
 * A transparent strip (the chip's `::before`) over the 8 px gap between the target and the chip,
 * so the pointer crosses from one to the other without ever leaving the hover group.
 */
const BRIDGE_CLASSES: Record<'top' | 'bottom', string> = {
  top: 'before:absolute before:inset-x-0 before:top-full before:h-2',
  bottom: 'before:absolute before:inset-x-0 before:bottom-full before:h-2',
};

/**
 * Shown on its own group's hover or focus-within, after 400 ms. `visibility` moves with the
 * opacity, so a hidden chip (and its bridge) never catches the pointer.
 */
const SHOW_CLASSES =
  'transition-[opacity,visibility] delay-[400ms] duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100';

/**
 * Tooltip shown on hover or focus-within after a 400 ms delay, linked to its child via
 * `aria-describedby`. The wrapper uses the NAMED group `group/tip` (never the unnamed `group`) so
 * an IconButton nested in a row that relies on the unnamed `group` for hover actions never
 * collides with this one. It opens above its target; `side="bottom"` opens it below, for a target
 * at the top of the viewport. It is centred on its target; `align="end"` (or `"start"`) lines it up
 * with that edge instead, for a target at the end (or start) of its container: a centred chip would
 * reach past that container's edge.
 *
 * While hidden the chip is not laid out at all (src/index.css: `display: none` until its group is
 * hovered or holds focus, again once its fade has ended, and at once when Escape dismisses it — the
 * rule that lays it out asks for the show utilities, which a dismissed chip drops), so an invisible
 * chip never widens a scroll container either.
 *
 * WCAG 1.4.13: the chip is hoverable (the pointer can move onto it and it stays), persistent (it
 * stays until hover and focus leave) and dismissible — Escape hides it without moving focus or
 * the pointer, and the next hover or focus shows it again. The tooltip only takes an Escape that
 * is its own: with focus on the target, it cancels and stops it, so a popover, drawer or dialog
 * around the target stays open until a second one. Shown by hover alone, it hides on an Escape
 * the focused control leaves unhandled, without cancelling or stopping it. While nothing is on
 * screen, Escape passes through untouched.
 *
 * A tooltip that only repeats its child's accessible name (`aria-label`, as on every
 * IconButton) is for the eyes alone: it is neither the child's description nor in the
 * accessibility tree, so a screen reader does not say the name twice.
 */
export function Tooltip({
  label,
  side = 'top',
  align = 'center',
  children,
}: {
  label: string;
  side?: 'top' | 'bottom';
  align?: TooltipAlign;
  children: ReactElement<{ 'aria-describedby'?: string; 'aria-label'?: string }>;
}) {
  const id = useId();
  const { edge, shift } = ALIGN_CLASSES[align];
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  // Escape hid it; the next hover or focus clears this.
  const [dismissed, setDismissed] = useState(false);
  const describes = children.props['aria-label'] !== label;

  /**
   * An Escape the chip may take: not yet handled, not an IME conversion's (that Escape cancels the
   * conversion), and pressed while the chip is on screen — inside its show delay it is someone else's.
   */
  const isChipEscape = (event: KeyboardEvent | ReactKeyboardEvent): boolean => {
    const tip = tipRef.current;
    if (dismissed || tip === null || event.key !== 'Escape' || event.defaultPrevented || isImeKeyDown(event)) return false;
    return tip.ownerDocument.defaultView?.getComputedStyle(tip).visibility !== 'hidden';
  };

  // Focus is on the target, so the Escape is the tooltip's: taken here, on the wrapper, it is
  // cancelled and stopped before the popover, drawer or dialog around the target sees it.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!isChipEscape(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDismissed(true);
  };

  // Shown by hover alone, focus elsewhere: the Escape is the focused control's. The tooltip hears it
  // after that control (document, bubble phase), leaves it alone if the control handled it, and
  // otherwise hides without cancelling or stopping it.
  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isChipEscape(event)) setDismissed(true);
  });

  useEffect(() => {
    if (!hovered || dismissed) return undefined;
    const doc = tipRef.current?.ownerDocument ?? document;
    const listener = (event: KeyboardEvent) => handleDocumentKeyDown(event);
    doc.addEventListener('keydown', listener);
    return () => doc.removeEventListener('keydown', listener);
  }, [hovered, dismissed]);

  return (
    <span
      className="group/tip relative inline-flex"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={handleKeyDown}
    >
      {describes ? cloneElement(children, { 'aria-describedby': id }) : children}
      <span
        ref={tipRef}
        id={id}
        role="tooltip"
        aria-hidden={describes ? undefined : true}
        className={`invisible absolute ${edge} z-50 ${SIDE_CLASSES[side]} ${BRIDGE_CLASSES[side]}${shift} whitespace-nowrap rounded-radius-sm bg-tooltip-bg px-2 py-1 text-meta text-tooltip-fg opacity-0${dismissed ? '' : ` ${SHOW_CLASSES}`}`}
      >
        {label}
      </span>
    </span>
  );
}

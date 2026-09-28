import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { usePlayerClockTime } from '../hooks/usePlayerClock';
import { formatTimestamp } from '../lib/format-timestamp';
import { Icon } from './ui/Icon';

interface PillPerformance {
  title: string;
  timestamp: number;
  endTimestamp: number | null;
}

interface Props {
  perf: PillPerformance | null;
  /**
   * The page's player box (the workbench, with the player and the console's own clock). The pill
   * shows only while none of it is on screen; without it, or with no IntersectionObserver, the pill
   * is always shown. It must accept the focus programmatically (`tabIndex={-1}`): when the pill
   * hides while it still has the focus, it is handed off here rather than left to fall to `<body>`.
   */
  playerBox?: RefObject<HTMLElement | null>;
  /** When provided, the pill is a button (e.g. scroll back to the player). */
  onClick?: () => void;
  className?: string;
}

// A small fixed floating surface, like the toasts and the bulk bar: glass-pop, blurred (ruling R37).
const baseClass = 'glass-pop fixed bottom-4 right-4 z-30 rounded-radius-xl px-4 py-3 text-left text-fg shadow-pop';

/**
 * Whether the player box is on screen, as its IntersectionObserver last said. It starts out on
 * screen where there is a box to watch (a page opens at its top, where the player is), so the pill
 * does not flash up before the first report; with none, or no observer, it never is.
 *
 * `pill` is the pill's own rendered element. When the box comes back into view — the pill about to
 * go `invisible` + `aria-hidden` — a pill that still has the focus (keyboard or a click) hands it to
 * the box first, rather than let it fall to `<body>` on the next Tab.
 */
function usePlayerBoxInView(
  playerBox: RefObject<HTMLElement | null> | undefined,
  pill: RefObject<HTMLElement | null>,
): boolean {
  const [inView, setInView] = useState(() => playerBox !== undefined && typeof IntersectionObserver !== 'undefined');

  useEffect(() => {
    const box = playerBox?.current;
    if (!box || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (!latest) return;
      if (latest.isIntersecting && document.activeElement === pill.current) box.focus({ preventScroll: true });
      setInView(latest.isIntersecting);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [playerBox, pill]);

  return inView;
}

/**
 * Subscribes to the shared clock itself: a tick re-renders the pill, never the page behind it.
 * While the player box is on screen the pill is hidden — `invisible` and `aria-hidden`, not
 * unmounted, so its clock is still one of the page's two displays — since the console's own clock
 * is in view then, and the pill would sit over the console's buttons on a phone.
 */
export function FloatingPlaybackPill({ perf, playerBox, onClick, className }: Props) {
  const currentTime = usePlayerClockTime();
  // A plain ref object, not the callback itself, so the hook above can read the pill's current
  // element without the callback's own identity as a dependency.
  const pillNode = useRef<HTMLElement | null>(null);
  const pillRef = useCallback((node: HTMLElement | null) => {
    pillNode.current = node;
  }, []);
  const hidden = usePlayerBoxInView(playerBox, pillNode);
  const classes = `${baseClass}${className ? ` ${className}` : ''}${hidden ? ' invisible' : ''}`;
  const content = (
    <>
      <div className="flex items-center gap-2">
        <Icon name="play" size={10} className="text-fg-subtle" />
        <span className="font-mono text-token-lg font-semibold text-fg">
          {formatTimestamp(currentTime)}
        </span>
      </div>
      {perf && (
        <>
          <div className="mt-1 max-w-60 truncate text-token-md font-medium text-fg">
            {perf.title}
          </div>
          <div className="mt-0.5 font-mono text-meta text-fg-muted">
            start {formatTimestamp(perf.timestamp)} &rarr; end{' '}
            {perf.endTimestamp !== null ? formatTimestamp(perf.endTimestamp) : '—'}
          </div>
        </>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        ref={pillRef}
        type="button"
        onClick={onClick}
        title="Back to player"
        aria-hidden={hidden ? 'true' : undefined}
        className={classes}
      >
        {content}
      </button>
    );
  }
  return (
    <div ref={pillRef} aria-hidden={hidden ? 'true' : undefined} className={classes}>
      {content}
    </div>
  );
}

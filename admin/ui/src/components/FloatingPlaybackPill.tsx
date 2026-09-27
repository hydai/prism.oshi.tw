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
  /** When provided, the pill is a button (e.g. scroll back to the player). */
  onClick?: () => void;
  className?: string;
}

// A small fixed floating surface, like the toasts and the bulk bar: glass-pop, blurred (ruling R37).
const baseClass = 'glass-pop fixed bottom-4 right-4 z-30 rounded-radius-xl px-4 py-3 text-left text-fg shadow-pop';

/** Subscribes to the shared clock itself: a tick re-renders the pill, never the page behind it. */
export function FloatingPlaybackPill({ perf, onClick, className }: Props) {
  const currentTime = usePlayerClockTime();
  const classes = className ? `${baseClass} ${className}` : baseClass;
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
      <button type="button" onClick={onClick} title="Back to player" className={classes}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

import { usePlayerClockTime } from '../hooks/usePlayerClock';
import { formatTimestamp } from '../lib/format-timestamp';

interface PillPerformance {
  title: string;
  timestamp: number;
  endTimestamp: number | null;
}

interface Props {
  perf: PillPerformance | null;
  /** When provided, the pill is a button (e.g. scroll back to the player). */
  onClick?: () => void;
}

const baseClass =
  'fixed bottom-4 right-4 z-30 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-lg';

/** Subscribes to the shared clock itself: a tick re-renders the pill, never the page behind it. */
export function FloatingPlaybackPill({ perf, onClick }: Props) {
  const currentTime = usePlayerClockTime();
  const content = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">&#9654;</span>
        <span className="font-mono text-lg font-semibold text-slate-800">
          {formatTimestamp(currentTime)}
        </span>
      </div>
      {perf && (
        <>
          <div className="mt-1 max-w-60 truncate text-sm font-medium text-slate-700">
            {perf.title}
          </div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">
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
        onClick={onClick}
        title="Back to player"
        className={`${baseClass} transition-shadow hover:shadow-xl`}
      >
        {content}
      </button>
    );
  }
  return <div className={baseClass}>{content}</div>;
}

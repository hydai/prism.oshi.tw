interface PillPerformance {
  title: string;
  timestamp: number;
  endTimestamp: number | null;
}

interface Props {
  currentTime: number;
  perf: PillPerformance | null;
  onClick: () => void;
}

function formatTimestamp(sec: number): string {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FloatingPlaybackPill({ currentTime, perf, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      title="Back to player"
      className="fixed bottom-4 right-4 z-30 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-lg transition-shadow hover:shadow-xl"
    >
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
    </button>
  );
}

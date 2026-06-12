import type { OutcomeTone } from '../../../shared/itunes';

export interface FetchLogEntry {
  key: number;
  title: string;
  tone: OutcomeTone;
  text: string;
}

const TONE_STYLES: Record<OutcomeTone, { row: string; icon: string }> = {
  success: { row: 'text-green-700', icon: '✓' },
  warning: { row: 'text-amber-700', icon: '△' },
  error: { row: 'text-red-700', icon: '✕' },
};

export function FetchLogPanel({ entries, onClear }: {
  entries: FetchLogEntry[];
  onClear: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-600">
          iTunes fetch log ({entries.length})
        </span>
        <button
          onClick={onClear}
          className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
        >
          Clear
        </button>
      </div>
      <ul className="max-h-44 overflow-y-auto px-3 py-1.5 text-xs">
        {entries.map((e) => (
          <li key={e.key} className={`flex gap-1.5 py-0.5 ${TONE_STYLES[e.tone].row}`}>
            <span className="shrink-0">{TONE_STYLES[e.tone].icon}</span>
            <span className="min-w-0">
              <span className="font-medium">{e.title}</span>
              <span className="text-slate-400"> — </span>
              {e.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

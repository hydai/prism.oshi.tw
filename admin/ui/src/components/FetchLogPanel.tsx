import type { OutcomeTone } from '../../../shared/itunes';
import { Icon, type IconName } from './ui/Icon';

export interface FetchLogEntry {
  key: number;
  title: string;
  tone: OutcomeTone;
  text: string;
}

const TONE_STYLES: Record<OutcomeTone, { row: string; icon: IconName }> = {
  success: { row: 'text-tone-ok-fg', icon: 'check' },
  warning: { row: 'text-tone-warn-fg', icon: 'alert' },
  error: { row: 'text-tone-danger-fg', icon: 'x' },
};

export function FetchLogPanel({ entries, onClear }: {
  entries: FetchLogEntry[];
  onClear: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-3 rounded-radius-lg border border-field-line bg-field">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
        <span className="text-meta font-medium text-fg-muted">
          iTunes fetch log ({entries.length})
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded-radius-pill border border-field-line px-2.5 py-0.5 text-meta font-medium text-fg-muted hover:text-fg"
        >
          Clear
        </button>
      </div>
      <ul className="max-h-44 overflow-y-auto px-3 py-1.5 text-meta">
        {entries.map((e) => (
          <li key={e.key} className={`flex items-center gap-1.5 py-0.5 ${TONE_STYLES[e.tone].row}`}>
            <Icon name={TONE_STYLES[e.tone].icon} size={12} className="shrink-0" />
            <span className="min-w-0">
              <span className="font-medium">{e.title}</span>
              <span className="text-fg-subtle"> — </span>
              {e.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

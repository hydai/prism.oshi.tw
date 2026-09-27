import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Display';

interface ShortcutRow {
  keys: string[];
  label: string;
}

/** The full shortcut reference, in the order `ShortcutSheet` lists them. */
const SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: ['m'], label: 'Mark end' },
  { keys: ['t'], label: 'Set start' },
  { keys: ['s'], label: 'Seek start' },
  { keys: ['e'], label: 'Seek end −5s' },
  { keys: ['E'], label: 'Seek end exactly' },
  { keys: ['n', 'p'], label: 'Next / previous song' },
  { keys: ['c'], label: 'Copy video URL' },
  { keys: ['f'], label: 'Fetch duration' },
  { keys: ['F'], label: 'Fetch all durations' },
  { keys: ['x'], label: 'Export song list' },
  { keys: ['i'], label: 'Paste import' },
  { keys: ['←', '→'], label: 'Seek ±5s' },
  { keys: ['F2'], label: 'Edit title or artist' },
  { keys: ['?'], label: 'Show shortcuts' },
];

function HintGroup({ keys, children }: { keys: string[]; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}

/** The always-visible subset under the console (spec §5 workbench); `?` opens the full `ShortcutSheet`. */
export function ShortcutHints({ onOpenSheet }: { onOpenSheet: () => void }) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-line-soft px-3.5 py-2.5 text-meta text-fg-subtle">
      <HintGroup keys={['←', '→']}>±5s</HintGroup>
      <HintGroup keys={['n', 'p']}>next / prev song</HintGroup>
      <HintGroup keys={['c']}>copy URL</HintGroup>
      <HintGroup keys={['F']}>fetch durations</HintGroup>
      <button type="button" onClick={onOpenSheet} className="inline-flex items-center gap-1.5 text-fg-subtle hover:text-fg">
        <Kbd>?</Kbd>
        <span>all shortcuts</span>
      </button>
    </div>
  );
}

/** The full shortcut reference (spec §5 `ShortcutSheet`), opened by `?`; Escape closes it through the dialog's `cancel`. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <ul className="flex flex-col gap-1.5">
        {SHORTCUT_ROWS.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 text-token-sm text-fg">
            <span className="flex gap-1">
              {row.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
            <span className="text-fg-muted">{row.label}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

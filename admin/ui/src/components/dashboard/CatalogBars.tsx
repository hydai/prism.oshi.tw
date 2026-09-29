import type { StatusCounts } from '../../../../shared/types';
import { CATALOG_STATUSES, catalogSegments, type CatalogTone } from '../../lib/dashboard-data';

/**
 * A status's fill: its tone's chart colour (`--chart-*`), lighter than the tone's text colour in the
 * light theme and the same as it in the dark one.
 */
const FILL_CLASSES: Record<CatalogTone, string> = {
  ok: 'bg-chart-ok',
  warn: 'bg-chart-warn',
  danger: 'bg-chart-danger',
  neutral: 'bg-chart-neutral',
  teal: 'bg-chart-teal',
};

/**
 * The Dashboard's catalog (spec §8.1, mockup `.sbar`): one row per count — its label, a stacked bar
 * of its statuses and its total — then a legend of the five statuses. A bar is one image to a screen
 * reader, named by its parts (`Songs: 2,398 total — 2,390 approved, 8 pending`); each part carries
 * its own count in `title` for the pointer. A part keeps at least 3 px, so a status with a sliver of
 * the total still shows.
 */
export function CatalogBars({ rows }: { rows: { label: string; counts: StatusCounts }[] }) {
  return (
    <div>
      {rows.map(({ label, counts }) => {
        const segments = catalogSegments(counts);
        const total = segments.reduce((sum, segment) => sum + segment.value, 0);
        const parts = segments
          .map((segment) => `${segment.value.toLocaleString()} ${segment.label.toLowerCase()}`)
          .join(', ');
        return (
          <div key={label} className="grid h-[30px] grid-cols-[92px_minmax(0,1fr)_54px] items-center gap-3">
            <span className="truncate text-[12px] font-[650] text-fg">{label}</span>
            <div
              role="img"
              aria-label={`${label}: ${total.toLocaleString()} total${parts ? ` — ${parts}` : ''}`}
              className="flex h-2.5 gap-0.5 overflow-hidden rounded-[6px] bg-track"
            >
              {segments.map((segment) => (
                <span
                  key={segment.key}
                  title={`${segment.label}: ${segment.value.toLocaleString()}`}
                  className={`h-full min-w-[3px] rounded-[3px] ${FILL_CLASSES[segment.tone]}`}
                  style={{ width: `${segment.pct}%` }}
                />
              ))}
            </div>
            <span className="text-right text-[12.5px] font-[750] tabular-nums text-fg">{total.toLocaleString()}</span>
          </div>
        );
      })}
      {/* What the colours mean. Hidden from screen readers: each bar's name already says it. */}
      <ul aria-hidden="true" className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-fg-subtle">
        {CATALOG_STATUSES.map((status) => (
          <li key={status.key} className="inline-flex items-center gap-[5px]">
            <span className={`h-2 w-2 rounded-[2px] ${FILL_CLASSES[status.tone]}`} />
            {status.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

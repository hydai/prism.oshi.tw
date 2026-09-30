import type { VodExportCapacityDiagnostic } from '../../api/vodExportTypes';
import { capacityLabel, formatPercent } from '../../lib/vod-export-format';
import { ProgressBar } from '../ui/Display';
import { SideCard } from './parts';

/** The share of a confirmed limit from which a resource needs watching (the worker's warning ratio). */
const WARNING_RATIO = 0.8;

function nearLimit(item: VodExportCapacityDiagnostic): boolean {
  return item.state !== 'ok' || item.ratio >= WARNING_RATIO;
}

/**
 * How close a preview came to each confirmed v1 limit: every resource the preview measured, as a bar
 * with its percentage — warn-toned from 80%, danger-toned once exceeded, where the exact numbers show
 * too. Nothing before a preview has returned capacity data.
 */
export function CapacityPanel({ diagnostics }: { diagnostics: VodExportCapacityDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  const allWithinLimits = !diagnostics.some(nearLimit);

  return (
    <SideCard
      title="Capacity"
      aside={allWithinLimits ? <span className="text-[11px] text-fg-subtle">all within limits</span> : null}
    >
      {allWithinLimits ? null : (
        <p className="text-[11px] leading-normal text-fg-muted">
          One or more resources have reached at least 80% of the confirmed v1 limit.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {diagnostics.map((item) => {
          const label = capacityLabel(item.resource);
          const numbers = `${item.actual.toLocaleString()} / ${item.limit.toLocaleString()}`;
          const watched = nearLimit(item);
          let tone: 'accent' | 'warn' | 'danger' = watched ? 'warn' : 'accent';
          if (item.state === 'exceeded') tone = 'danger';
          return (
            <li key={item.resource} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-fg-muted">{label}</span>
                {watched ? <span className="shrink-0 font-mono text-[10.5px] text-fg-subtle">{numbers}</span> : null}
                <span className="shrink-0 font-[650] text-fg">{formatPercent(item.ratio)}</span>
              </div>
              <ProgressBar value={item.actual} max={item.limit} label={`${label}: ${numbers}`} tone={tone} />
            </li>
          );
        })}
      </ul>
    </SideCard>
  );
}

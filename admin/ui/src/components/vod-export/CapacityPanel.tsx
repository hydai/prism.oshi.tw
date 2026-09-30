import type { VodExportCapacityDiagnostic } from '../../api/vodExportTypes';
import { capacityLabel, formatPercent } from '../../lib/vod-export-format';

export function CapacityPanel({ diagnostics }: { diagnostics: VodExportCapacityDiagnostic[] }) {
  const visible = diagnostics.filter((item) => item.state !== 'ok' || item.ratio >= 0.8);
  if (visible.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4" aria-labelledby="capacity-heading">
      <h3 id="capacity-heading" className="text-sm font-semibold text-amber-900">
        Export capacity
      </h3>
      <p className="mt-1 text-xs text-amber-800">
        One or more resources have reached at least 80% of the confirmed v1 limit.
      </p>
      <div className="mt-3 space-y-3">
        {visible.map((item) => {
          const width = `${Math.min(100, Math.max(0, item.ratio * 100))}%`;
          return (
            <div key={item.resource}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-amber-950">{capacityLabel(item.resource)}</span>
                <span className="font-mono text-amber-900">
                  {item.actual.toLocaleString()} / {item.limit.toLocaleString()} ({formatPercent(item.ratio)})
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-amber-200">
                <div
                  className={`h-full rounded-full ${item.state === 'exceeded' ? 'bg-red-600' : 'bg-amber-500'}`}
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

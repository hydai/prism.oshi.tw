import type { ReactNode } from 'react';
import type { VodExportCounts } from '../../api/vodExportTypes';

export function CountsGrid({ counts }: { counts: VodExportCounts }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {(
        [
          ['Streamers', counts.streamers],
          ['VODs', counts.vods],
          ['Performances', counts.performances],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-slate-100 py-3 first:border-t-0 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export function CopyButton({ value, onCopied }: { value: string; onCopied: () => void }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
    } catch {
      // Clipboard access can be denied; the complete selectable value remains visible.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      aria-label="Copy value"
    >
      Copy
    </button>
  );
}

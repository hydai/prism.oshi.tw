import type { ReactNode } from 'react';
import type { VodExportCounts } from '../../api/vodExportTypes';
import { formatFullTime, formatWhen } from '../../lib/dates';
import { IconButton } from '../ui/Button';
import { GlassCard } from '../ui/Display';
import { useToast } from '../ui/toast';

/**
 * One card of the VOD Export side column (the mockup's `.sc`): a glass section named `title`, whose
 * title row carries `aside` — a status pill, a short summary — at its far end.
 */
export function SideCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <GlassCard as="section" aria-label={title} padding="none" className="flex min-w-0 flex-col gap-2.5 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-[12.5px] font-bold text-fg">{title}</h2>
        {aside ? <div className="ml-auto flex shrink-0 items-center">{aside}</div> : null}
      </div>
      {children}
    </GlassCard>
  );
}

/** A snapshot's scope in three small tiles (the mockup's `.cnts`). */
export function CountsGrid({ counts }: { counts: VodExportCounts }) {
  return (
    <dl className="grid grid-cols-3 gap-1.5">
      {(
        [
          ['Streamers', counts.streamers],
          ['VODs', counts.vods],
          ['Performances', counts.performances],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-[10px] border border-field-line bg-field px-2 py-1.5">
          <dt className="truncate text-[10px] text-fg-subtle">{label}</dt>
          <dd className="text-[14px] font-bold text-fg">{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One field of a card's `<dl>` (the mockup's `.kv`): the label in a narrow column, the value wrapping beside it. */
export function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-2 py-1 text-[11.5px]">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

/** A stored time read in local time ("Jul 11, 20:35"), the full local time in its tooltip, the exact value in `dateTime`. */
export function LocalTime({ value, now }: { value: string; now: number }) {
  return (
    <time dateTime={value} title={formatFullTime(value)}>
      {formatWhen(value, new Date(now))}
    </time>
  );
}

/**
 * Copies `value`, then calls `onCopied`; icon-only, so `label` says what it copies. A refused
 * clipboard raises a "Copy failed" error toast (spec §7). It sits at the end of its side-card row,
 * so its tooltip lines up with its end edge and grows into the card, never past the page's edge.
 */
export function CopyButton({ value, label, onCopied }: { value: string; label: string; onCopied: () => void }) {
  const toast = useToast();
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
    } catch {
      // Clipboard access can be denied; the complete selectable value remains visible.
      toast.error('Copy failed');
    }
  };

  return <IconButton label={label} icon="copy" size="sm" tooltipAlign="end" onClick={handleCopy} />;
}

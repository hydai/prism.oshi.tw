import type { ReactNode } from 'react';
import type { StampPerformance } from '../../../../shared/types';
import { formatTimestamp } from '../../lib/format-timestamp';
import { PlaybackTime } from '../PlaybackTime';
import { Kbd } from '../ui/Display';

type ConsolePerformance = Pick<StampPerformance, 'title' | 'timestamp' | 'endTimestamp'>;

const LABEL_CLASSES = 'text-2xs font-bold uppercase tracking-[0.1em] text-fg-subtle';

function SlotAction({
  label,
  fullLabel,
  kbd,
  onClick,
  primary = false,
}: {
  label: string;
  fullLabel: string;
  /** The exact key, case included: the editor shortcuts are case-sensitive (`e` ≠ `E`). */
  kbd: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={fullLabel}
      // Below lg the actions grow into 44 px touch targets that fill their slot. On the accent
      // gradient the key cap turns white-on-translucent-white (mockup `.sa.g .kbd`, R10): the
      // field-coloured Kbd all but vanishes there in dark mode.
      className={
        primary
          ? 'inline-flex h-6 items-center gap-1.5 rounded-radius-pill bg-accent pl-1 pr-2.5 text-meta font-semibold text-white shadow-primary max-lg:h-11 max-lg:grow max-lg:justify-center [&>kbd]:border-white/35 [&>kbd]:bg-white/20 [&>kbd]:text-white'
          : 'inline-flex h-6 items-center gap-1.5 rounded-radius-pill border border-field-line bg-field pl-1 pr-2.5 text-meta font-semibold text-fg-muted max-lg:h-11 max-lg:grow max-lg:justify-center'
      }
    >
      <Kbd>{kbd}</Kbd>
      {label}
    </button>
  );
}

function Slot({ label, hot = false, actions, children }: { label: string; hot?: boolean; actions: ReactNode; children: ReactNode }) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-radius-md border bg-field px-2.5 py-2 ${
        hot ? 'border-hot-line' : 'border-field-line'
      }`}
    >
      <span className={LABEL_CLASSES}>{label}</span>
      <div className={`font-mono text-[16px] font-semibold ${hot ? 'text-accent-fg' : 'text-fg'}`}>{children}</div>
      {/* Wraps rather than spilling out of a narrow slot (a 1024 px workbench column); on a phone
          both slots stack their actions, so Start and End stay the same shape. */}
      <div className="flex flex-wrap gap-1.5 max-sm:flex-col">{actions}</div>
    </div>
  );
}

/**
 * The Now / Start / End console (spec §5 workbench). Reads only `title`, `timestamp` and
 * `endTimestamp` off the selected performance — never `originalArtist`: `song-table-memo`'s
 * invariant is that only the song tables read it during render, and `tests/workbench.test.tsx`
 * pins this with a performance whose `originalArtist` getter throws.
 */
export function StampConsole({
  performance,
  index,
  onSetStart,
  onMarkEnd,
  onSeekStart,
  onSeekEnd,
}: {
  performance: ConsolePerformance | null;
  index: number;
  onSetStart: () => void;
  onMarkEnd: () => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
}) {
  const isOpen = performance !== null && performance.endTimestamp === null;

  return (
    // Below lg (the stacked, phone layout) Now takes its own line and Start / End share the next.
    <div className="flex items-stretch gap-2.5 px-3.5 py-3 max-lg:flex-wrap">
      <div className="flex min-w-0 flex-[1.25] flex-col justify-center max-lg:basis-full">
        <span className={LABEL_CLASSES}>Now</span>
        <PlaybackTime className="mt-0.5 font-mono text-[28px] font-semibold leading-[1.05] tracking-[-0.02em] text-fg" />
        {performance ? (
          <div className="mt-1 truncate text-token-sm text-fg-muted">
            #{index + 1} <span className="font-[650] text-fg">{performance.title}</span>
          </div>
        ) : null}
      </div>
      <Slot
        label="Start"
        actions={
          <>
            <SlotAction label="Set" fullLabel="Set start" kbd="t" onClick={onSetStart} />
            <SlotAction label="Seek" fullLabel="Seek to start" kbd="s" onClick={onSeekStart} />
          </>
        }
      >
        {performance ? formatTimestamp(performance.timestamp) : '—'}
      </Slot>
      <Slot
        label="End"
        hot={isOpen}
        actions={
          <>
            <SlotAction label="Mark end" fullLabel="Mark end" kbd="m" onClick={onMarkEnd} primary />
            <SlotAction label="Seek" fullLabel="Seek to 5 seconds before end" kbd="e" onClick={onSeekEnd} />
          </>
        }
      >
        {performance?.endTimestamp != null ? formatTimestamp(performance.endTimestamp) : '—'}
      </Slot>
    </div>
  );
}

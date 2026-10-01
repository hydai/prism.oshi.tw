import { useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { StampPerformance } from '../../../../shared/types';
import { formatTimestamp } from '../../lib/format-timestamp';
import { playerClock } from '../../lib/player-clock-store';
import { axisTicks, timelineScale, timelineSegments } from './timeline';

const KIND_COLOR: Record<'stamped' | 'open' | 'selected', string> = {
  stamped: 'bg-accent',
  open: 'bg-tone-warn-fg',
  // bg-nav-active-icon has a value for each theme, so dark mode shows the dark-mode pink. No
  // decorative shadow either: the solid fill is already this kind's own distinct look, so a real
  // :focus-visible ring stays visibly different from it.
  selected: 'bg-nav-active-icon',
};

/**
 * The stream timeline (spec §5 workbench): stamped spans, open-start ticks, the selected row
 * highlighted, an axis, and a playhead that tracks the shared `playerClock` without re-rendering.
 *
 * The playhead is a layout effect that subscribes to `playerClock` and writes `style.transform` on
 * the `data-playhead` element directly (decision R2) — the rendered markup never reads the clock,
 * so two renders taken at different clock times are byte-identical (`tests/workbench.test.tsx`).
 * The same effect sizes the selected-open row's live segment (its start to the playhead), which
 * keeps that element clock-free at render time too.
 */
export function TimelineStrip({
  rows,
  selectedIndex,
  onSeek,
}: {
  rows: StampPerformance[];
  selectedIndex: number;
  onSeek: (seconds: number) => void;
}) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const liveSegmentRef = useRef<HTMLDivElement>(null);
  const scale = timelineScale(rows);
  const segments = timelineSegments(rows, scale, selectedIndex);
  const ticks = axisTicks(scale);

  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : undefined;
  const selectedSegment = selectedIndex >= 0 ? segments[selectedIndex] : undefined;
  const showLiveSegment = selectedRow !== undefined && selectedRow.endTimestamp === null;
  const selectedRowTimestamp = selectedRow?.timestamp ?? 0;

  useLayoutEffect(() => {
    const playhead = playheadRef.current;
    if (!playhead) return undefined;

    const apply = () => {
      const seconds = playerClock.getSnapshot();
      const percent = Math.min(100, Math.max(0, (seconds / scale) * 100));
      // The wrapper spans the full track width, so translating it by a percentage of its own
      // width is exactly a percentage of the track's width — no ResizeObserver needed.
      playhead.style.transform = `translateX(${percent}%)`;

      const live = liveSegmentRef.current;
      if (live) {
        const startPercent = (selectedRowTimestamp / scale) * 100;
        live.style.width = `${Math.max(0, percent - startPercent)}%`;
      }
    };
    apply();
    return playerClock.subscribe(apply);
  }, [scale, selectedRowTimestamp, showLiveSegment]);

  const handleTrackClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Only a click on the track's own background seeks proportionally; a segment button's click
    // (which bubbles here too) already seeked to its own start and must not also fire this.
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * scale);
  };

  return (
    <div role="group" aria-label="Stream timeline" className="flex flex-col">
      {/* Pointer-only scrubbing: each song is reachable via its own button below, and ←/→ seeks the player from anywhere. */}
      {/* react-doctor-disable-next-line react-doctor/no-static-element-interactions */}
      <div
        onClick={handleTrackClick}
        className="relative mx-3.5 mt-3 h-[26px] shrink-0 rounded-radius-md bg-track"
      >
        {segments.map((segment) => {
          const row = rows[segment.index];
          const isTick = segment.widthPct === 0;
          return (
            <button
              key={segment.key}
              type="button"
              aria-label={`Seek to #${segment.index + 1} start`}
              onClick={() => onSeek(row ? row.timestamp : 0)}
              style={{ left: `${segment.leftPct}%`, width: isTick ? undefined : `${segment.widthPct}%` }}
              className={`absolute top-1 bottom-1 rounded-radius-xs ${isTick ? 'w-[3px]' : ''} ${KIND_COLOR[segment.kind]}`}
            />
          );
        })}
        {/* The horizontal clip lives here, not on the track: it only needs to contain the playhead
            (translated by up to 100% of its own width) and the live segment, never a segment
            button — clipping the track itself would also crop a button's :focus-visible ring at
            either edge. */}
        <div className="pointer-events-none absolute inset-0 overflow-x-clip">
          {showLiveSegment && selectedSegment ? (
            <div
              ref={liveSegmentRef}
              aria-hidden="true"
              className="absolute top-1 bottom-1 rounded-radius-xs bg-nav-active-icon"
              style={{ left: `${selectedSegment.leftPct}%`, width: '0%' }}
            />
          ) : null}
          <div ref={playheadRef} data-playhead className="absolute inset-y-0 left-0 w-full">
            <span aria-hidden="true" className="absolute -top-1 -bottom-1 left-0 w-0.5 -translate-x-1/2 rounded-full bg-fg" />
            <span aria-hidden="true" className="absolute -top-[7px] left-0 h-2 w-2 -translate-x-1/2 rounded-full bg-fg" />
          </div>
        </div>
      </div>
      <div className="mx-3.5 mt-1 flex justify-between font-mono text-2xs text-fg-subtle">
        {ticks.map((seconds) => (
          <span key={seconds}>{formatTimestamp(seconds)}</span>
        ))}
      </div>
    </div>
  );
}

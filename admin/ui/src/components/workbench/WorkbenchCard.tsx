import type { Ref, RefObject } from 'react';
import type { StampPerformance } from '../../../../shared/types';
import type { YouTubePlayerHandle } from '../YouTubePlayer';
import { FetchLogPanel, type FetchLogEntry } from '../FetchLogPanel';
import { GlassCard } from '../ui/Display';
import { END_PREVIEW_SECONDS } from '../../hooks/useEditorShortcuts';
import { PlayerPanel } from './PlayerPanel';
import { ShortcutHints } from './ShortcutHints';
import { StampConsole } from './StampConsole';
import { TimelineStrip } from './TimelineStrip';

/**
 * The workbench's left card (spec §5): player, timeline, the Now/Start/End console, the everyday
 * shortcut hints and — once iTunes lookups have run — a fetch-log disclosure. Shared by Stamp
 * Editor and Stream Detail so both stamping pages render the identical card. `ref` reaches the
 * card itself: the Stamp Editor's player box, which its floating pill watches. `tabIndex` /
 * `aria-label` are the Stamp Editor's own (Stream Detail wraps its player box separately and
 * leaves both undefined here), so the pill's focus handoff has somewhere programmatic to land.
 */
export function WorkbenchCard({
  ref,
  tabIndex,
  'aria-label': ariaLabel,
  playerRef,
  videoId,
  rows,
  selectedIndex,
  onSeek,
  onSetStart,
  onMarkEnd,
  onSeekStart,
  seekToEnd,
  onOpenShortcuts,
  fetchLog,
  onClearFetchLog,
}: {
  ref?: Ref<HTMLDivElement>;
  tabIndex?: number;
  'aria-label'?: string;
  playerRef: RefObject<YouTubePlayerHandle | null>;
  videoId: string | undefined;
  rows: StampPerformance[];
  selectedIndex: number;
  onSeek: (seconds: number) => void;
  onSetStart: () => void;
  onMarkEnd: () => void;
  onSeekStart: () => void;
  seekToEnd: (offsetSeconds: number) => void;
  onOpenShortcuts: () => void;
  fetchLog: FetchLogEntry[];
  onClearFetchLog: () => void;
}) {
  return (
    // Clips the player's corners to the card; at lg it scrolls itself if the viewport is too
    // short, so the page never does. The focus ring only ever shows on a page that also sets
    // `tabIndex`; on the other it is unreachable (no tabIndex, not in the Tab order) and inert.
    <GlassCard
      ref={ref}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      padding="none"
      className="flex flex-col overflow-hidden focus-visible:outline-none focus-visible:shadow-focus lg:min-h-0 lg:overflow-y-auto"
    >
      <PlayerPanel playerRef={playerRef} videoId={videoId} />
      <TimelineStrip rows={rows} selectedIndex={selectedIndex} onSeek={onSeek} />
      <StampConsole
        performance={rows[selectedIndex] ?? null}
        index={selectedIndex}
        onSetStart={onSetStart}
        onMarkEnd={onMarkEnd}
        onSeekStart={onSeekStart}
        onSeekEnd={() => seekToEnd(END_PREVIEW_SECONDS)}
      />
      {/* Keyboard-shortcut hints mean nothing without a physical keyboard; hidden below 640px,
          same as the header's "Keyboard shortcuts" button. `mt-auto` moves to this wrapper so
          the row still sticks to the card's bottom edge at >=640px once ShortcutHints sits one
          level deeper (its own `mt-auto` is then a no-op). */}
      <div className="mt-auto max-sm:hidden">
        <ShortcutHints onOpenSheet={onOpenShortcuts} />
      </div>
      {fetchLog.length > 0 ? (
        <details className="shrink-0 border-t border-line-soft px-3.5 py-2.5">
          <summary className="cursor-pointer select-none rounded-radius-xs text-meta font-semibold text-fg-muted">
            iTunes fetch log ({fetchLog.length})
          </summary>
          <FetchLogPanel entries={fetchLog} onClear={onClearFetchLog} />
        </details>
      ) : null}
    </GlassCard>
  );
}

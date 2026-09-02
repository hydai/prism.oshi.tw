import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { StampPerformance } from '../../../shared/types';
import { formatSongList } from '../../../shared/parse';
import { api } from '../api/client';
import { formatTimestamp } from '../lib/format-timestamp';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import type { ShowToast } from './useToast';

export interface UsePerformancesOptions {
  /** The stream being stamped; empty until a page has one. */
  streamId: string | null | undefined;
  /** The page's rows, `null` while its own source of truth has not loaded. */
  performances: StampPerformance[] | null;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  playerRef: RefObject<YouTubePlayerHandle | null>;
  showToast: ShowToast;
  /** Folds one row's update into the page's own state, with no round trip. */
  patchRow: (index: number, updates: Partial<StampPerformance>) => void;
  /** The same, for every row at once. */
  patchAllRows: (updates: Partial<StampPerformance>) => void;
  /** Re-reads the page's own source of truth after a write that changed the row set. */
  reload: () => Promise<void>;
  /** Page-side refresh once stamped counts moved (the stamp editor's stats and sidebar badges). */
  onCountsChanged?: () => void;
  /** Fires the moment a song is created, before the reload — the pages close their modal here. */
  onSongCreated?: () => void;
}

/** Every stamping action both editors perform on a stream's performances. */
export interface PerformanceActions {
  markEndTimestamp: () => Promise<void>;
  markStartTimestamp: () => Promise<void>;
  seekToStart: () => void;
  seekToEnd: (offsetSeconds: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  clearEndTimestamp: (perfId: string, index: number) => Promise<void>;
  clearAllEndTimestamps: () => Promise<void>;
  addSong: (title: string, artist: string) => Promise<void>;
  saveEndTimestamp: (index: number, performance: StampPerformance, endTimestamp: number) => Promise<void>;
  exportSongList: () => void;
}

/**
 * The stamping actions shared by the two editor pages. Each page keeps its own copy of the rows —
 * the stamp editor holds a flat list, the stream page holds them inside its stream detail — and
 * hands this hook the two ways to fold a write back in (`patchRow`, `patchAllRows`) plus the
 * reload for writes that change the row set.
 *
 * Times come from the player itself, not from the clock store: a curator marking the end of a song
 * must get the frame they are hearing, not the one the 500ms poll last saw.
 */
export function usePerformances({
  streamId,
  performances,
  selectedIndex,
  setSelectedIndex,
  playerRef,
  showToast,
  patchRow,
  patchAllRows,
  reload,
  onCountsChanged,
  onSongCreated,
}: UsePerformancesOptions): PerformanceActions {
  const markEndTimestamp = useCallback(async () => {
    const player = playerRef.current;
    if (selectedIndex < 0 || !performances || !player) return;
    const perf = performances[selectedIndex];
    if (!perf) return;
    const currentTime = Math.floor(player.getCurrentTime());

    try {
      await api.updatePerformanceTimestamps(perf.id, { endTimestamp: currentTime });
      patchRow(selectedIndex, { endTimestamp: currentTime });
      showToast(`Marked ${perf.title} → ${formatTimestamp(currentTime)}`);
      onCountsChanged?.();

      // Auto-advance to next unstamped
      const nextIdx = performances.findIndex((p, i) => i > selectedIndex && p.endTimestamp === null);
      if (nextIdx >= 0) setSelectedIndex(nextIdx);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mark timestamp', true);
    }
  }, [performances, selectedIndex, setSelectedIndex, playerRef, showToast, patchRow, onCountsChanged]);

  const markStartTimestamp = useCallback(async () => {
    const player = playerRef.current;
    if (selectedIndex < 0 || !performances || !player) return;
    const perf = performances[selectedIndex];
    if (!perf) return;
    const currentTime = Math.floor(player.getCurrentTime());

    try {
      await api.updatePerformanceTimestamps(perf.id, { timestamp: currentTime });
      patchRow(selectedIndex, { timestamp: currentTime });
      showToast(`Start ${perf.title} → ${formatTimestamp(currentTime)}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mark start', true);
    }
  }, [performances, selectedIndex, playerRef, showToast, patchRow]);

  const seekToStart = useCallback(() => {
    const player = playerRef.current;
    const perf = performances?.[selectedIndex];
    if (!perf || !player) return;
    player.seekTo(perf.timestamp);
    showToast(`Seek start → ${formatTimestamp(perf.timestamp)}`);
  }, [performances, selectedIndex, playerRef, showToast]);

  const seekToEnd = useCallback(
    (offsetSeconds: number) => {
      const player = playerRef.current;
      const perf = performances?.[selectedIndex];
      if (!perf?.endTimestamp || !player) return;
      const target = Math.max(0, perf.endTimestamp - offsetSeconds);
      player.seekTo(target);
      showToast(
        offsetSeconds > 0
          ? `Seek end -${offsetSeconds}s → ${formatTimestamp(target)} (end ${formatTimestamp(perf.endTimestamp)})`
          : `Seek end → ${formatTimestamp(perf.endTimestamp)}`,
      );
    },
    [performances, selectedIndex, playerRef, showToast],
  );

  const selectNext = useCallback(() => {
    if (!performances || performances.length === 0) return;
    setSelectedIndex((i) => Math.min(i + 1, performances.length - 1));
  }, [performances, setSelectedIndex]);

  const selectPrev = useCallback(() => {
    setSelectedIndex((i) => Math.max(i - 1, 0));
  }, [setSelectedIndex]);

  const clearEndTimestamp = useCallback(
    async (perfId: string, index: number) => {
      try {
        await api.updatePerformanceTimestamps(perfId, { endTimestamp: null });
        patchRow(index, { endTimestamp: null });
        showToast('Cleared end timestamp');
        onCountsChanged?.();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to clear', true);
      }
    },
    [showToast, patchRow, onCountsChanged],
  );

  const clearAllEndTimestamps = useCallback(async () => {
    if (!streamId) return;
    if (!confirm('Clear ALL end timestamps for this stream?')) return;

    try {
      const { cleared } = await api.clearAllEndTimestamps(streamId);
      patchAllRows({ endTimestamp: null });
      showToast(`Cleared ${cleared} end timestamps`);
      onCountsChanged?.();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear', true);
    }
  }, [streamId, showToast, patchAllRows, onCountsChanged]);

  const addSong = useCallback(
    async (title: string, artist: string) => {
      const player = playerRef.current;
      if (!streamId || !player) return;
      const timestamp = Math.floor(player.getCurrentTime());

      try {
        await api.createStampPerformance(streamId, {
          title,
          originalArtist: artist || 'Unknown',
          timestamp,
        });
        onSongCreated?.();
        await reload();
        showToast(`Added ${title} at ${formatTimestamp(timestamp)}`);
        onCountsChanged?.();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to add song', true);
      }
    },
    [streamId, playerRef, reload, showToast, onCountsChanged, onSongCreated],
  );

  const saveEndTimestamp = useCallback(
    async (index: number, performance: StampPerformance, endTimestamp: number) => {
      await api.updatePerformanceTimestamps(performance.id, { endTimestamp });
      patchRow(index, { endTimestamp });
    },
    [patchRow],
  );

  const exportSongList = useCallback(() => {
    if (!performances || performances.length === 0) return;
    const text = formatSongList(performances);
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied song list to clipboard'),
      () => showToast('Failed to copy', true),
    );
  }, [performances, showToast]);

  return {
    markEndTimestamp,
    markStartTimestamp,
    seekToStart,
    seekToEnd,
    selectNext,
    selectPrev,
    clearEndTimestamp,
    clearAllEndTimestamps,
    addSong,
    saveEndTimestamp,
    exportSongList,
  };
}

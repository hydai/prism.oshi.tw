import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { playerClock } from '../lib/player-clock-store';
import type { PlayerClockStore } from '../lib/player-clock-store';

export const PLAYER_CLOCK_INTERVAL_MS = 500;

/** The two timer calls the clock makes, injectable so tests can drive ticks by hand. */
export interface ClockTimers {
  setInterval: (run: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
}

const browserTimers: ClockTimers = {
  setInterval: (run, ms) => window.setInterval(run, ms),
  clearInterval: (id) => window.clearInterval(id),
};

/**
 * Zeroes the clock as an editor binds to it, and again as it lets go. Both halves run in the
 * layout phase, so a newly mounted editor paints its own 0:00 instead of one frame of the clock
 * belonging to the editor it replaced. Exported so tests can drive the effect chain by hand.
 */
export function resetPlayerClock(store: PlayerClockStore = playerClock): () => void {
  store.setTime(0);
  return () => store.setTime(0);
}

/** Starts the one poll that feeds the clock; the returned function stops it. */
export function startPlayerClock(
  readCurrentTime: () => number,
  store: PlayerClockStore = playerClock,
  timers: ClockTimers = browserTimers,
): () => void {
  const id = timers.setInterval(() => store.setTime(readCurrentTime()), PLAYER_CLOCK_INTERVAL_MS);
  return () => timers.clearInterval(id);
}

/**
 * Owns the editors' single 500ms poll: the page's player position goes into the shared clock,
 * and only the components that subscribe to it re-render. Call it once per editor page.
 */
export function usePlayerClock(playerRef: RefObject<YouTubePlayerHandle | null>): void {
  // Before paint: a freshly opened editor reads 0:00 until its own first poll lands, as it did
  // when the time was page state.
  useLayoutEffect(() => resetPlayerClock(), [playerRef]);

  // After paint: one interval per mount, stopped on unmount.
  useEffect(
    () => startPlayerClock(() => playerRef.current?.getCurrentTime() ?? 0),
    [playerRef],
  );
}

/** Subscribe to the clock. Only components that display the time may call this. */
export function usePlayerClockTime(): number {
  return useSyncExternalStore(playerClock.subscribe, playerClock.getSnapshot, playerClock.getSnapshot);
}

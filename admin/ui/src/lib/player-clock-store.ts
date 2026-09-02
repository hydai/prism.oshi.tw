export interface PlayerClockStore {
  /** Seconds into the VOD, as of the last poll. A primitive, so the snapshot is always stable. */
  getSnapshot: () => number;
  setTime: (currentTime: number) => void;
  subscribe: (listener: () => void) => () => void;
}

// The stamping pages poll the YouTube player twice a second. Holding that time in React state
// re-rendered the whole editor — every song row included — on every tick. Keeping it in an
// external store (consumed via `useSyncExternalStore`) means only the components that display
// the time re-render, and an idle player wakes nobody at all.
export function createPlayerClockStore(): PlayerClockStore {
  let currentTime = 0;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => currentTime,
    setTime: (next) => {
      if (next === currentTime) return;
      currentTime = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The one clock the editors share; StampEditor and StreamDetail are never mounted together. */
export const playerClock = createPlayerClockStore();

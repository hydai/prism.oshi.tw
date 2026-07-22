export interface PlaybackTimeSnapshot {
  currentTime: number;
  duration: number;
}

export interface PlaybackTimeStore {
  getSnapshot: () => PlaybackTimeSnapshot;
  setTime: (currentTime: number) => void;
  setDuration: (duration: number) => void;
  subscribe: (listener: () => void) => () => void;
}

// Playback time ticks ~2×/sec while playing. Keeping it in an external store
// (consumed via useSyncExternalStore) means only the few components that
// display time re-render on tick, instead of every PlayerContext consumer.
export function createPlaybackTimeStore(): PlaybackTimeStore {
  let snapshot: PlaybackTimeSnapshot = { currentTime: 0, duration: 0 };
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    setTime: (currentTime) => {
      if (currentTime === snapshot.currentTime) return;
      snapshot = { ...snapshot, currentTime };
      notify();
    },
    setDuration: (duration) => {
      if (duration === snapshot.duration) return;
      snapshot = { ...snapshot, duration };
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

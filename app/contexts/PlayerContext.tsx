'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createPlayerStore,
  type PlayerActions,
  type PlayerState,
  type PlayerStore,
  type QueueEntry,
  type RepeatMode,
  type Track,
} from '../lib/player-store';
import { usePersistedStore } from '../lib/persisted-store';

export type { Track, QueueEntry, RepeatMode };

const PlayerStoreContext = createContext<PlayerStore | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  // Lazy state initializer: one store per provider mount, never rebuilt.
  const [store] = useState(createPlayerStore);

  // Prefetch the YouTube API once the browser is idle so the first play is
  // instant, without competing with the initial page load for connections.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const prefetch = () => store.actions.ensurePlayerApi();
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(prefetch, { timeout: 8000 });
    } else {
      timerId = setTimeout(prefetch, 2500);
    }
    return () => {
      if (idleId !== null) w.cancelIdleCallback?.(idleId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [store]);

  // Release the iframe player and poll timer with the provider. The store
  // survives (StrictMode remounts reuse it) — the next play recreates both.
  useEffect(() => () => store.destroy(), [store]);

  return <PlayerStoreContext.Provider value={store}>{children}</PlayerStoreContext.Provider>;
}

export function usePlayerStore(): PlayerStore {
  const store = useContext(PlayerStoreContext);
  if (!store) {
    throw new Error('player hooks must be used within a PlayerProvider');
  }
  return store;
}

// Subscribe to ONE field of the player state. Selectors must return a value
// stored in the snapshot (primitive or immutably-replaced reference) — never
// construct objects here, or every render loops.
function usePlayerField<T>(selector: (state: PlayerState) => T): T {
  const store = usePlayerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getServerSnapshot()),
  );
}

/** Every player action. Stable identities — subscribing components never re-render from this hook. */
export function usePlayerActions(): PlayerActions {
  return usePlayerStore().actions;
}

export function useCurrentTrack(): Track | null {
  return usePlayerField((s) => s.currentTrack);
}

export function useQueue(): QueueEntry[] {
  return usePlayerField((s) => s.queue);
}

export function useTransport(): { isPlaying: boolean; repeatMode: RepeatMode; shuffleOn: boolean } {
  const isPlaying = usePlayerField((s) => s.isPlaying);
  const repeatMode = usePlayerField((s) => s.repeatMode);
  const shuffleOn = usePlayerField((s) => s.shuffleOn);
  return { isPlaying, repeatMode, shuffleOn };
}

export function usePlayerStatus(): {
  isPlayerReady: boolean;
  playerError: string | null;
  apiLoadError: string | null;
  unavailableVideoIds: Set<string>;
} {
  const isPlayerReady = usePlayerField((s) => s.isPlayerReady);
  const playerError = usePlayerField((s) => s.playerError);
  const apiLoadError = usePlayerField((s) => s.apiLoadError);
  const unavailableVideoIds = usePlayerField((s) => s.unavailableVideoIds);
  return { isPlayerReady, playerError, apiLoadError, unavailableVideoIds };
}

export function usePlayerNotices(): { timestampWarning: string | null; skipNotification: string | null } {
  const timestampWarning = usePlayerField((s) => s.timestampWarning);
  const skipNotification = usePlayerField((s) => s.skipNotification);
  return { timestampWarning, skipNotification };
}

export function useOverlays(): { showModal: boolean; showQueue: boolean } {
  const showModal = usePlayerField((s) => s.showModal);
  const showQueue = usePlayerField((s) => s.showQueue);
  return { showModal, showQueue };
}

export function useVolume(): { volume: number; isMuted: boolean } {
  const store = usePlayerStore();
  const volume = usePersistedStore(store.volumeStore);
  const isMuted = usePersistedStore(store.mutedStore);
  return { volume, isMuted };
}

// Playback clock for components that display time/progress. Subscribing here
// re-renders only those components on the 500ms tick.
export function usePlaybackTime() {
  const store = usePlayerStore();
  const currentTrack = useCurrentTrack();
  const { currentTime, duration } = useSyncExternalStore(
    store.timeStore.subscribe,
    store.timeStore.getSnapshot,
    store.timeStore.getSnapshot,
  );
  const trackCurrentTime = currentTrack ? Math.max(0, currentTime - currentTrack.timestamp) : 0;
  const trackDuration =
    currentTrack?.endTimestamp != null ? currentTrack.endTimestamp - currentTrack.timestamp : null;
  return { currentTime, duration, trackCurrentTime, trackDuration };
}

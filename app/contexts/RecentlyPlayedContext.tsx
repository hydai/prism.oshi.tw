'use client';

import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import type { PerformanceRef } from '../types/archive';
import { pickPerformanceRef } from '../lib/archive';
import { normalizeStoredRef } from '../lib/normalize-performance-ref';
import { createPersistedStore, usePersistedStore } from '../lib/persisted-store';
import type { StorageSaveResult } from '../lib/playlist-storage';

export type RecentPlay = PerformanceRef & { playedAt: number };

interface RecentlyPlayedContextType {
  recentPlays: RecentPlay[];
  addRecentPlay: (play: PerformanceRef) => void;
  clearHistory: () => Promise<StorageSaveResult>;
  recentCount: number;
}

const RecentlyPlayedContext = createContext<RecentlyPlayedContextType | undefined>(undefined);

export const useRecentlyPlayed = () => {
  const context = useContext(RecentlyPlayedContext);
  if (!context) {
    throw new Error('useRecentlyPlayed must be used within a RecentlyPlayedProvider');
  }
  return context;
};

const MAX_ENTRIES = 50;

function parseRecentPlays(raw: unknown, streamerSlug: string): RecentPlay[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const ref = normalizeStoredRef(entry, streamerSlug);
    const playedAt = (entry as { playedAt?: unknown } | null)?.playedAt;
    return ref && typeof playedAt === 'number' ? [{ ...ref, playedAt }] : [];
  });
}

export const RecentlyPlayedProvider = ({ streamerSlug, children }: { streamerSlug: string; children: ReactNode }) => {
  const store = useMemo(
    () => createPersistedStore<RecentPlay[]>({
      key: `prism_${streamerSlug}_recently_played`,
      fallback: [],
      parse: (raw) => parseRecentPlays(raw, streamerSlug),
    }),
    [streamerSlug],
  );
  const recentPlays = usePersistedStore(store);

  // Functional update on the store's current value, so two rapid calls in
  // the same tick can't drop each other's entry (no ref mirror needed).
  const addRecentPlay = useCallback((play: PerformanceRef) => {
    store.updateExclusive((prev) => {
      const filtered = prev.filter((r) => r.performanceId !== play.performanceId);
      return [{ ...pickPerformanceRef(play), playedAt: Date.now() }, ...filtered].slice(0, MAX_ENTRIES);
    });
  }, [store]);

  const clearHistory = useCallback(() => { return store.updateExclusive(() => []); }, [store]);

  const value = useMemo(
    () => ({ recentPlays, addRecentPlay, clearHistory, recentCount: recentPlays.length }),
    [recentPlays, addRecentPlay, clearHistory],
  );

  return <RecentlyPlayedContext.Provider value={value}>{children}</RecentlyPlayedContext.Provider>;
};

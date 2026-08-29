'use client';

import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import type { PerformanceRef } from '../types/archive';
import { pickPerformanceRef } from '../lib/archive';
import { normalizeStoredRef } from '../lib/normalize-performance-ref';
import { createPersistedStore, usePersistedStore } from '../lib/persisted-store';
import type { StorageSaveResult } from '../lib/playlist-storage';

export type LikedVersion = PerformanceRef & { likedAt: number };

interface LikedSongsContextType {
  likedSongs: LikedVersion[];
  isLiked: (performanceId: string) => boolean;
  toggleLike: (version: PerformanceRef) => StorageSaveResult;
  likedCount: number;
}

const LikedSongsContext = createContext<LikedSongsContextType | undefined>(undefined);

export const useLikedSongs = () => {
  const context = useContext(LikedSongsContext);
  if (!context) {
    throw new Error('useLikedSongs must be used within a LikedSongsProvider');
  }
  return context;
};

function parseLikedSongs(raw: unknown, streamerSlug: string): LikedVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const ref = normalizeStoredRef(entry, streamerSlug);
    const likedAt = (entry as { likedAt?: unknown } | null)?.likedAt;
    return ref && typeof likedAt === 'number' ? [{ ...ref, likedAt }] : [];
  });
}

export const LikedSongsProvider = ({ streamerSlug, children }: { streamerSlug: string; children: ReactNode }) => {
  // One store per storage key; re-created only if the slug changes.
  const store = useMemo(
    () => createPersistedStore<LikedVersion[]>({
      key: `prism_${streamerSlug}_liked_songs`,
      fallback: [],
      parse: (raw) => parseLikedSongs(raw, streamerSlug),
    }),
    [streamerSlug],
  );
  const likedSongs = usePersistedStore(store);

  // O(1) lookups — isLiked is called for every visible row.
  const likedIds = useMemo(() => new Set(likedSongs.map((s) => s.performanceId)), [likedSongs]);
  const isLiked = useCallback((performanceId: string) => likedIds.has(performanceId), [likedIds]);

  const toggleLike = useCallback((version: PerformanceRef) => {
    return store.update((prev) => {
      const exists = prev.some((s) => s.performanceId === version.performanceId);
      return exists
        ? prev.filter((s) => s.performanceId !== version.performanceId)
        : [{ ...pickPerformanceRef(version), likedAt: Date.now() }, ...prev];
    });
  }, [store]);

  const value = useMemo(
    () => ({ likedSongs, isLiked, toggleLike, likedCount: likedSongs.length }),
    [likedSongs, isLiked, toggleLike],
  );

  return <LikedSongsContext.Provider value={value}>{children}</LikedSongsContext.Provider>;
};

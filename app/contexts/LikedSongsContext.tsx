'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';

export interface LikedVersion {
  performanceId: string;
  songTitle: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  albumArtUrl?: string;
  likedAt: number;
}

interface LikedSongsContextType {
  likedSongs: LikedVersion[];
  isLiked: (performanceId: string) => boolean;
  toggleLike: (version: Omit<LikedVersion, 'likedAt'>) => void;
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

const LEGACY_STORAGE_KEY = 'mizukiprism_liked_songs';

function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__prism_ls_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export const LikedSongsProvider = ({ streamerSlug, children }: { streamerSlug: string; children: ReactNode }) => {
  const STORAGE_KEY = `prism_${streamerSlug}_liked_songs`;
  const [likedSongs, setLikedSongs] = useState<LikedVersion[]>([]);
  const [localStorageSupported] = useState(() =>
    typeof window !== 'undefined' ? isLocalStorageAvailable() : true
  );

  // Migrate legacy key for Mizuki users
  useEffect(() => {
    if (streamerSlug !== 'mizuki') return;
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy && !localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O(1) lookups — isLiked is called for every visible row (several times per
  // performance in expanded cards)
  const likedIds = useMemo(
    () => new Set(likedSongs.map(s => s.performanceId)),
    [likedSongs],
  );
  const isLiked = useCallback(
    (performanceId: string): boolean => likedIds.has(performanceId),
    [likedIds],
  );

  const toggleLike = useCallback((version: Omit<LikedVersion, 'likedAt'>) => {
    if (!localStorageSupported) return;

    // Compute outside the updater — updaters must stay pure (StrictMode
    // invokes them twice, which double-wrote localStorage here before)
    setLikedSongs(prev => {
      const exists = prev.some(s => s.performanceId === version.performanceId);
      return exists
        ? prev.filter(s => s.performanceId !== version.performanceId)
        : [{ ...version, likedAt: Date.now() }, ...prev];
    });
  }, [localStorageSupported]);

  // Persist on change (skips the initial empty render via likedLoaded flag)
  const [likedLoaded, setLikedLoaded] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setLikedSongs(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load liked songs from localStorage:', error);
    }
    setLikedLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!likedLoaded || !localStorageSupported) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(likedSongs)); } catch {}
  }, [likedSongs, likedLoaded, localStorageSupported, STORAGE_KEY]);

  const value = useMemo(
    () => ({
      likedSongs,
      isLiked,
      toggleLike,
      likedCount: likedSongs.length,
    }),
    [likedSongs, isLiked, toggleLike],
  );

  return (
    <LikedSongsContext.Provider value={value}>
      {children}
    </LikedSongsContext.Provider>
  );
};

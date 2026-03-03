'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface RecentPlay {
  performanceId: string;
  songTitle: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  albumArtUrl?: string;
  playedAt: number;
}

interface RecentlyPlayedContextType {
  recentPlays: RecentPlay[];
  addRecentPlay: (play: Omit<RecentPlay, 'playedAt'>) => void;
  clearHistory: () => void;
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

const STORAGE_KEY = 'mizukiprism_recently_played';
const MAX_ENTRIES = 50;

function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__mizukiprism_ls_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export const RecentlyPlayedProvider = ({ children }: { children: ReactNode }) => {
  const [recentPlays, setRecentPlays] = useState<RecentPlay[]>([]);
  const [localStorageSupported] = useState(() =>
    typeof window !== 'undefined' ? isLocalStorageAvailable() : true
  );

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setRecentPlays(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load recently played from localStorage:', error);
    }
  }, []);

  const saveToLocalStorage = (plays: RecentPlay[]): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plays));
      return true;
    } catch {
      return false;
    }
  };

  const addRecentPlay = (play: Omit<RecentPlay, 'playedAt'>) => {
    if (!localStorageSupported) return;

    // Dedup: remove old entry for same performanceId, prepend new
    const filtered = recentPlays.filter(r => r.performanceId !== play.performanceId);
    const newPlays = [{ ...play, playedAt: Date.now() }, ...filtered].slice(0, MAX_ENTRIES);

    const saved = saveToLocalStorage(newPlays);
    if (saved) {
      setRecentPlays(newPlays);
    }
  };

  const clearHistory = () => {
    saveToLocalStorage([]);
    setRecentPlays([]);
  };

  return (
    <RecentlyPlayedContext.Provider
      value={{
        recentPlays,
        addRecentPlay,
        clearHistory,
        recentCount: recentPlays.length,
      }}
    >
      {children}
    </RecentlyPlayedContext.Provider>
  );
};

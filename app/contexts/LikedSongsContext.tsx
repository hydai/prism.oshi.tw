'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

const STORAGE_KEY = 'mizukiprism_liked_songs';

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

export const LikedSongsProvider = ({ children }: { children: ReactNode }) => {
  const [likedSongs, setLikedSongs] = useState<LikedVersion[]>([]);
  const [localStorageSupported] = useState(() =>
    typeof window !== 'undefined' ? isLocalStorageAvailable() : true
  );

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setLikedSongs(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load liked songs from localStorage:', error);
    }
  }, []);

  const saveToLocalStorage = (songs: LikedVersion[]): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
      return true;
    } catch {
      return false;
    }
  };

  const isLiked = (performanceId: string): boolean => {
    return likedSongs.some(s => s.performanceId === performanceId);
  };

  const toggleLike = (version: Omit<LikedVersion, 'likedAt'>) => {
    if (!localStorageSupported) return;

    const exists = likedSongs.some(s => s.performanceId === version.performanceId);
    let newSongs: LikedVersion[];

    if (exists) {
      newSongs = likedSongs.filter(s => s.performanceId !== version.performanceId);
    } else {
      newSongs = [{ ...version, likedAt: Date.now() }, ...likedSongs];
    }

    const saved = saveToLocalStorage(newSongs);
    if (saved) {
      setLikedSongs(newSongs);
    }
  };

  return (
    <LikedSongsContext.Provider
      value={{
        likedSongs,
        isLiked,
        toggleLike,
        likedCount: likedSongs.length,
      }}
    >
      {children}
    </LikedSongsContext.Provider>
  );
};

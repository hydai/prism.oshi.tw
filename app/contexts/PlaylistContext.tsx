'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ALL_STREAMER_SLUGS } from '../../lib/streamer-slugs';

export interface PlaylistVersion {
  performanceId: string;
  songTitle: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  streamerSlug: string;
}

export interface Playlist {
  id: string;
  name: string;
  versions: PlaylistVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistExportEnvelope {
  version: 1 | 2;
  exportedAt: string;
  source: 'Prism';
  playlists: Playlist[];
}

interface PlaylistContextType {
  playlists: Playlist[];
  createPlaylist: (name: string) => { success: boolean; error?: string };
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, newName: string) => { success: boolean; error?: string };
  addVersionToPlaylist: (playlistId: string, version: PlaylistVersion) => { success: boolean; error?: string };
  removeVersionFromPlaylist: (playlistId: string, performanceId: string) => void;
  reorderVersionsInPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;
  storageError: string | null;
  clearStorageError: () => void;
  exportAll: () => void;
  exportSingle: (playlistId: string) => void;
  importPlaylists: (file: File) => Promise<{ success: boolean; count?: number; error?: string }>;
}

const PlaylistContext = createContext<PlaylistContextType | undefined>(undefined);

export const usePlaylist = () => {
  const context = useContext(PlaylistContext);
  if (!context) {
    throw new Error('usePlaylist must be used within a PlaylistProvider');
  }
  return context;
};

const LEGACY_STORAGE_KEY = 'mizukiprism_playlists';
const STORAGE_QUOTA_ERROR = '本機儲存空間不足';
const STORAGE_UNSUPPORTED_ERROR = '您的瀏覽器不支援本機儲存，播放清單功能無法使用';

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

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadJson(data: PlaylistExportEnvelope, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildEnvelope(playlists: Playlist[]): PlaylistExportEnvelope {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    source: 'Prism',
    playlists,
  };
}

function validateImport(data: unknown): { valid: true; playlists: Playlist[] } | { valid: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: '檔案格式無效' };
  }

  const envelope = data as Record<string, unknown>;

  if (envelope.source !== 'Prism' && envelope.source !== 'MizukiPrism') {
    return { valid: false, error: '非 Prism 匯出檔案' };
  }

  if (envelope.version !== 1 && envelope.version !== 2) {
    return { valid: false, error: '檔案版本不支援' };
  }

  const importVersion = envelope.version as 1 | 2;

  if (!Array.isArray(envelope.playlists) || envelope.playlists.length === 0) {
    return { valid: false, error: '檔案不含播放清單' };
  }

  const validPlaylists: Playlist[] = [];
  for (const p of envelope.playlists) {
    if (
      typeof p.id === 'string' &&
      typeof p.name === 'string' &&
      Array.isArray(p.versions) &&
      typeof p.createdAt === 'number' &&
      typeof p.updatedAt === 'number'
    ) {
      // For v1 imports, inject default streamerSlug into versions
      const versions = importVersion === 1
        ? p.versions.map((v: any) => ({ ...v, streamerSlug: v.streamerSlug || 'mizuki' }))
        : p.versions;
      validPlaylists.push({
        id: p.id,
        name: p.name,
        versions,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }
  }

  if (validPlaylists.length === 0) {
    return { valid: false, error: '檔案不含有效的播放清單' };
  }

  return { valid: true, playlists: validPlaylists };
}

export const PlaylistProvider = ({ children }: { children: ReactNode }) => {
  const STORAGE_KEY = 'prism_playlists';
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [localStorageSupported] = useState(() =>
    typeof window !== 'undefined' ? isLocalStorageAvailable() : true
  );

  // Migrate legacy per-streamer playlists to global storage
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== null) return; // already migrated
      const merged: Playlist[] = [];
      // Try legacy Mizuki key first
      const legacyMizuki = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyMizuki) {
        try {
          const parsed = JSON.parse(legacyMizuki) as Playlist[];
          for (const p of parsed) {
            merged.push({
              ...p,
              versions: p.versions.map(v => ({ ...v, streamerSlug: (v as any).streamerSlug || 'mizuki' })),
              updatedAt: p.updatedAt || p.createdAt || Date.now(),
            });
          }
        } catch {}
      }
      // Then check all per-streamer keys
      for (const slug of ALL_STREAMER_SLUGS) {
        const key = `prism_${slug}_playlists`;
        const data = localStorage.getItem(key);
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as Playlist[];
          for (const p of parsed) {
            // Avoid duplicates by ID
            if (merged.some(m => m.id === p.id)) continue;
            merged.push({
              ...p,
              versions: p.versions.map(v => ({ ...v, streamerSlug: (v as any).streamerSlug || slug })),
              updatedAt: p.updatedAt || p.createdAt || Date.now(),
            });
          }
        } catch {}
      }
      if (merged.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load playlists from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const normalized = parsed.map((p: any) => ({
          ...p,
          updatedAt: p.updatedAt || p.createdAt || Date.now(),
        }));
        setPlaylists(normalized);
      }
    } catch (error) {
      console.error('Failed to load playlists from localStorage:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveToLocalStorage = (newPlaylists: Playlist[]): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPlaylists));
      setStorageError(null);
      return true;
    } catch (error: any) {
      const isQuotaError = error?.name === 'QuotaExceededError' || error?.code === 22;
      setStorageError(isQuotaError ? STORAGE_QUOTA_ERROR : STORAGE_QUOTA_ERROR);
      return false;
    }
  };

  const createPlaylist = (name: string): { success: boolean; error?: string } => {
    if (!localStorageSupported) {
      setStorageError(STORAGE_UNSUPPORTED_ERROR);
      return { success: false, error: STORAGE_UNSUPPORTED_ERROR };
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: '播放清單名稱不可為空' };
    }

    const now = Date.now();
    const newPlaylist: Playlist = {
      id: `playlist-${now}-${Math.random().toString(36).substr(2, 9)}`,
      name: trimmedName,
      versions: [],
      createdAt: now,
      updatedAt: now,
    };

    const newPlaylists = [...playlists, newPlaylist];
    const saved = saveToLocalStorage(newPlaylists);

    if (saved) {
      setPlaylists(newPlaylists);
      return { success: true };
    }
    return { success: false, error: STORAGE_QUOTA_ERROR };
  };

  const deletePlaylist = (id: string) => {
    const newPlaylists = playlists.filter(p => p.id !== id);
    saveToLocalStorage(newPlaylists);
    setPlaylists(newPlaylists);
  };

  const renamePlaylist = (id: string, newName: string): { success: boolean; error?: string } => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      return { success: false, error: '播放清單名稱不可為空' };
    }

    const now = Date.now();
    const newPlaylists = playlists.map(p =>
      p.id === id ? { ...p, name: trimmedName, updatedAt: now } : p
    );

    const saved = saveToLocalStorage(newPlaylists);
    if (saved) {
      setPlaylists(newPlaylists);
      return { success: true };
    }
    return { success: false, error: STORAGE_QUOTA_ERROR };
  };

  const addVersionToPlaylist = (playlistId: string, version: PlaylistVersion): { success: boolean; error?: string } => {
    if (!localStorageSupported) {
      setStorageError(STORAGE_UNSUPPORTED_ERROR);
      return { success: false, error: STORAGE_UNSUPPORTED_ERROR };
    }

    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) {
      return { success: false, error: '播放清單不存在' };
    }

    const exists = playlist.versions.some(v => v.performanceId === version.performanceId);
    if (exists) {
      return { success: false, error: '此版本已在播放清單中' };
    }

    const now = Date.now();
    const newPlaylists = playlists.map(p =>
      p.id === playlistId
        ? { ...p, versions: [...p.versions, version], updatedAt: now }
        : p
    );

    const saved = saveToLocalStorage(newPlaylists);
    if (saved) {
      setPlaylists(newPlaylists);
      return { success: true };
    }
    return { success: false, error: STORAGE_QUOTA_ERROR };
  };

  const removeVersionFromPlaylist = (playlistId: string, performanceId: string) => {
    const now = Date.now();
    const newPlaylists = playlists.map(p =>
      p.id === playlistId
        ? { ...p, versions: p.versions.filter(v => v.performanceId !== performanceId), updatedAt: now }
        : p
    );
    saveToLocalStorage(newPlaylists);
    setPlaylists(newPlaylists);
  };

  const reorderVersionsInPlaylist = (playlistId: string, fromIndex: number, toIndex: number) => {
    const now = Date.now();
    const newPlaylists = playlists.map(p => {
      if (p.id === playlistId) {
        const newVersions = [...p.versions];
        const [removed] = newVersions.splice(fromIndex, 1);
        newVersions.splice(toIndex, 0, removed);
        return { ...p, versions: newVersions, updatedAt: now };
      }
      return p;
    });
    saveToLocalStorage(newPlaylists);
    setPlaylists(newPlaylists);
  };

  const clearStorageError = () => setStorageError(null);

  const exportAll = () => {
    if (playlists.length === 0) return;
    downloadJson(buildEnvelope(playlists), `prism-playlists-${formatDate()}.json`);
  };

  const exportSingle = (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    downloadJson(buildEnvelope([playlist]), `prism-${playlist.name}-${formatDate()}.json`);
  };

  const importPlaylists = async (file: File): Promise<{ success: boolean; count?: number; error?: string }> => {
    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return { success: false, error: '無法匯入：檔案格式無效' };
      }

      const result = validateImport(data);
      if (!result.valid) {
        return { success: false, error: `無法匯入：${result.error}` };
      }

      const incoming = result.playlists;
      const localMap = new Map(playlists.map(p => [p.id, p]));
      const merged: Playlist[] = [...playlists];

      for (const imported of incoming) {
        const existing = localMap.get(imported.id);
        if (!existing) {
          // No conflict — add directly
          merged.push(imported);
        } else if (imported.updatedAt > existing.updatedAt) {
          // Imported is newer — replace existing, keep old as renamed copy
          const idx = merged.findIndex(p => p.id === existing.id);
          merged[idx] = imported;
          merged.push({
            ...existing,
            id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: `${existing.name}（匯入）`,
          });
        } else {
          // Existing is newer or same — keep existing, add imported as renamed copy
          merged.push({
            ...imported,
            id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: `${imported.name}（匯入）`,
          });
        }
      }

      const saved = saveToLocalStorage(merged);
      if (!saved) {
        return { success: false, error: '本機儲存空間不足' };
      }

      setPlaylists(merged);
      return { success: true, count: incoming.length };
    } catch {
      return { success: false, error: '無法匯入：檔案格式無效' };
    }
  };

  return (
    <PlaylistContext.Provider
      value={{
        playlists,
        createPlaylist,
        deletePlaylist,
        renamePlaylist,
        addVersionToPlaylist,
        removeVersionFromPlaylist,
        reorderVersionsInPlaylist,
        storageError,
        clearStorageError,
        exportAll,
        exportSingle,
        importPlaylists,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
};

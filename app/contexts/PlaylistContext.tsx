'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import {
  dedupePlaylistVersions,
  type StorageSaveResult,
} from '../lib/playlist-storage';
import type { PerformanceRef } from '../types/archive';
import { normalizeStoredRef } from '../lib/normalize-performance-ref';
import { pickPerformanceRef } from '../lib/archive';
import { createPersistedStore, usePersistedStore } from '../lib/persisted-store';

export type PlaylistVersion = PerformanceRef;

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

const STORAGE_UNSUPPORTED_ERROR = '您的瀏覽器不支援本機儲存，播放清單功能無法使用';

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

function validateImport(data: unknown, streamerSlug: string): { valid: true; playlists: Playlist[] } | { valid: false; error: string } {
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
  for (const item of envelope.playlists as unknown[]) {
    const p = item as Partial<Playlist>;
    if (
      typeof p.id === 'string' &&
      typeof p.name === 'string' &&
      Array.isArray(p.versions) &&
      typeof p.createdAt === 'number' &&
      typeof p.updatedAt === 'number'
    ) {
      // For v1 imports, inject default streamerSlug into versions
      const versions = importVersion === 1
        ? p.versions.flatMap((version) => { const ref = normalizeStoredRef(version, 'mizuki'); return ref ? [ref] : []; })
        : p.versions.flatMap((version) => { const ref = normalizeStoredRef(version, streamerSlug); return ref ? [ref] : []; });
      validPlaylists.push({
        id: p.id,
        name: p.name,
        versions: dedupePlaylistVersions(versions),
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

function parsePlaylists(raw: unknown, streamerSlug: string): Playlist[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const p = item as Partial<Playlist> | null;
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return [];
    const versions = dedupePlaylistVersions((p.versions ?? []).flatMap((v) => {
      const ref = normalizeStoredRef(v, streamerSlug);
      return ref ? [ref] : [];
    }));
    const createdAt = typeof p.createdAt === 'number' ? p.createdAt : Date.now();
    return [{ id: p.id, name: p.name, versions, createdAt, updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : createdAt }];
  });
}

function newPlaylistId(): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  return `playlist-${uuid}`;
}

export const PlaylistProvider = ({ streamerSlug, children }: { streamerSlug: string; children: ReactNode }) => {
  const store = useMemo(
    () => createPersistedStore<Playlist[]>({ key: `prism_${streamerSlug}_playlists`, fallback: [], parse: (raw) => parsePlaylists(raw, streamerSlug) }),
    [streamerSlug],
  );
  const playlists = usePersistedStore(store);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Every mutation goes through here: functional update, persisted before
  // listeners fire, storage errors surfaced once.
  const commit = useCallback((updater: (prev: Playlist[]) => Playlist[]): StorageSaveResult => {
    const result = store.update(updater);
    setStorageError(result.success ? null : result.error);
    return result;
  }, [store]);

  const createPlaylist = useCallback((name: string) => {
    if (!store.available) { setStorageError(STORAGE_UNSUPPORTED_ERROR); return { success: false, error: STORAGE_UNSUPPORTED_ERROR }; }
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: '播放清單名稱不可為空' };
    const now = Date.now();
    return commit((prev) => [...prev, { id: newPlaylistId(), name: trimmedName, versions: [], createdAt: now, updatedAt: now }]);
  }, [store, commit]);

  const deletePlaylist = useCallback((id: string) => { commit((prev) => prev.filter((p) => p.id !== id)); }, [commit]);

  const renamePlaylist = useCallback((id: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) return { success: false, error: '播放清單名稱不可為空' };
    const now = Date.now();
    return commit((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmedName, updatedAt: now } : p)));
  }, [commit]);

  const addVersionToPlaylist = useCallback((playlistId: string, version: PlaylistVersion) => {
    if (!store.available) { setStorageError(STORAGE_UNSUPPORTED_ERROR); return { success: false, error: STORAGE_UNSUPPORTED_ERROR }; }

    // Validate against the store's live snapshot (not the `playlists` render
    // closure) so this sees an add from earlier in the same tick. Nothing
    // async runs between this read and the commit() below, so the updater
    // it runs sees the exact same state — keeps the updater itself pure.
    const current = store.getSnapshot();
    const playlist = current.find((p) => p.id === playlistId);
    if (!playlist) {
      return { success: false, error: '播放清單不存在' };
    }
    const exists = playlist.versions.some((v) => v.performanceId === version.performanceId);
    if (exists) {
      return { success: false, error: '此版本已在播放清單中' };
    }

    const now = Date.now();
    return commit((prev) => prev.map((p) =>
      p.id === playlistId
        ? { ...p, versions: [...p.versions, pickPerformanceRef(version)], updatedAt: now }
        : p
    ));
  }, [store, commit]);

  const removeVersionFromPlaylist = useCallback((playlistId: string, performanceId: string) => {
    const now = Date.now();
    commit((prev) => prev.map((p) =>
      p.id === playlistId
        ? { ...p, versions: p.versions.filter((v) => v.performanceId !== performanceId), updatedAt: now }
        : p
    ));
  }, [commit]);

  const reorderVersionsInPlaylist = useCallback((playlistId: string, fromIndex: number, toIndex: number) => {
    const now = Date.now();
    commit((prev) => prev.map((p) => {
      if (p.id !== playlistId) return p;
      const newVersions = [...p.versions];
      const [removed] = newVersions.splice(fromIndex, 1);
      newVersions.splice(toIndex, 0, removed);
      return { ...p, versions: newVersions, updatedAt: now };
    }));
  }, [commit]);

  const clearStorageError = useCallback(() => setStorageError(null), []);

  const exportAll = useCallback(() => {
    if (playlists.length === 0) return;
    downloadJson(buildEnvelope(playlists), `prism-playlists-${formatDate()}.json`);
  }, [playlists]);

  const exportSingle = useCallback((playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    downloadJson(buildEnvelope([playlist]), `prism-${playlist.name}-${formatDate()}.json`);
  }, [playlists]);

  const importPlaylists = useCallback(async (file: File): Promise<{ success: boolean; count?: number; error?: string }> => {
    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return { success: false, error: '無法匯入：檔案格式無效' };
      }

      const result = validateImport(data, streamerSlug);
      if (!result.valid) {
        return { success: false, error: `無法匯入：${result.error}` };
      }

      const incoming = result.playlists;
      const saved = commit((prev) => {
        const localMap = new Map(prev.map(p => [p.id, p]));
        const merged: Playlist[] = [...prev];

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
              id: newPlaylistId(),
              name: `${existing.name}（匯入）`,
            });
          } else {
            // Existing is newer or same — keep existing, add imported as renamed copy
            merged.push({
              ...imported,
              id: newPlaylistId(),
              name: `${imported.name}（匯入）`,
            });
          }
        }

        return merged;
      });

      if (!saved.success) {
        return saved;
      }

      return { success: true, count: incoming.length };
    } catch {
      return { success: false, error: '無法匯入：檔案格式無效' };
    }
  }, [commit, streamerSlug]);

  const value = useMemo<PlaylistContextType>(() => ({
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
  }), [
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
  ]);

  return (
    <PlaylistContext.Provider value={value}>
      {children}
    </PlaylistContext.Provider>
  );
};

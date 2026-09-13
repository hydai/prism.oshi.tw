import { dedupePlaylistVersions } from './playlist-storage';
import { normalizeStoredRef } from './normalize-performance-ref';
import type { PerformanceRef } from '../types/archive';

export type PlaylistVersion = PerformanceRef;

export interface Playlist {
  id: string;
  name: string;
  versions: PlaylistVersion[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Export file. v1 files came from MizukiPrism (single streamer, entries
 * without streamerSlug); v2 is the current multi-streamer format. Optional
 * fields (workId) are additive and never bump the version — a bump is only
 * for a change in what an existing field means.
 */
export interface PlaylistExportEnvelope {
  version: 1 | 2;
  exportedAt: string;
  source: 'Prism';
  playlists: Playlist[];
}

export type ImportValidation =
  | { valid: true; playlists: Playlist[] }
  | { valid: false; error: string };

export function buildEnvelope(playlists: Playlist[], now: Date = new Date()): PlaylistExportEnvelope {
  return {
    version: 2,
    exportedAt: now.toISOString(),
    source: 'Prism',
    playlists,
  };
}

export function validateImport(data: unknown, streamerSlug: string): ImportValidation {
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

export function parsePlaylists(raw: unknown, streamerSlug: string): Playlist[] {
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

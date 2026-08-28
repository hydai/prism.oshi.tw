import type { PerformanceRef } from '../types/archive';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Turns a persisted liked/recent/playlist entry into a PerformanceRef.
 * Older entries lack songId (the panels used to store the performanceId in
 * its place), lack streamerSlug (the storage key already scoped them) and
 * omit endTimestamp when unknown; all three get their canonical values here.
 */
export function normalizeStoredRef(raw: unknown, streamerSlug: string): PerformanceRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const performanceId = asString(entry.performanceId);
  const videoId = asString(entry.videoId);
  const timestamp = typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp) ? entry.timestamp : null;
  if (performanceId === null || videoId === null || timestamp === null) return null;
  const endTimestamp = typeof entry.endTimestamp === 'number' && Number.isFinite(entry.endTimestamp)
    ? entry.endTimestamp
    : null;
  return {
    performanceId,
    songId: asString(entry.songId) ?? performanceId,
    songTitle: asString(entry.songTitle) ?? '',
    originalArtist: asString(entry.originalArtist) ?? '',
    videoId,
    timestamp,
    endTimestamp,
    streamerSlug: asString(entry.streamerSlug) ?? streamerSlug,
  };
}

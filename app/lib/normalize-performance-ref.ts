import type { PerformanceRef } from '../types/archive';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Turns a persisted liked/recent/playlist entry into a PerformanceRef.
 * Older entries lack songId (the panels used to store the performanceId in
 * its place), lack streamerSlug (the storage key already scoped them),
 * omit endTimestamp when unknown and have no workId; the first three get
 * canonical values here, workId stays absent.
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
  const workId = asString(entry.workId);
  return {
    performanceId,
    songId: asString(entry.songId) ?? performanceId,
    ...(workId ? { workId } : {}),
    songTitle: asString(entry.songTitle) ?? '',
    originalArtist: asString(entry.originalArtist) ?? '',
    videoId,
    timestamp,
    endTimestamp,
    streamerSlug: asString(entry.streamerSlug) ?? streamerSlug,
  };
}

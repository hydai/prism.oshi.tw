export const AURORA_RECENT_STORAGE_KEY = 'aurora:recent:v1';
const LEGACY_AURORA_RECENT_STORAGE_KEY = 'aurora:recent';
const MAX_RECENT_VIDEOS = 10;

type RecentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getBrowserStorage(): RecentStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function pushRecentVideo(videoId: string, storage = getBrowserStorage()): void {
  if (!storage) return;

  try {
    let raw = storage.getItem(AURORA_RECENT_STORAGE_KEY);
    const shouldMigrate = raw === null;
    if (shouldMigrate) raw = storage.getItem(LEGACY_AURORA_RECENT_STORAGE_KEY);

    let parsed: unknown = [];
    try {
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      // Recover corrupt history instead of making every future update fail.
    }
    const recent = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
    const next = [videoId, ...recent.filter((id) => id !== videoId)].slice(0, MAX_RECENT_VIDEOS);

    storage.setItem(AURORA_RECENT_STORAGE_KEY, JSON.stringify(next));
    if (shouldMigrate && raw !== null) storage.removeItem(LEGACY_AURORA_RECENT_STORAGE_KEY);
  } catch {
    // Recent history is optional when storage is unavailable or corrupt.
  }
}

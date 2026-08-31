// Formats a second count as m:ss. Floors fractional input — live playback
// clocks report fractional seconds.
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Duration between a performance's start and end timestamps as m:ss; '--:--' when the end is unknown. */
export function formatDuration(track: { timestamp: number; endTimestamp: number | null }): string {
  if (!track.endTimestamp) return '--:--';
  const secs = track.endTimestamp - track.timestamp;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatRelativeTime(playedAt: number, now: number = Date.now()): string {
  const diff = now - playedAt;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return `${Math.floor(days / 7)} 週前`;
}

/** Deep link to a performance inside its VOD. Floors fractional input — YouTube's t= param wants whole seconds. */
export function youtubeWatchUrl(videoId: string, timestamp: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timestamp)}s`;
}

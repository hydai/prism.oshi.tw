/**
 * `h:mm:ss` past the first hour, `m:ss` before it — the timestamp format the stamping pages,
 * the playback pill and the exported song lists all speak.
 */
export function formatTimestamp(sec: number): string {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

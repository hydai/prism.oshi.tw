// Formats a second count as m:ss. Floors fractional input — live playback
// clocks report fractional seconds.
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

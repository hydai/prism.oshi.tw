import { usePlayerClockTime } from '../hooks/usePlayerClock';
import { formatTimestamp } from '../lib/format-timestamp';

/**
 * The editors' "current" readout. It subscribes to the shared clock itself, so the twice-a-second
 * tick re-renders this span and nothing around it.
 */
export function PlaybackTime({ className }: { className: string }) {
  const currentTime = usePlayerClockTime();
  return <span className={className}>{formatTimestamp(currentTime)}</span>;
}

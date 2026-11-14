import { formatTimestamp } from '../../lib/format-timestamp';

/** A time on the review page: a button, named 「跳到 {time}」, that seeks the player there. `className` is its look. */
export function SeekButton({ seconds, onSeek, className }: { seconds: number; onSeek: (seconds: number) => void; className?: string }) {
  const time = formatTimestamp(seconds);
  return (
    <button
      type="button"
      aria-label={`跳到 ${time}`}
      onClick={() => onSeek(seconds)}
      className={`rounded-radius-xs font-mono text-[11.5px] hover:underline focus-visible:outline-none focus-visible:shadow-focus${className ? ` ${className}` : ''}`}
    >
      {time}
    </button>
  );
}

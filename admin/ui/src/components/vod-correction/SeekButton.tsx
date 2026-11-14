import { formatTimestamp } from '../../lib/format-timestamp';

/**
 * Which of a changed time's two values a time is: the stream's now (「目前」, struck) or the one the apply gives it
 * (「改為」, in the accent). The looks are only seen, so a screen reader is told in words.
 */
export type TimeCue = '目前' | '改為';

/**
 * A time on the review page: a button, named 「跳到 {time}」, that seeks the player there. `className` is its look.
 * Beside the other value of a time that changes, its `cue` leads the name (「目前：跳到 {time}」).
 */
export function SeekButton({
  seconds,
  onSeek,
  className,
  cue,
}: {
  seconds: number;
  onSeek: (seconds: number) => void;
  className?: string;
  cue?: TimeCue;
}) {
  const time = formatTimestamp(seconds);
  return (
    <button
      type="button"
      aria-label={cue === undefined ? `跳到 ${time}` : `${cue}：跳到 ${time}`}
      onClick={() => onSeek(seconds)}
      className={`rounded-radius-xs font-mono text-[11.5px] hover:underline focus-visible:outline-none focus-visible:shadow-focus${className ? ` ${className}` : ''}`}
    >
      {time}
    </button>
  );
}

/** No time, as a dash. Beside the other value of a time that changes, a screen reader hears its `cue` and 「無」. */
export function NoTime({ className, cue }: { className: string; cue?: TimeCue }) {
  const look = `font-mono text-[11.5px] ${className}`;
  if (cue === undefined) return <span className={look}>—</span>;
  return (
    <span className={look}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{`${cue}：無`}</span>
    </span>
  );
}

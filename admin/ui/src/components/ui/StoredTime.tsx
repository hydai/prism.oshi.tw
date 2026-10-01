import { formatFullTime, formatWhen, storedTimeIso } from '../../lib/dates';

/**
 * A stored time (D1's `YYYY-MM-DD HH:MM:SS`, which is UTC) as the studio pages show it: the short
 * form (`formatWhen`, which leaves out the current year), the full time on hover, and the exact
 * instant in `dateTime` for machines. `today` is when the page opened, so a render never reads the
 * clock. `className` is the cell's own look.
 */
export function StoredTime({ value, today, className }: { value: string; today: Date; className?: string }) {
  return (
    <time dateTime={storedTimeIso(value)} title={formatFullTime(value)} className={className}>
      {formatWhen(value, today)}
    </time>
  );
}

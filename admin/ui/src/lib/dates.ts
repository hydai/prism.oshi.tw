/**
 * Date formatting shared by Pipeline ("Scanned …") and Dashboard ("Updated …", recent submissions).
 * Every format below reads local time off `Date` getters with a fixed English month array — never
 * `toLocaleString`, whose output depends on the runtime's ICU data and locale.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STORED_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Reads a D1 `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`, no offset) as UTC — D1 never stores a
 * zone, and that format is always the UTC instant the row was written. Anything else (an ISO string
 * with an offset, already a `Date`-parseable value) goes through `Date.parse` instead. `null` for
 * whatever neither path can read.
 */
export function parseStoredTime(value: string): Date | null {
  const stored = STORED_TIME_RE.exec(value);
  if (stored) {
    const [, year, month, day, hour, minute, second] = stored;
    const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** `Jul 1, 16:43` within `now`'s year, `2025-12-06` once the year rolls over. `value` unchanged if unparseable. */
export function formatWhen(value: string, now: Date): string {
  const parsed = parseStoredTime(value);
  if (!parsed) return value;
  if (parsed.getFullYear() === now.getFullYear()) {
    return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}, ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
  }
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

/** `YYYY-MM-DD HH:MM`. `value` unchanged if unparseable. */
export function formatFullTime(value: string): string {
  const parsed = parseStoredTime(value);
  if (!parsed) return value;
  const date = `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  const time = `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
  return `${date} ${time}`;
}

/** `just now` / `N min ago` / `N h ago`, falling back to `formatWhen` from a day out. */
export function formatRelative(then: number, now: number): string {
  const diffSec = (now - then) / 1000;
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} h ago`;
  return formatWhen(new Date(then).toISOString(), new Date(now));
}

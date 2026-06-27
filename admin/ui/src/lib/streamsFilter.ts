import type { Status } from '../../../shared/types';

export type StatusFilter = '' | Status;

export interface StreamsFilter {
  status: StatusFilter;
  year: string;
}

/** Single global key — the same remembered choice across all streamers. */
export const STREAMS_FILTER_KEY = 'prism_admin_streams_filter';

const VALID_STATUSES: readonly Status[] = [
  'pending',
  'approved',
  'rejected',
  'excluded',
  'extracted',
];

const DEFAULT_FILTER: StreamsFilter = { status: '', year: '' };

/**
 * Read the persisted Streams filter, sanitizing anything unexpected back to the
 * "All / All" default. Never throws — a corrupt value or unavailable storage
 * (private mode) simply yields the default.
 */
export function loadStreamsFilter(): StreamsFilter {
  try {
    const raw = localStorage.getItem(STREAMS_FILTER_KEY);
    if (!raw) return { ...DEFAULT_FILTER };
    const parsed = JSON.parse(raw) as Partial<Record<keyof StreamsFilter, unknown>>;
    const status =
      typeof parsed.status === 'string' && VALID_STATUSES.includes(parsed.status as Status)
        ? (parsed.status as Status)
        : '';
    const year = typeof parsed.year === 'string' && /^\d{4}$/.test(parsed.year) ? parsed.year : '';
    return { status, year };
  } catch {
    return { ...DEFAULT_FILTER };
  }
}

/** Persist the current filter. Non-fatal if storage is unavailable. */
export function saveStreamsFilter(filter: StreamsFilter): void {
  try {
    localStorage.setItem(STREAMS_FILTER_KEY, JSON.stringify(filter));
  } catch {
    // localStorage unavailable (private mode / quota) — ignore.
  }
}

/**
 * Resolve a remembered year against the years actually present in the loaded
 * data. Returns the saved year only if it still exists, otherwise '' (All years).
 *
 * This keeps the saved value untouched: a remembered year reactivates when you
 * return to data that has it, while gracefully showing "All" when it's absent
 * (e.g. after switching to a streamer whose archive lacks that year).
 */
export function resolveYear(savedYear: string, availableYears: string[]): string {
  return savedYear && availableYears.includes(savedYear) ? savedYear : '';
}

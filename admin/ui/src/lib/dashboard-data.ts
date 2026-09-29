import type { StatusCounts, Stream, StreamWithPending } from '../../../shared/types';
import type { VodExportStatusResponse } from '../api/vodExportTypes';
import type { InboxCounts } from '../components/shell/InboxCounts';
import type { Tone } from '../components/ui/Pill';

/**
 * What the Dashboard's cards show, worked out from what the API returns (spec §8.1). Pure, so the
 * page and `CatalogBars` stay presentational and the mapping is tested on its own.
 */

/** Plain code-unit order: a same-day tie always sorts the same way, whatever the runtime's locale. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Continue stamping: the streams that still have songs without an end timestamp, newest first
 * (then by title), at most `limit` of them. The input is left as it was.
 */
export function continueStampingStreams(streams: StreamWithPending[], limit = 4): StreamWithPending[] {
  return streams
    .filter((stream) => stream.pendingCount > 0)
    .sort((a, b) => compareText(b.date, a.date) || compareText(a.title, b.title))
    .slice(0, limit);
}

/** How many streams still have songs to stamp. */
export function streamsWithWork(streams: StreamWithPending[]): number {
  return streams.filter((stream) => stream.pendingCount > 0).length;
}

/** The earliest date among the pending streams (`YYYY-MM-DD` compares as text), or `null` with none. */
export function oldestPendingDate(streams: Stream[]): string | null {
  let oldest: string | null = null;
  for (const stream of streams) {
    if (stream.date !== '' && (oldest === null || stream.date < oldest)) oldest = stream.date;
  }
  return oldest;
}

/** The sum of the three inbox counts, or `null` while any of them is unknown: never a partial sum. */
export function inboxTotal(counts: InboxCounts): number | null {
  if (counts.nova === null || counts.vods === null || counts.crystal === null) return null;
  return counts.nova + counts.vods + counts.crystal;
}

/** The tones a catalog status takes: the ones the bars have a chart fill for (`--chart-*`). */
export type CatalogTone = Extract<Tone, 'ok' | 'warn' | 'danger' | 'neutral' | 'teal'>;

/** The catalog's statuses in bar and legend order, each in its spec §4.1 tone. */
export const CATALOG_STATUSES: readonly { key: keyof StatusCounts; label: string; tone: CatalogTone }[] = [
  { key: 'approved', label: 'Approved', tone: 'ok' },
  { key: 'pending', label: 'Pending', tone: 'warn' },
  { key: 'rejected', label: 'Rejected', tone: 'danger' },
  { key: 'excluded', label: 'Excluded', tone: 'neutral' },
  { key: 'extracted', label: 'Extracted', tone: 'teal' },
];

interface CatalogSegment {
  key: keyof StatusCounts;
  label: string;
  tone: CatalogTone;
  value: number;
  /** Share of the total in percent, with two decimals. */
  pct: number;
}

/**
 * One stacked bar's parts, in `CATALOG_STATUSES` order, zero counts left out. Each share is in
 * hundredths of a percent: rounded down first, then the hundredths still missing go to the parts
 * with the largest remainders, so the shares always add up to exactly 100 — rounding each one to
 * the nearest hundredth could be off by up to 0.025 with five parts.
 */
export function catalogSegments(counts: StatusCounts): CatalogSegment[] {
  const parts = CATALOG_STATUSES.filter((status) => counts[status.key] > 0);
  const total = parts.reduce((sum, status) => sum + counts[status.key], 0);
  if (total === 0) return [];
  const shares = parts.map((status) => {
    const exact = (counts[status.key] * 10_000) / total;
    const floor = Math.floor(exact);
    return { status, floor, remainder: exact - floor };
  });
  const missing = 10_000 - shares.reduce((sum, share) => sum + share.floor, 0);
  // A stable sort: of two equal remainders, the earlier status gets the extra hundredth.
  const topUp = new Set([...shares].sort((a, b) => b.remainder - a.remainder).slice(0, missing));
  return shares.map((share) => ({
    key: share.status.key,
    label: share.status.label,
    tone: share.status.tone,
    value: counts[share.status.key],
    pct: (share.floor + (topUp.has(share) ? 1 : 0)) / 100,
  }));
}

const ISO_DATE = /^\d{4}-(\d{2}-\d{2})$/;

/** `2026-04-02` → `04-02`, the phone's date chip; anything else stays as it is. */
export function monthDay(date: string): string {
  return ISO_DATE.exec(date)?.[1] ?? date;
}

/** The VOD export card's dotted status: generation or publication running, else unpublished or not. */
export function vodExportState(status: VodExportStatusResponse): { label: string; tone: Extract<Tone, 'info' | 'warn' | 'ok'> } {
  if (status.generationInProgress || status.publicationInProgress) return { label: 'In progress', tone: 'info' };
  if (status.changesNotPublished) return { label: 'Unpublished changes', tone: 'warn' };
  return { label: 'Up to date', tone: 'ok' };
}

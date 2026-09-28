import type { DiscoveredStream } from '../../../shared/types';

/** The Discover table's filter chips: the new videos, the ones already in Prism, or all of them. */
export type DiscoverFilter = 'new' | 'existing' | 'all';

/** A scan's counts for the summary strip and the chips: every video, the new ones, the ones in Prism. */
export function summarizeDiscovered(streams: DiscoveredStream[]): { total: number; fresh: number; existing: number } {
  const fresh = streams.filter((stream) => stream.isNew).length;
  return { total: streams.length, fresh, existing: streams.length - fresh };
}

/** The videos a filter chip shows, in the scan's order. */
export function visibleDiscovered(streams: DiscoveredStream[], filter: DiscoverFilter): DiscoveredStream[] {
  if (filter === 'all') return streams;
  const wantNew = filter === 'new';
  return streams.filter((stream) => stream.isNew === wantNew);
}

/** The status pill of a video Prism already has: `In Prism · Approved`, or `In Prism` when its status is unknown. */
export function inPrismLabel(stream: DiscoveredStream): string {
  const status = stream.existingStatus;
  return status ? `In Prism · ${status.charAt(0).toUpperCase()}${status.slice(1)}` : 'In Prism';
}

/** The video IDs of a scan's new videos: what a scan pre-selects, and what "Select all new streams" selects. */
export function newStreamIds(streams: DiscoveredStream[]): Set<string> {
  const ids = new Set<string>();
  for (const stream of streams) {
    if (stream.isNew) ids.add(stream.videoId);
  }
  return ids;
}

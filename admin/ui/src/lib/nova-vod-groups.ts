import type { NovaVodSubmission } from '../../../shared/types';

export interface VodGroup {
  slug: string;
  vods: NovaVodSubmission[];
  pendingCount: number;
}

export type VodViewMode = 'grouped' | 'timeline';

/**
 * Groups VOD submissions by streamer, preserving the incoming order inside each
 * group. Groups are ordered by the newest `submitted_at` they contain, so the
 * streamers with fresh submissions float to the top of the review queue.
 */
export function groupVodsByStreamer(vods: NovaVodSubmission[]): VodGroup[] {
  const groups = new Map<string, VodGroup & { newest: string }>();
  for (const vod of vods) {
    const group = groups.get(vod.streamer_slug);
    if (group) {
      group.vods.push(vod);
      if (vod.status === 'pending') group.pendingCount += 1;
      if (vod.submitted_at > group.newest) group.newest = vod.submitted_at;
    } else {
      groups.set(vod.streamer_slug, {
        slug: vod.streamer_slug,
        vods: [vod],
        pendingCount: vod.status === 'pending' ? 1 : 0,
        newest: vod.submitted_at,
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0))
    .map(({ slug, vods: members, pendingCount }) => ({ slug, vods: members, pendingCount }));
}

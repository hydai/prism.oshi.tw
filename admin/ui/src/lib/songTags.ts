import { mergeTagIds } from '../../../../lib/tags';
import type { Song } from '../../../shared/types';

// The tag state a curator can actually act on for one song. `songs.tags` is dead storage
// on this branch — insertSong writes '[]', updateSong dropped the field, and migration
// 0007 strips IDs out of it — so reading that column shows an empty list for every song
// however it is tagged. Work-scope tags are owned by the Global Library, not this page.
export function effectiveSongTags(song: Song): string[] {
  return mergeTagIds((song.performances ?? []).flatMap((performance) => performance.tags ?? []));
}

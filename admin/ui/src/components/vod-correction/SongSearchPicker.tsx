import { useState } from 'react';
import type { Song } from '../../../../shared/types';
import { api } from '../../api/client';
import { useApiResource } from '../../lib/apiResource';
import { StatusPill } from '../ui/Pill';
import { SearchableList } from '../ui/SearchableList';

/** The songs a performance can be relinked to: the apply refuses a song that is neither approved nor pending. */
function isRelinkable(song: Song): boolean {
  return song.status === 'approved' || song.status === 'pending';
}

const NO_SONGS: Song[] = [];

/**
 * Search `streamer`'s songs to relink a performance to (「改連到既有的歌」): a search field over the matches, each
 * with its artist and status, so a pending song is seen before it is picked. A search asks the worker as it is typed
 * (twenty matches at most), and an empty one asks nothing. `excludeSongId` (the row's own song, which a relink would
 * leave where it is) and the songs the apply would refuse are left out; `selectedSongId` is the one picked so far.
 */
export function SongSearchPicker({
  streamer,
  onPick,
  excludeSongId,
  selectedSongId,
}: {
  streamer: string;
  onPick: (song: Song) => void;
  excludeSongId?: string;
  selectedSongId?: string;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim();
  const results = useApiResource(
    () => (search === '' ? Promise.resolve(NO_SONGS) : api.searchStreamerSongs(streamer, search)),
    [streamer, search],
  );
  const songs = search === '' ? NO_SONGS : (results.data ?? NO_SONGS).filter((song) => song.id !== excludeSongId && isRelinkable(song));

  let emptyText = '找不到符合的歌';
  if (search === '') emptyText = '輸入歌名搜尋';
  else if (results.error !== null) emptyText = `搜尋失敗：${results.error}`;
  else if (results.loading) emptyText = '搜尋中…';

  return (
    <SearchableList
      items={songs}
      getKey={(song) => song.id}
      getTitle={(song) => `${song.title} · ${song.originalArtist}`}
      isSelected={(song) => song.id === selectedSongId}
      onSelect={onPick}
      renderItem={(song) => (
        <>
          <span className="min-w-0 truncate font-semibold">{song.title}</span>
          <span className="min-w-0 truncate text-fg-muted">{song.originalArtist}</span>
          <span className="ml-auto shrink-0">
            <StatusPill status={song.status} />
          </span>
        </>
      )}
      search={query}
      onSearchChange={setQuery}
      searchLabel={`搜尋 ${streamer} 的歌`}
      searchPlaceholder={`搜尋 ${streamer} 的歌…`}
      label={`${streamer} 的歌`}
      emptyText={emptyText}
    />
  );
}

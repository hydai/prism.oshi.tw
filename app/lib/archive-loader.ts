import { mergeAlbumArt, sortStreamsByNewest } from "./archive";
import type { ArchiveSong, StreamSummary } from "../types/archive";

export type ArchiveLoadState = "loading" | "ready" | "error";

export interface ArchiveData {
  songs: ArchiveSong[];
  streams: StreamSummary[];
}

interface SongMetadataEntry {
  songId: string;
  albumArtUrl?: string;
  albumArtUrls?: { small: string };
}

interface MetadataResponse {
  songMetadata: SongMetadataEntry[];
}

// Loads songs, streams, and album-art metadata for a streamer with all three
// requests in flight at once. Songs are required — the returned promise rejects
// if they fail. Metadata and streams degrade gracefully (no art / empty list)
// so a partial outage never blocks the catalog.
export async function loadArchiveData(
  slug: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<ArchiveData> {
  const doFetch: typeof fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  const init = signal ? { signal } : undefined;

  const songsPromise = doFetch(`/api/${slug}/songs`, init).then((res) => {
    if (!res.ok) throw new Error("songs API error");
    return res.json() as Promise<ArchiveSong[]>;
  });

  const albumArtPromise: Promise<Map<string, string>> = doFetch(`/api/${slug}/metadata`, init)
    .then((res) => (res.ok ? (res.json() as Promise<MetadataResponse>) : { songMetadata: [] }))
    .then((data) => {
      const map = new Map<string, string>();
      for (const entry of data.songMetadata) {
        const url = entry.albumArtUrl ?? entry.albumArtUrls?.small;
        if (url) map.set(entry.songId, url);
      }
      return map;
    })
    .catch(() => new Map<string, string>());

  const streamsPromise: Promise<StreamSummary[]> = doFetch(`/api/${slug}/streams`, init)
    .then((res) => (res.ok ? (res.json() as Promise<StreamSummary[]>) : []))
    .catch(() => []);

  const [songs, albumArtMap, streams] = await Promise.all([
    songsPromise,
    albumArtPromise,
    streamsPromise,
  ]);

  return {
    songs: mergeAlbumArt(songs, albumArtMap),
    streams: sortStreamsByNewest(streams),
  };
}

import { sortStreamsByNewest } from "./archive";
import type { ArchiveSong, StreamSummary } from "../types/archive";
import type { Song } from "../../lib/types";

export type ArchiveLoadState = "loading" | "ready" | "error";

export interface ArchiveData {
  songs: ArchiveSong[];
  streams: StreamSummary[];
}

// Deterministic fallback for a performance whose stream is missing from
// streams.json (should not happen — the exporter joins the same tables)
const ORPHAN_DATE = "1970-01-01";

export function hydrateSongs(stored: Song[], streams: StreamSummary[]): ArchiveSong[] {
  const streamById = new Map(streams.map((s) => [s.id, s]));
  return stored.map((song) => ({
    ...song,
    performances: song.performances.map((p) => {
      const stream = streamById.get(p.streamId);
      return {
        ...p,
        streamTitle: stream?.title ?? "",
        date: stream?.date ?? ORPHAN_DATE,
        note: p.note ?? "",
      };
    }),
  }));
}

// Loads songs and streams for a streamer with both requests in flight at once,
// then joins stream-derived fields onto each performance. Both requests are
// required — the promise rejects if either fails (the retry button re-runs it).
export async function loadArchiveData(
  slug: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<ArchiveData> {
  const doFetch: typeof fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  const init = signal ? { signal } : undefined;

  const songsPromise = doFetch(`/api/${slug}/songs`, init).then((res) => {
    if (!res.ok) throw new Error("songs API error");
    return res.json() as Promise<Song[]>;
  });

  const streamsPromise = doFetch(`/api/${slug}/streams`, init).then((res) => {
    if (!res.ok) throw new Error("streams API error");
    return res.json() as Promise<StreamSummary[]>;
  });

  const [stored, streams] = await Promise.all([songsPromise, streamsPromise]);

  return {
    songs: hydrateSongs(stored, streams),
    streams: sortStreamsByNewest(streams),
  };
}

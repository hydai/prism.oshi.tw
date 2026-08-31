'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStreamer } from '../contexts/StreamerContext';
import {
  flattenSongs,
  getAllArtists,
  getAvailableYears,
  groupSongsByWorkId,
  sortGroupedSongs,
} from '../lib/archive';
import { loadArchiveData, type ArchiveLoadState } from '../lib/archive-loader';
import type { ArchiveSong, FlattenedSong, StreamSummary } from '../types/archive';

interface ArchiveDataValue {
  songs: ArchiveSong[];
  streams: StreamSummary[];
  loadState: ArchiveLoadState;
  retryLoad: () => void;
  allArtists: string[];
  availableYears: number[];
  /** Unfiltered catalogs — consumed by ArchiveFiltersProvider, not by sections. */
  allFlattenedSongs: FlattenedSong[];
  allGroupedSongs: ArchiveSong[];
}

const ArchiveDataContext = createContext<ArchiveDataValue | null>(null);

export function useArchiveData(): ArchiveDataValue {
  const value = useContext(ArchiveDataContext);
  if (!value) {
    throw new Error('useArchiveData must be used within an ArchiveDataProvider');
  }
  return value;
}

export function ArchiveDataProvider({ children }: { children: ReactNode }) {
  const { slug } = useStreamer();
  const [songs, setSongs] = useState<ArchiveSong[]>([]);
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [loadState, setLoadState] = useState<ArchiveLoadState>('loading');
  const loadAbortRef = useRef<AbortController | null>(null);

  // Load songs/streams in parallel. The initial state is already 'loading',
  // so the mount effect below can call this with no synchronous setState of
  // its own; the retry button goes through retryLoad, which sets it instead.
  const loadData = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    loadArchiveData(slug, undefined, controller.signal)
      .then(({ songs: loadedSongs, streams: loadedStreams }) => {
        if (controller.signal.aborted) return;
        setSongs(loadedSongs);
        setStreams(loadedStreams);
        setLoadState('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoadState('error');
      });
  }, [slug]);

  const retryLoad = useCallback(() => {
    setLoadState('loading');
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadData();
    return () => loadAbortRef.current?.abort();
  }, [loadData]);

  const allArtists = useMemo(() => getAllArtists(songs), [songs]);
  const availableYears = useMemo(() => getAvailableYears(streams), [streams]);
  const allFlattenedSongs = useMemo(() => flattenSongs(songs), [songs]);
  const allGroupedSongs = useMemo(() => sortGroupedSongs(groupSongsByWorkId(songs)), [songs]);

  const value = useMemo<ArchiveDataValue>(
    () => ({ songs, streams, loadState, retryLoad, allArtists, availableYears, allFlattenedSongs, allGroupedSongs }),
    [songs, streams, loadState, retryLoad, allArtists, availableYears, allFlattenedSongs, allGroupedSongs],
  );

  return <ArchiveDataContext.Provider value={value}>{children}</ArchiveDataContext.Provider>;
}

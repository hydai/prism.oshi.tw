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
import { useArchiveData } from './archive-data-context';
import { useArchiveUi } from './archive-ui-context';
import { usePlayerActions, usePlayerStatus } from '../contexts/PlayerContext';
import {
  filterFlattenedSongs,
  filterGroupedSongs,
  filterStreamsByYears,
  followingTracksFromFlattened,
  followingTracksFromGrouped,
} from '../lib/archive';
import type { ArchiveSong, FlattenedSong, PerformanceRef, StreamSummary } from '../types/archive';

interface ArchiveFiltersValue {
  debouncedSearch: string;
  setDebouncedSearch: (search: string) => void;
  selectedStreamId: string | null;
  setSelectedStreamId: (id: string | null) => void;
  selectedArtist: string | null;
  setSelectedArtist: (artist: string | null) => void;
  selectedYears: Set<number>;
  toggleYear: (year: number) => void;
  clearYears: () => void;
  hasActiveFilters: boolean;
  clearAllFilters: () => void;
  filteredStreams: StreamSummary[];
  flattenedSongs: FlattenedSong[];
  groupedSongs: ArchiveSong[];
  handlePlayAll: () => void;
  handlePlayFromFlattened: (track: PerformanceRef) => void;
  handlePlayFromGrouped: (track: PerformanceRef) => void;
}

const ArchiveFiltersContext = createContext<ArchiveFiltersValue | null>(null);

export function useArchiveFilters(): ArchiveFiltersValue {
  const value = useContext(ArchiveFiltersContext);
  if (!value) {
    throw new Error('useArchiveFilters must be used within an ArchiveFiltersProvider');
  }
  return value;
}

export function ArchiveFiltersProvider({ children }: { children: ReactNode }) {
  const { slug } = useStreamer();
  const { streams, allFlattenedSongs, allGroupedSongs } = useArchiveData();
  const { viewMode } = useArchiveUi();
  const { playTrackWithQueue } = usePlayerActions();
  const { unavailableVideoIds } = usePlayerStatus();

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());

  const filteredStreams = useMemo(
    () => filterStreamsByYears(streams, selectedYears),
    [streams, selectedYears],
  );

  const toggleYear = useCallback((year: number) => {
    setSelectedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
    setSelectedStreamId(null);
  }, []);

  const clearYears = useCallback(() => {
    setSelectedYears(new Set());
    setSelectedStreamId(null);
  }, []);

  const hasActiveFilters = debouncedSearch !== '' || selectedStreamId !== null || selectedArtist !== null || selectedYears.size > 0;

  const clearAllFilters = useCallback(() => {
    setDebouncedSearch('');
    setSelectedStreamId(null);
    setSelectedArtist(null);
    setSelectedYears(new Set());
  }, []);

  const archiveFilters = useMemo(() => ({
    search: debouncedSearch,
    selectedStreamId,
    selectedArtist,
    selectedYears,
  }), [debouncedSearch, selectedStreamId, selectedArtist, selectedYears]);

  const flattenedSongs: FlattenedSong[] = useMemo(
    () => filterFlattenedSongs(allFlattenedSongs, archiveFilters),
    [allFlattenedSongs, archiveFilters],
  );
  const groupedSongs: ArchiveSong[] = useMemo(
    () => filterGroupedSongs(allGroupedSongs, archiveFilters),
    [allGroupedSongs, archiveFilters],
  );

  // Click handlers below are passed to memoized rows whose comparators ignore
  // onPlay — a row may invoke a stale closure. All mutable data therefore goes
  // through refs so a stale handler still computes the queue from current data.
  const flattenedSongsRef = useRef(flattenedSongs);
  const groupedSongsRef = useRef(groupedSongs);
  const unavailableVideoIdsRef = useRef(unavailableVideoIds);
  useEffect(() => { flattenedSongsRef.current = flattenedSongs; }, [flattenedSongs]);
  useEffect(() => { groupedSongsRef.current = groupedSongs; }, [groupedSongs]);
  useEffect(() => { unavailableVideoIdsRef.current = unavailableVideoIds; }, [unavailableVideoIds]);

  // Inside a provider the context value is memoized, so unlike its previous
  // life in the page controller this callback needs stable identity too.
  const handlePlayAll = useCallback(() => {
    const tracks = viewMode === 'timeline'
      ? followingTracksFromFlattened(flattenedSongs, -1, slug, unavailableVideoIds)
      : followingTracksFromGrouped(groupedSongs, -1, slug, unavailableVideoIds);
    if (tracks.length === 0) return;
    playTrackWithQueue(tracks[0], tracks.slice(1));
  }, [viewMode, flattenedSongs, groupedSongs, slug, unavailableVideoIds, playTrackWithQueue]);

  // Timeline view + mobile search both render flattenedSongs.
  const handlePlayFromFlattened = useCallback((track: PerformanceRef) => {
    const list = flattenedSongsRef.current;
    const index = list.findIndex((s) => s.performanceId === track.performanceId);
    const following = index === -1
      ? [] // clicked row no longer in the current list — play it alone
      : followingTracksFromFlattened(list, index, slug, unavailableVideoIdsRef.current);
    playTrackWithQueue(track, following);
  }, [slug, playTrackWithQueue]);

  const handlePlayFromGrouped = useCallback((track: PerformanceRef) => {
    const list = groupedSongsRef.current;
    const index = list.findIndex((s) => s.id === track.songId);
    const following = index === -1
      ? []
      : followingTracksFromGrouped(list, index, slug, unavailableVideoIdsRef.current);
    playTrackWithQueue(track, following);
  }, [slug, playTrackWithQueue]);

  const value = useMemo<ArchiveFiltersValue>(() => ({
    debouncedSearch,
    setDebouncedSearch,
    selectedStreamId,
    setSelectedStreamId,
    selectedArtist,
    setSelectedArtist,
    selectedYears,
    toggleYear,
    clearYears,
    hasActiveFilters,
    clearAllFilters,
    filteredStreams,
    flattenedSongs,
    groupedSongs,
    handlePlayAll,
    handlePlayFromFlattened,
    handlePlayFromGrouped,
  }), [
    debouncedSearch,
    selectedStreamId,
    selectedArtist,
    selectedYears,
    toggleYear,
    clearYears,
    hasActiveFilters,
    clearAllFilters,
    filteredStreams,
    flattenedSongs,
    groupedSongs,
    handlePlayAll,
    handlePlayFromFlattened,
    handlePlayFromGrouped,
  ]);

  return <ArchiveFiltersContext.Provider value={value}>{children}</ArchiveFiltersContext.Provider>;
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useStreamer } from '../contexts/StreamerContext';
import { useArchiveData } from './archive-data-context';
import { useArchiveUi } from './archive-ui-context';
import { usePlayerActions, usePlayerStore } from '../contexts/PlayerContext';
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

  const playerStore = usePlayerStore();

  const handlePlayAll = useCallback(() => {
    // Event handlers read volatile player state imperatively — fresh at click
    // time, and no subscription churning the context value.
    const unavailable = playerStore.getSnapshot().unavailableVideoIds;
    const tracks = viewMode === 'timeline'
      ? followingTracksFromFlattened(flattenedSongs, -1, slug, unavailable)
      : followingTracksFromGrouped(groupedSongs, -1, slug, unavailable);
    if (tracks.length === 0) return;
    playTrackWithQueue(tracks[0], tracks.slice(1));
  }, [viewMode, flattenedSongs, groupedSongs, slug, playerStore, playTrackWithQueue]);

  // Timeline view + mobile search both render flattenedSongs. Identity tracks
  // the list: a row holding this handler re-renders exactly when the list
  // (and therefore its own song prop) changed.
  const handlePlayFromFlattened = useCallback((track: PerformanceRef) => {
    const index = flattenedSongs.findIndex((s) => s.performanceId === track.performanceId);
    const following = index === -1
      ? [] // clicked row no longer in the current list — play it alone
      : followingTracksFromFlattened(flattenedSongs, index, slug, playerStore.getSnapshot().unavailableVideoIds);
    playTrackWithQueue(track, following);
  }, [flattenedSongs, slug, playerStore, playTrackWithQueue]);

  const handlePlayFromGrouped = useCallback((track: PerformanceRef) => {
    const index = groupedSongs.findIndex((s) => s.id === track.songId);
    const following = index === -1
      ? []
      : followingTracksFromGrouped(groupedSongs, index, slug, playerStore.getSnapshot().unavailableVideoIds);
    playTrackWithQueue(track, following);
  }, [groupedSongs, slug, playerStore, playTrackWithQueue]);

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

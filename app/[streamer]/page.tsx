'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useStreamer } from '../contexts/StreamerContext';
import { usePlayer } from '../contexts/PlayerContext';
import { usePlaylist } from '../contexts/PlaylistContext';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';
import {
  filterFlattenedSongs,
  filterGroupedSongs,
  filterStreamsByYears,
  flattenSongs,
  followingTracksFromFlattened,
  followingTracksFromGrouped,
  getAllArtists,
  getAvailableYears,
  groupSongsByWorkId,
  sortGroupedSongs,
} from '../lib/archive';
import { loadArchiveData, type ArchiveLoadState } from '../lib/archive-loader';
import { createPersistedStore, usePersistedStore, getSessionStorage } from '../lib/persisted-store';
import type {
  ArchiveSong,
  ArchiveViewMode,
  FlattenedSong,
  MobileArchiveTab,
  PerformanceRef,
  StreamSummary,
} from '../types/archive';
import ArchivePageView from './ArchivePageView';

function useArchivePageController() {
  const streamerData = useStreamer();
  const slug = streamerData.slug;
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const viewModeStore = useMemo(() => createPersistedStore<ArchiveViewMode>({
    key: 'prism_view_mode',
    storage: getSessionStorage,
    fallback: 'timeline',
    parse: (raw) => (raw === 'grouped' ? 'grouped' : 'timeline'),
    // Volatile UI setting: the toggle must keep working even when storage
    // refuses the write.
    persist: 'best-effort',
  }), []);
  const viewMode = usePersistedStore(viewModeStore);
  const setViewMode = useCallback((mode: ArchiveViewMode) => { viewModeStore.update(() => mode); }, [viewModeStore]);
  const [expandedSongs, setExpandedSongs] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hideToast = useCallback(() => setToastMessage(null), []);
  const [showPlaylistPanel, setShowPlaylistPanel] = useState(false);
  const [showLikedSongsPanel, setShowLikedSongsPanel] = useState(false);
  const [showRecentlyPlayedPanel, setShowRecentlyPlayedPanel] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileArchiveTab>('home');
  const [songs, setSongs] = useState<ArchiveSong[]>([]);
  const [loadState, setLoadState] = useState<ArchiveLoadState>('loading');
  const loadAbortRef = useRef<AbortController | null>(null);

  // Load songs/streams in parallel — the retry button calls this again
  const loadData = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoadState('loading');
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

  useEffect(() => {
    loadData();
    return () => loadAbortRef.current?.abort();
  }, [loadData]);

  const { currentTrack, playTrackWithQueue, addToQueue, apiLoadError, unavailableVideoIds, timestampWarning, clearTimestampWarning, skipNotification, clearSkipNotification, shuffleOn, toggleShuffle } = usePlayer();
  const currentTrackId = currentTrack?.performanceId ?? null;
  const { playlists, storageError, clearStorageError } = usePlaylist();
  const { likedCount, isLiked, toggleLike } = useLikedSongs();
  const { recentCount } = useRecentlyPlayed();

  const handleAddToQueue = useCallback((track: PerformanceRef) => {
    addToQueue(track);
    setToastMessage('已加入播放佇列');
  }, [addToQueue]);

  const handleAddToPlaylistSuccess = useCallback(() => {
    setToastMessage('已加入播放清單');
  }, []);

  // toggleLike's write can fail (storage quota); surface that failure here
  // since this is the only surface with a toast affordance for it.
  const handleToggleLike = useCallback((ref: PerformanceRef) => {
    const result = toggleLike(ref);
    if (!result.success) setToastMessage(result.error);
  }, [toggleLike]);

  // Show storage error toast
  useEffect(() => {
    if (storageError) {
      setToastMessage(storageError);
      clearStorageError();
    }
  }, [storageError, clearStorageError]);

  // Show timestamp warning toast
  useEffect(() => {
    if (timestampWarning) {
      setToastMessage(timestampWarning);
      clearTimestampWarning();
    }
  }, [timestampWarning, clearTimestampWarning]);

  // Show skip notification toast (deleted version skipped or playlist ended)
  useEffect(() => {
    if (skipNotification) {
      setToastMessage(skipNotification);
      clearSkipNotification();
    }
  }, [skipNotification, clearSkipNotification]);

  const toggleSongExpansion = useCallback((songId: string) => {
    setExpandedSongs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  }, []);

  const allArtists = useMemo(() => getAllArtists(songs), [songs]);
  const availableYears = useMemo(() => getAvailableYears(streams), [streams]);
  const filteredStreams = useMemo(
    () => filterStreamsByYears(streams, selectedYears),
    [streams, selectedYears],
  );

  const toggleYear = (year: number) => {
    setSelectedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
    setSelectedStreamId(null);
  };

  const clearYears = () => {
    setSelectedYears(new Set());
    setSelectedStreamId(null);
  };

  const hasActiveFilters = debouncedSearch !== '' || selectedStreamId !== null || selectedArtist !== null || selectedYears.size > 0;

  const clearAllFilters = () => {
    setDebouncedSearch('');
    setSelectedStreamId(null);
    setSelectedArtist(null);
    setSelectedYears(new Set());
  };

  const archiveFilters = useMemo(() => ({
    search: debouncedSearch,
    selectedStreamId,
    selectedArtist,
    selectedYears,
  }), [debouncedSearch, selectedStreamId, selectedArtist, selectedYears]);

  const allFlattenedSongs: FlattenedSong[] = useMemo(() => flattenSongs(songs), [songs]);
  const flattenedSongs: FlattenedSong[] = useMemo(
    () => filterFlattenedSongs(allFlattenedSongs, archiveFilters),
    [allFlattenedSongs, archiveFilters],
  );
  const allGroupedSongs: ArchiveSong[] = useMemo(
    () => sortGroupedSongs(groupSongsByWorkId(songs)),
    [songs],
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

  // Declared after the memoized lists it closes over: a closure created before them defeats React Compiler memo preservation (react-hooks/preserve-manual-memoization).
  const handlePlayAll = () => {
    const tracks = viewMode === 'timeline'
      ? followingTracksFromFlattened(flattenedSongs, -1, slug, unavailableVideoIds)
      : followingTracksFromGrouped(groupedSongs, -1, slug, unavailableVideoIds);
    if (tracks.length === 0) return;
    playTrackWithQueue(tracks[0], tracks.slice(1));
  };

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

  // The main scroll container — list sections attach their own virtualizers to it
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return {
    streamerData,
    slug,
    debouncedSearch,
    setDebouncedSearch,
    selectedStreamId,
    setSelectedStreamId,
    selectedArtist,
    setSelectedArtist,
    selectedYears,
    viewMode,
    setViewMode,
    expandedSongs,
    toastMessage,
    setToastMessage,
    hideToast,
    showPlaylistPanel,
    setShowPlaylistPanel,
    showLikedSongsPanel,
    setShowLikedSongsPanel,
    showRecentlyPlayedPanel,
    setShowRecentlyPlayedPanel,
    showCreateDialog,
    setShowCreateDialog,
    mobileTab,
    setMobileTab,
    songs,
    loadState,
    loadData,
    currentTrackId,
    apiLoadError,
    unavailableVideoIds,
    shuffleOn,
    toggleShuffle,
    playlists,
    likedCount,
    isLiked,
    toggleLike: handleToggleLike,
    recentCount,
    handleAddToQueue,
    handlePlayAll,
    handleAddToPlaylistSuccess,
    toggleSongExpansion,
    allArtists,
    availableYears,
    filteredStreams,
    toggleYear,
    clearYears,
    hasActiveFilters,
    clearAllFilters,
    flattenedSongs,
    groupedSongs,
    handlePlayFromFlattened,
    handlePlayFromGrouped,
    scrollContainerRef,
  };
}

export type ArchivePageController = ReturnType<typeof useArchivePageController>;

export default function Home() {
  const controller = useArchivePageController();
  return <ArchivePageView controller={controller} />;
}

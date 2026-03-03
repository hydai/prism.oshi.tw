'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Play, Shuffle, ExternalLink, Mic2, Youtube, Twitter, Facebook, Instagram, Twitch, Sparkles, ListMusic, Clock, Heart, Disc3, ChevronDown, ChevronRight, Plus, ListPlus, X, SlidersHorizontal, WifiOff, House, Radio } from 'lucide-react';
import { useStreamer } from '../contexts/StreamerContext';
import { usePlayer } from '../contexts/PlayerContext';
import { usePlaylist } from '../contexts/PlaylistContext';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';
import Toast from '../components/Toast';
import PlaylistPanel from '../components/PlaylistPanel';
import LikedSongsPanel from '../components/LikedSongsPanel';
import RecentlyPlayedPanel from '../components/RecentlyPlayedPanel';
import CreatePlaylistDialog from '../components/CreatePlaylistDialog';
import AlbumArt from '../components/AlbumArt';
import SidebarNav from '../components/SidebarNav';
import TimelineRow from '../components/TimelineRow';
import SongCard from '../components/SongCard';
import MobileSearchRow from '../components/MobileSearchRow';

interface Performance {
  id: string;
  streamId?: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number | null;
  note: string;
}

interface Song {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: Performance[];
  albumArtUrl?: string;
}

interface FlattenedSong extends Song {
  performanceId: string;
  streamId?: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  note: string;
  searchString: string;
  albumArtUrl?: string;
  year?: number;
}

type ViewMode = 'timeline' | 'grouped';

export default function Home() {
  const streamerData = useStreamer();
  const slug = streamerData.slug;
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [streams, setStreams] = useState<{id:string;title:string;date:string;videoId:string}[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [expandedSongs, setExpandedSongs] = useState<Set<string>>(new Set());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showPlaylistPanel, setShowPlaylistPanel] = useState(false);
  const [showLikedSongsPanel, setShowLikedSongsPanel] = useState(false);
  const [showRecentlyPlayedPanel, setShowRecentlyPlayedPanel] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [mobileTab, setMobileTab] = useState<'home' | 'search' | 'library' | 'streams'>('home');
  const [songs, setSongs] = useState<Song[]>([]);
  const [loadError, setLoadError] = useState(false);
  // Map from songId to albumArtUrl — populated from /api/metadata
  const albumArtMapRef = useRef<Map<string, string>>(new Map());

  // Fetch songs from API — extracted so the retry button can call it again
  const fetchSongs = () => {
    fetch(`/api/${slug}/songs`)
      .then(res => {
        if (!res.ok) throw new Error('API error');
        return res.json();
      })
      .then((data: Song[]) => {
        // Merge albumArtUrl from metadata map into songs
        const merged = data.map(song => ({
          ...song,
          albumArtUrl: albumArtMapRef.current.get(song.id),
        }));
        setSongs(merged);
        setLoadError(false);
      })
      .catch(() => {
        setLoadError(true);
      });
  };

  // Fetch metadata on mount and populate albumArtMap, then fetch songs
  useEffect(() => {
    fetch(`/api/${slug}/metadata`)
      .then(res => (res.ok ? res.json() : { songMetadata: [], artistInfo: [] }))
      .then((data: { songMetadata: { songId: string; albumArtUrl?: string; albumArtUrls?: { small: string } }[] }) => {
        const map = new Map<string, string>();
        for (const entry of data.songMetadata) {
          const url = entry.albumArtUrl ?? entry.albumArtUrls?.small;
          if (url) {
            map.set(entry.songId, url);
          }
        }
        albumArtMapRef.current = map;
      })
      .catch(() => {
        // metadata fetch failed — continue without art
      })
      .finally(() => {
        fetchSongs();
      });

    fetch(`/api/${slug}/streams`)
      .then(res => res.ok ? res.json() : [])
      .then((data: {id:string;title:string;date:string;videoId:string}[]) => {
        data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setStreams(data);
      })
      .catch(() => {
        // streams fetch failed — continue without stream list
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { currentTrack, playTrack, addToQueue, apiLoadError, unavailableVideoIds, timestampWarning, clearTimestampWarning, skipNotification, clearSkipNotification, shuffleOn, toggleShuffle } = usePlayer();
  const currentTrackId = currentTrack?.id ?? null;
  const { playlists, storageError, clearStorageError } = usePlaylist();
  const { likedCount } = useLikedSongs();
  const { recentCount } = useRecentlyPlayed();

  const handleAddToQueue = useCallback((track: { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string; streamerSlug: string }) => {
    addToQueue(track);
    setToastMessage('已加入播放佇列');
    setShowToast(true);
  }, [addToQueue]);

  const handlePlayAll = () => {
    type TrackInfo = { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string; streamerSlug: string };
    let tracks: TrackInfo[];
    if (viewMode === 'timeline') {
      tracks = flattenedSongs.map(s => ({
        id: s.performanceId, songId: s.id, title: s.title,
        originalArtist: s.originalArtist, videoId: s.videoId,
        timestamp: s.timestamp, endTimestamp: s.endTimestamp, albumArtUrl: s.albumArtUrl,
        streamerSlug: slug,
      }));
    } else {
      tracks = groupedSongs.flatMap(song => {
        if (!song.performances.length) return [];
        const latest = [...song.performances].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        return [{ id: latest.id, songId: song.id, title: song.title,
          originalArtist: song.originalArtist, videoId: latest.videoId,
          timestamp: latest.timestamp, endTimestamp: latest.endTimestamp ?? undefined, albumArtUrl: song.albumArtUrl,
          streamerSlug: slug,
        }];
      });
    }
    const available = tracks.filter(t => !unavailableVideoIds.has(t.videoId));
    if (available.length === 0) return;
    playTrack(available[0]);
    available.slice(1).forEach(t => addToQueue(t));
  };

  const handleAddToPlaylistSuccess = useCallback(() => {
    setToastMessage('已加入播放清單');
    setShowToast(true);
  }, []);

  // Show storage error toast
  useEffect(() => {
    if (storageError) {
      setToastMessage(storageError);
      setShowToast(true);
      clearStorageError();
    }
  }, [storageError, clearStorageError]);

  // Show timestamp warning toast
  useEffect(() => {
    if (timestampWarning) {
      setToastMessage(timestampWarning);
      setShowToast(true);
      clearTimestampWarning();
    }
  }, [timestampWarning, clearTimestampWarning]);

  // Show skip notification toast (deleted version skipped or playlist ended)
  useEffect(() => {
    if (skipNotification) {
      setToastMessage(skipNotification);
      setShowToast(true);
      clearSkipNotification();
    }
  }, [skipNotification, clearSkipNotification]);

  // Load view preference from sessionStorage
  useEffect(() => {
    const savedView = sessionStorage.getItem('mizukiprism-view-mode');
    if (savedView === 'timeline' || savedView === 'grouped') {
      setViewMode(savedView);
    }
  }, []);

  // Save view preference to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('mizukiprism-view-mode', viewMode);
  }, [viewMode]);

  // Debounce search input — 150ms delay before triggering filter
  useEffect(() => {
    if (searchInput === '') {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 150);
    return () => clearTimeout(timer);
  }, [searchInput]);

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

  const allArtists = useMemo(() => {
    const artists = new Set<string>();
    songs.forEach(song => artists.add(song.originalArtist));
    return Array.from(artists).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }, [songs]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    streams.forEach(s => years.add(new Date(s.date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [streams]);

  const filteredStreams = useMemo(() => {
    if (selectedYears.size === 0) return streams;
    return streams.filter(s => selectedYears.has(new Date(s.date).getFullYear()));
  }, [streams, selectedYears]);

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

  const hasActiveFilters = searchInput !== '' || selectedStreamId !== null || selectedArtist !== null || selectedYears.size > 0;

  const clearAllFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedStreamId(null);
    setSelectedArtist(null);
    setSelectedYears(new Set());
  };

  // Flatten + sort: expensive, only recomputes when song data changes
  const allFlattenedSongs: FlattenedSong[] = useMemo(() => {
    const result: FlattenedSong[] = [];
    songs.forEach(song => {
      song.performances.forEach(perf => {
        result.push({
          ...song,
          performanceId: perf.id,
          streamId: perf.streamId,
          date: perf.date,
          streamTitle: perf.streamTitle,
          videoId: perf.videoId,
          timestamp: perf.timestamp,
          endTimestamp: perf.endTimestamp ?? undefined,
          note: perf.note,
          searchString: `${song.title} ${song.originalArtist} ${perf.streamTitle}`.toLowerCase(),
          year: new Date(perf.date).getFullYear(),
        });
      });
    });
    result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return result;
  }, [songs]);

  // Filter: cheap, runs against pre-flattened array
  const flattenedSongs: FlattenedSong[] = useMemo(() => {
    const lowerTerm = debouncedSearch.toLowerCase();
    return allFlattenedSongs.filter(song => {
      const matchesSearch = !lowerTerm || song.searchString.includes(lowerTerm);
      const matchesStream = selectedStreamId ? song.streamId === selectedStreamId : true;
      const matchesArtist = selectedArtist ? song.originalArtist === selectedArtist : true;
      const matchesYear = selectedYears.size > 0 ? selectedYears.has(song.year!) : true;
      return matchesSearch && matchesStream && matchesArtist && matchesYear;
    });
  }, [allFlattenedSongs, debouncedSearch, selectedStreamId, selectedArtist, selectedYears]);

  // Grouped songs: separate sort (expensive) from filter (cheap)
  const allGroupedSongs: Song[] = useMemo(() => {
    return [...songs].sort((a, b) => a.title.localeCompare(b.title, 'zh-TW'));
  }, [songs]);

  const groupedSongs: Song[] = useMemo(() => {
    const lowerTerm = debouncedSearch.toLowerCase();
    return allGroupedSongs.filter(song => {
      const matchesSearch = !lowerTerm || `${song.title} ${song.originalArtist}`.toLowerCase().includes(lowerTerm);
      const matchesStream = selectedStreamId
        ? song.performances.some(p => p.streamId === selectedStreamId)
        : true;
      const matchesArtist = selectedArtist ? song.originalArtist === selectedArtist : true;
      const matchesYear = selectedYears.size > 0
        ? song.performances.some(perf => selectedYears.has(new Date(perf.date).getFullYear()))
        : true;
      return matchesSearch && matchesStream && matchesArtist && matchesYear;
    });
  }, [allGroupedSongs, debouncedSearch, selectedStreamId, selectedArtist, selectedYears]);

  // Virtual scrolling refs and virtualizers
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineListRef = useRef<HTMLDivElement>(null);
  const groupedListRef = useRef<HTMLDivElement>(null);
  const mobileSearchListRef = useRef<HTMLDivElement>(null);

  // Only activate the virtualizer for the current view to avoid scroll conflicts
  const isTimelineActive = viewMode === 'timeline' && mobileTab === 'home';
  const isGroupedActive = viewMode === 'grouped' && mobileTab === 'home';
  const isMobileSearchActive = mobileTab === 'search';

  const timelineVirtualizer = useVirtualizer({
    count: isTimelineActive ? flattenedSongs.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56,
    overscan: 15,
    scrollMargin: timelineListRef.current?.offsetTop ?? 0,
  });

  const groupedVirtualizer = useVirtualizer({
    count: isGroupedActive ? groupedSongs.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 96,
    overscan: 10,
    scrollMargin: groupedListRef.current?.offsetTop ?? 0,
  });

  const mobileSearchVirtualizer = useVirtualizer({
    count: isMobileSearchActive ? flattenedSongs.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 64,
    overscan: 15,
    scrollMargin: mobileSearchListRef.current?.offsetTop ?? 0,
  });

  const gradientText = "bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500";

  return (
    <>
      <Toast message={toastMessage} show={showToast} onHide={() => setShowToast(false)} />
      {/* API Load Error Banner */}
      {apiLoadError && (
        <div
          data-testid="api-load-error"
          className="fixed top-0 left-0 right-0 z-[300] bg-red-500 text-white px-6 py-3 flex items-center justify-center gap-3 shadow-lg"
        >
          <span className="font-bold text-sm">{apiLoadError}</span>
        </div>
      )}
      <div className="flex h-screen bg-gradient-to-br from-[#fff0f5] via-[#f0f8ff] to-[#e6e6fa] text-slate-600 font-sans selection:bg-pink-200 selection:text-pink-900 overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%)' }}>

      {/* Sidebar */}
      <SidebarNav
        activePage="home"
        isHomeActive={!hasActiveFilters}
        onHomeClick={clearAllFilters}
        onCreatePlaylist={() => setShowCreateDialog(true)}
        onViewPlaylists={() => setShowPlaylistPanel(true)}
        playlistCount={playlists.length}
        onViewLikedSongs={() => setShowLikedSongsPanel(true)}
        likedSongsCount={likedCount}
        onViewRecentlyPlayed={() => setShowRecentlyPlayedPanel(true)}
        recentlyPlayedCount={recentCount}
        searchSlot={
          <div className="px-3 pb-3 flex-shrink-0">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search
                  className="w-4 h-4 transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                />
              </div>
              <input
                type="text"
                placeholder="搜尋歌曲..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full font-medium py-2.5 pl-9 pr-4 outline-none transition-all text-base"
                style={{
                  background: 'var(--bg-surface-glass)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-pill)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          </div>
        }
      >
        {/* ── Filters Section ── */}
        <div className="pt-2 pb-1">
          <div
            className="px-3 py-1.5 mb-1 font-bold uppercase tracking-widest flex items-center gap-2"
            style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)', letterSpacing: '0.1em' }}
          >
            <SlidersHorizontal className="w-3 h-3" />
            篩選條件
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="ml-auto text-xs font-medium transition-colors"
                style={{ color: 'var(--accent-pink)', fontSize: 'var(--font-size-xs)' }}
                data-testid="clear-all-filters"
              >
                清除全部
              </button>
            )}
          </div>

          {/* Artist dropdown */}
          <div className="relative px-1 mb-2">
            <select
              value={selectedArtist ?? ''}
              onChange={(e) => setSelectedArtist(e.target.value || null)}
              className="w-full font-medium py-2 px-3 outline-none appearance-none text-sm cursor-pointer transition-all"
              style={{
                background: 'var(--bg-surface-glass)',
                border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-lg)',
                color: 'var(--text-secondary)',
              }}
              data-testid="artist-filter"
            >
              <option value="">全部歌手</option>
              {allArtists.map(artist => (
                <option key={artist} value={artist}>{artist}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
              <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
            </div>
          </div>

          {/* Year filter chips */}
          <div className="flex flex-wrap gap-1.5 px-1" data-testid="year-filter-sidebar">
            {availableYears.map(year => (
              <button
                key={year}
                data-testid="year-filter-chip"
                onClick={() => toggleYear(year)}
                className="font-medium text-sm transition-all"
                style={{
                  borderRadius: 'var(--radius-pill)',
                  padding: '4px 12px',
                  ...(selectedYears.has(year)
                    ? { background: 'var(--bg-accent-pink)', color: 'var(--accent-pink)' }
                    : { background: 'var(--bg-surface-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)' }),
                }}
              >
                {year}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stream Playlists Section ── */}
        <div className="pt-2 pb-2">
          <div
            className="px-3 py-1.5 mb-1 font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)', letterSpacing: '0.1em' }}
          >
            歌枠回放{selectedYears.size > 0 && ` (${Array.from(selectedYears).sort().join(', ')})`}
          </div>
          <button
            onClick={() => setSelectedStreamId(null)}
            className="w-full text-left px-3 py-2 rounded-radius-lg text-sm font-medium transition-all"
            style={
              selectedStreamId === null
                ? { color: 'var(--accent-pink)', background: 'var(--bg-accent-pink)' }
                : { color: 'var(--text-secondary)', background: 'transparent' }
            }
          >
            全部歌曲
          </button>
          {filteredStreams.map(stream => (
            <button
              key={stream.id}
              data-testid="stream-filter-button"
              onClick={() => setSelectedStreamId(stream.id === selectedStreamId ? null : stream.id)}
              className="w-full text-left px-3 py-2 rounded-radius-lg text-sm font-medium transition-all hover:bg-white/40"
              style={
                selectedStreamId === stream.id
                  ? { color: 'var(--accent-pink)', background: 'var(--bg-accent-pink)' }
                  : { color: 'var(--text-secondary)', background: 'transparent' }
              }
            >
              <div className="truncate">{stream.title}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{stream.date}</div>
            </button>
          ))}
        </div>
      </SidebarNav>

      {/* Mobile TopBar — 56px + safe area, fixed top, mobile only */}
      <div
        data-testid="mobile-topbar"
        className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-center"
        style={{
          height: '56px',
          padding: 'var(--safe-area-top) 20px 0 20px',
          background: 'var(--bg-surface-frosted)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-glass)',
        }}
      >
        <span
          style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}
        >
          {streamerData.displayName}
        </span>
      </div>

      {/* Main Content */}
      <main className="flex-1 lg:m-3 lg:rounded-3xl overflow-hidden relative shadow-2xl shadow-indigo-100/50 bg-white/40 backdrop-blur-md border border-white/60 flex flex-col" style={{ background: 'var(--bg-surface-glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-3xl)' }}>

        {/* Decorative glows */}
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-pink-300/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute top-40 -left-20 w-72 h-72 bg-blue-300/20 rounded-full blur-3xl pointer-events-none"></div>

        {/* Scrollable area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar relative z-10 pt-14 lg:pt-0">

          {/* Home tab content wrapper: always visible on desktop, only on home tab on mobile */}
          <div className={mobileTab !== 'home' ? 'hidden lg:block' : ''}>

          {/* Mobile Hero Section (§3.4.9.3) — vertical layout, mobile only */}
          <header
            data-testid="mobile-hero"
            className="lg:hidden flex flex-col items-center flex-shrink-0"
            style={{
              padding: '16px 24px 24px 24px',
              borderBottom: '1px solid var(--border-glass)',
              gap: '12px',
            }}
          >
            {/* Avatar: 160×160 circle with gradient border and outer shadow */}
            <div
              className="flex-shrink-0"
              style={{
                width: '160px',
                height: '160px',
                borderRadius: 'var(--radius-xl)',
                padding: '3px',
                background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                boxShadow: '0 8px 32px rgba(244, 114, 182, 0.25)',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 'var(--radius-xl)',
                  overflow: 'hidden',
                }}
              >
                <img
                  src={streamerData.avatarUrl}
                  alt={streamerData.displayName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => {
                    const target = e.currentTarget as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      parent.style.background = 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))';
                    }
                  }}
                />
              </div>
            </div>

            {/* Verified Badge: sparkles icon + "Verified Artist" */}
            <div
              className="flex items-center gap-1.5"
              style={{
                background: '#FDF2F8',
                borderRadius: 'var(--radius-pill)',
                padding: '4px 12px 4px 8px',
                color: 'var(--accent-pink)',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              <Sparkles style={{ width: '12px', height: '12px' }} />
              Verified Artist
            </div>

            {/* Streamer Name: fontSize 36, fontWeight 900, letterSpacing -0.5 */}
            <h1
              style={{
                fontSize: '36px',
                fontWeight: 900,
                letterSpacing: '-0.5px',
                color: 'var(--text-primary)',
                lineHeight: 1.1,
                textAlign: 'center',
                margin: 0,
              }}
            >
              {streamerData.displayName}
            </h1>

            {/* Description: "Virtual Singer & Streamer · {songCount} Songs", fontSize 13, centered */}
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {streamerData.description}
              {' '}
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              {' '}
              <span style={{ fontWeight: 600 }}>{flattenedSongs.length} 首歌曲</span>
            </p>

            {/* Stats row: followerCount Followers · Rank #rank (rank in accent-pink), centered */}
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              21.8萬位訂閱者
              {' '}
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              {' '}
              Rank{' '}
              <span style={{ color: 'var(--accent-pink)', fontWeight: 700 }}>#1</span>
            </p>
          </header>

          {/* Hero Section - Streamer Profile (~280px height) — desktop only */}
          <header
            className="relative hidden lg:flex items-center gap-8 overflow-hidden flex-shrink-0"
            style={{
              minHeight: '280px',
              padding: '40px 40px 0 40px',
              borderBottom: '1px solid var(--border-glass)',
            }}
          >
            {/* Left: Avatar */}
            <div
              className="flex-shrink-0 overflow-hidden"
              style={{
                width: '180px',
                height: '180px',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-glass)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                alignSelf: 'flex-end',
                marginBottom: '40px',
              }}
            >
              <img
                src={streamerData.avatarUrl}
                alt={streamerData.displayName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    parent.style.background = 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))';
                    parent.style.display = 'flex';
                    parent.style.alignItems = 'center';
                    parent.style.justifyContent = 'center';
                  }
                }}
              />
            </div>

            {/* Right: Info Stack */}
            <div
              className="flex flex-col justify-end flex-1 min-w-0"
              style={{
                paddingBottom: '40px',
                gap: '8px',
              }}
            >
              {/* VerifiedBadge Component */}
              <div
                className="flex items-center gap-1.5 w-fit"
                style={{
                  background: 'var(--bg-accent-blue-muted)',
                  color: 'var(--accent-blue)',
                  borderRadius: 'var(--radius-pill)',
                  padding: '4px 12px 4px 8px',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 0L7.545 4.455L12 6L7.545 7.545L6 12L4.455 7.545L0 6L4.455 4.455L6 0Z" fill="currentColor" />
                </svg>
                認證藝人
              </div>

              {/* Streamer Name */}
              <h1
                className="tracking-tight leading-none"
                style={{
                  fontSize: 'var(--font-size-3xl)',
                  fontWeight: 900,
                  color: 'var(--text-primary)',
                  lineHeight: 1.1,
                }}
              >
                {streamerData.displayName}
              </h1>

              {/* Description / Stats Text */}
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--font-size-base)',
                  maxWidth: '480px',
                  lineHeight: 1.5,
                  margin: '2px 0',
                }}
              >
                {streamerData.description}
                {' '}
                <span style={{ color: 'var(--text-tertiary)' }}>·</span>
                {' '}
                <span style={{ fontWeight: 600 }}>{flattenedSongs.length} 首歌曲</span>
              </p>

              {/* Statistics Row: Followers + Rank */}
              <div
                className="flex items-center gap-6"
                style={{ fontSize: 'var(--font-size-base)', marginTop: '4px' }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-size-xl)' }}
                  >
                    21.8萬
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                    訂閱者
                  </span>
                </div>
                <div
                  style={{
                    width: '1px',
                    height: '16px',
                    background: 'var(--border-default)',
                  }}
                />
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ fontWeight: 700, color: 'var(--accent-pink)', fontSize: 'var(--font-size-xl)' }}
                  >
                    #1
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                    排名
                  </span>
                </div>
              </div>

              {/* Social Links Row */}
              <div className="flex items-center gap-2" style={{ marginTop: '4px' }}>
                {/* YouTube SocialButton */}
                <a
                  href={streamerData.socialLinks.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-all hover:opacity-80"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '6px 14px 6px 10px',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <Youtube className="w-4 h-4" style={{ color: '#FF0000' }} />
                  YouTube
                </a>
                {/* Twitter SocialButton */}
                <a
                  href={streamerData.socialLinks.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-all hover:opacity-80"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '6px 14px 6px 10px',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <Twitter className="w-4 h-4" style={{ color: '#1DA1F2' }} />
                  X
                </a>
                {/* Facebook SocialButton */}
                <a
                  href={streamerData.socialLinks.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-all hover:opacity-80"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '6px 14px 6px 10px',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <Facebook className="w-4 h-4" style={{ color: '#1877F2' }} />
                  Facebook
                </a>
                {/* Instagram SocialButton */}
                <a
                  href={streamerData.socialLinks.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-all hover:opacity-80"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '6px 14px 6px 10px',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <Instagram className="w-4 h-4" style={{ color: '#E4405F' }} />
                  Instagram
                </a>
                {/* Twitch SocialButton */}
                <a
                  href={streamerData.socialLinks.twitch}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-all hover:opacity-80"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '6px 14px 6px 10px',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <Twitch className="w-4 h-4" style={{ color: '#9146FF' }} />
                  Twitch
                </a>
              </div>
            </div>

            {/* Bottom gradient overlay: white fading to transparent from bottom up */}
            <div
              className="absolute bottom-0 left-0 right-0 pointer-events-none"
              style={{
                height: '60px',
                background: 'linear-gradient(to top, rgba(255,255,255,0.6) 0%, transparent 100%)',
              }}
            />
          </header>

          {/* Mobile Action Bar (§3.4.9.4) — horizontal layout, mobile only */}
          <div
            data-testid="mobile-action-bar"
            className="lg:hidden flex items-center flex-shrink-0"
            style={{
              padding: '0 20px',
              gap: '12px',
              minHeight: '64px',
              background: 'var(--bg-overlay)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderBottom: '1px solid var(--border-glass)',
            }}
          >
            {/* Play button: 48×48 circle, gradient fill (pink→blue) */}
            <button
              data-testid="mobile-play-all-button"
              className="flex items-center justify-center flex-shrink-0 transition-all hover:scale-105"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                color: 'white',
                boxShadow: '0 4px 16px rgba(244, 114, 182, 0.35)',
              }}
              title="播放全部"
              onClick={handlePlayAll}
            >
              <Play className="w-5 h-5 fill-current" style={{ marginLeft: '2px' }} />
            </button>

            {/* Shuffle button: gradient fill when active, outline when off */}
            <button
              data-testid="mobile-shuffle-button"
              onClick={() => toggleShuffle()}
              className="flex items-center justify-center flex-shrink-0 transition-all hover:opacity-90"
              style={{
                background: shuffleOn
                  ? 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))'
                  : 'transparent',
                border: shuffleOn ? 'none' : '2px solid var(--accent-pink-light)',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 28px',
                color: shuffleOn ? 'white' : 'var(--accent-pink)',
              }}
              title="隨機播放"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            {/* Flexible spacer */}
            <div style={{ flex: 1 }} />

            {/* Follow button: outline style */}
            <a
              href={streamerData.socialLinks.youtube}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="mobile-follow-button"
              className="flex items-center justify-center flex-shrink-0 font-semibold transition-all hover:opacity-80"
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: '20px',
                padding: '8px 24px',
                color: 'var(--text-secondary)',
                fontSize: 'var(--font-size-sm)',
                background: 'transparent',
              }}
            >
              追蹤
            </a>
          </div>

          {/* Mobile Year Filter Scroll — horizontal scrolling row, mobile only */}
          <div
            data-testid="mobile-stream-scroll"
            className="lg:hidden flex items-center flex-shrink-0 sticky top-0 z-[15]"
            style={{
              padding: '12px 20px',
              gap: '8px',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              borderBottom: '1px solid var(--border-glass)',
              background: 'var(--bg-surface-frosted)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            {/* All years chip */}
            <button
              onClick={clearYears}
              className="flex-shrink-0 font-medium transition-all"
              style={{
                height: '36px',
                borderRadius: '12px',
                padding: '0 16px',
                fontSize: 'var(--font-size-sm)',
                ...(selectedYears.size === 0
                  ? {
                      background: 'var(--bg-accent-pink)',
                      border: '1px solid var(--border-accent-pink)',
                      color: 'var(--accent-pink)',
                    }
                  : {
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                    }),
              }}
            >
              全部
            </button>
            {availableYears.map(year => (
              <button
                key={year}
                data-testid="year-filter-chip"
                onClick={() => toggleYear(year)}
                className="flex-shrink-0 font-medium transition-all"
                style={{
                  height: '36px',
                  borderRadius: '12px',
                  padding: '0 16px',
                  fontSize: 'var(--font-size-sm)',
                  whiteSpace: 'nowrap',
                  ...(selectedYears.has(year)
                    ? {
                        background: 'var(--bg-accent-pink)',
                        border: '1px solid var(--border-accent-pink)',
                        color: 'var(--accent-pink)',
                      }
                    : {
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary)',
                      }),
                }}
              >
                {year}
              </button>
            ))}
          </div>

          {/* Action Bar — desktop only */}
          <div
            className="hidden lg:flex sticky top-0 z-20 px-6 items-center gap-3 flex-wrap"
            style={{
              background: 'var(--bg-overlay)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderTop: '1px solid var(--border-glass)',
              borderBottom: '1px solid var(--border-glass)',
              minHeight: '64px',
              paddingTop: '10px',
              paddingBottom: '10px',
            }}
          >
            {/* Left side: Play Controls */}
            <div className="flex items-center gap-3 flex-shrink-0">

              {/* PlayButton — 48×48 circular gradient play button */}
              <button
                data-testid="desktop-play-all-button"
                className="bg-gradient-to-r from-pink-400 to-blue-400 text-white flex items-center justify-center transition-all hover:scale-105 hover:brightness-110 flex-shrink-0"
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-circle)',
                  background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                  boxShadow: '0 4px 16px rgba(244, 114, 182, 0.35)',
                }}
                title="播放全部"
                onClick={handlePlayAll}
              >
                <Play className="w-5 h-5 fill-current" style={{ marginLeft: '2px' }} />
              </button>

              {/* GradientButton — "播放全部" pill */}
              <button
                className="font-semibold text-white flex items-center gap-1.5 transition-all hover:opacity-90 flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--font-size-sm)',
                  padding: 'var(--space-3) var(--space-5)',
                  color: 'var(--text-on-accent)',
                }}
                onClick={handlePlayAll}
              >
                播放全部
              </button>

              {/* OutlineButton — "追蹤" follow link (secondary action) */}
              <a
                href={streamerData.socialLinks.youtube}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold flex items-center gap-1.5 transition-all hover:opacity-80 flex-shrink-0"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--font-size-sm)',
                  padding: 'var(--space-3) var(--space-5)',
                  color: 'var(--text-secondary)',
                }}
              >
                追蹤
              </a>

              {/* View Mode Toggle — restyled to match design language */}
              <div
                className="hidden lg:flex items-center gap-1 flex-shrink-0"
                style={{
                  background: 'var(--bg-surface-muted)',
                  borderRadius: 'var(--radius-pill)',
                  padding: '3px',
                  border: '1px solid var(--border-glass)',
                }}
              >
                <button
                  data-testid="view-toggle-timeline"
                  onClick={() => setViewMode('timeline')}
                  className={`flex items-center gap-1.5 font-semibold transition-all ${
                    viewMode === 'timeline'
                      ? 'bg-gradient-to-r from-accent-pink-light to-accent-blue-light text-white shadow-md'
                      : ''
                  }`}
                  style={{
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-2) var(--space-4)',
                    color: viewMode === 'timeline' ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  }}
                >
                  <Clock className="w-3.5 h-3.5" />
                  時間序列
                </button>
                <button
                  data-testid="view-toggle-grouped"
                  onClick={() => setViewMode('grouped')}
                  className={`flex items-center gap-1.5 font-semibold transition-all ${
                    viewMode === 'grouped'
                      ? 'bg-gradient-to-r from-accent-pink-light to-accent-blue-light text-white shadow-md'
                      : ''
                  }`}
                  style={{
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-2) var(--space-4)',
                    color: viewMode === 'grouped' ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  }}
                >
                  <Disc3 className="w-3.5 h-3.5" />
                  歌曲分組
                </button>
              </div>
            </div>

            {/* Flexible spacer */}
            <div className="flex-1 hidden lg:block" />

            {/* Right side: Year Filter Chips */}
            <div className="hidden lg:flex items-center gap-1.5 flex-wrap" data-testid="year-filter-bar">
              {/* "全部" chip */}
              <button
                onClick={clearYears}
                className="font-medium transition-all"
                style={{
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--font-size-sm)',
                  padding: 'var(--space-2) var(--space-4)',
                  ...(selectedYears.size === 0
                    ? {
                        background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                        color: 'var(--text-on-accent)',
                      }
                    : {
                        background: 'var(--bg-surface-muted)',
                        color: 'var(--text-secondary)',
                      }),
                }}
              >
                全部
              </button>
              {availableYears.map(year => (
                <button
                  key={year}
                  data-testid="year-filter-chip"
                  onClick={() => toggleYear(year)}
                  className="font-medium transition-all"
                  style={{
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-2) var(--space-4)',
                    ...(selectedYears.has(year)
                      ? {
                          background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                          color: 'var(--text-on-accent)',
                        }
                      : {
                          background: 'var(--bg-surface-muted)',
                          color: 'var(--text-secondary)',
                        }),
                  }}
                >
                  {year}
                </button>
              ))}
            </div>

          </div>

          {/* Song List - Conditional Rendering based on View Mode */}
          <div className="px-4 pb-32 mt-2">
            {/* Always-visible logical counts for E2E tests (virtual scrolling caps DOM nodes) */}
            <span data-testid="total-performance-count" className="sr-only">{flattenedSongs.length}</span>
            <span data-testid="total-song-card-count" className="sr-only">{groupedSongs.length}</span>
            {loadError ? (
              /* Song API Load Error State */
              <div
                data-testid="song-load-error"
                className="flex flex-col items-center justify-center py-32 gap-6"
                style={{ color: 'var(--text-secondary)' }}
              >
                <div
                  className="flex items-center justify-center w-16 h-16 rounded-full"
                  style={{ background: 'var(--bg-accent-pink-muted)' }}
                >
                  <WifiOff className="w-8 h-8" style={{ color: 'var(--accent-pink)' }} />
                </div>
                <p
                  className="text-center font-medium max-w-sm"
                  style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-base)', lineHeight: 1.6 }}
                >
                  無法載入歌曲資料，請檢查網路連線後重新整理頁面
                </p>
                <button
                  data-testid="retry-button"
                  onClick={fetchSongs}
                  className="font-semibold transition-all hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-3) var(--space-6)',
                    color: 'var(--text-on-accent)',
                  }}
                >
                  重新整理
                </button>
              </div>
            ) : viewMode === 'timeline' ? (
              /* Timeline View */
              <>
                {/* SongTableHeader */}
                <div
                  className="grid grid-cols-[32px_40px_1fr_60px] lg:grid-cols-[32px_40px_2fr_2fr_100px_60px] gap-0 px-3 py-2 sticky top-[60px] lg:top-[88px] z-10"
                  style={{
                    borderBottom: '1px solid var(--border-table)',
                    background: 'var(--bg-surface-frosted)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <div
                    className="flex items-center justify-center text-center font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
                  >
                    #
                  </div>
                  {/* Album art header spacer */}
                  <div />
                  <div
                    className="flex items-center font-bold uppercase tracking-wider lg:pl-3"
                    style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
                  >
                    標題
                  </div>
                  <div
                    className="hidden lg:flex items-center font-bold uppercase tracking-wider pl-3"
                    style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
                  >
                    出處直播
                  </div>
                  <div
                    className="hidden lg:flex items-center font-bold uppercase tracking-wider pl-3"
                    style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
                  >
                    發布日期
                  </div>
                  <div
                    className="flex items-center justify-center"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    <Clock style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                  </div>
                </div>

                <div className="mt-1">
                  {flattenedSongs.length === 0 ? (
                    songs.length === 0 && !hasActiveFilters ? (
                      <div className="py-20 text-center" data-testid="empty-catalog" style={{ color: 'var(--text-tertiary)' }}>
                        <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>目前尚無歌曲資料</p>
                      </div>
                    ) : (
                      <div className="py-20 text-center" data-testid="empty-state" style={{ color: 'var(--text-tertiary)' }}>
                        <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>找不到符合條件的歌曲</p>
                        {hasActiveFilters && (
                          <button
                            onClick={clearAllFilters}
                            className="mt-3 text-sm font-medium underline underline-offset-2 transition-colors"
                            style={{ color: 'var(--accent-pink)' }}
                            data-testid="clear-filters-empty"
                          >
                            清除所有篩選條件
                          </button>
                        )}
                      </div>
                    )
                  ) : (
                    <div
                      ref={timelineListRef}
                      style={{
                        height: `${timelineVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                      }}
                    >
                      {timelineVirtualizer.getVirtualItems().map(virtualItem => {
                        const song = flattenedSongs[virtualItem.index];
                        return (
                          <div
                            key={`${song.id}-${song.performanceId}`}
                            data-index={virtualItem.index}
                            ref={timelineVirtualizer.measureElement}
                            className="hover:z-10 focus-within:z-10"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualItem.start - (timelineVirtualizer.options.scrollMargin ?? 0)}px)`,
                            }}
                          >
                            <TimelineRow
                              song={song}
                              index={virtualItem.index}
                              isCurrentlyPlaying={currentTrackId === song.performanceId}
                              isUnavailable={unavailableVideoIds.has(song.videoId)}
                              onPlay={playTrack}
                              streamerSlug={slug}
                              onAddToQueue={handleAddToQueue}
                              onAddToPlaylistSuccess={handleAddToPlaylistSuccess}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Grouped View */
              <div className="mt-2">
                {groupedSongs.length === 0 ? (
                  songs.length === 0 && !hasActiveFilters ? (
                    <div className="py-20 text-center" data-testid="empty-catalog" style={{ color: 'var(--text-tertiary)' }}>
                      <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>目前尚無歌曲資料</p>
                    </div>
                  ) : (
                    <div className="py-20 text-center" data-testid="empty-state" style={{ color: 'var(--text-tertiary)' }}>
                      <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>找不到符合條件的歌曲</p>
                      {hasActiveFilters && (
                        <button
                          onClick={clearAllFilters}
                          className="mt-3 text-sm font-medium underline underline-offset-2 transition-colors"
                          style={{ color: 'var(--accent-pink)' }}
                          data-testid="clear-filters-empty"
                        >
                          清除所有篩選條件
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div
                    ref={groupedListRef}
                    style={{
                      height: `${groupedVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {groupedVirtualizer.getVirtualItems().map(virtualItem => {
                      const song = groupedSongs[virtualItem.index];
                      return (
                        <div
                          key={song.id}
                          data-index={virtualItem.index}
                          ref={groupedVirtualizer.measureElement}
                          className="hover:z-10 focus-within:z-10"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualItem.start - (groupedVirtualizer.options.scrollMargin ?? 0)}px)`,
                            paddingBottom: '12px',
                          }}
                        >
                          <SongCard
                            song={song}
                            isExpanded={expandedSongs.has(song.id)}
                            onToggleExpand={toggleSongExpansion}
                            onPlay={playTrack}
                            onAddToQueue={handleAddToQueue}
                            onAddToPlaylistSuccess={handleAddToPlaylistSuccess}
                            unavailableVideoIds={unavailableVideoIds}
                            streamerSlug={slug}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* End home tab content wrapper */}
          </div>

          {/* Mobile Search Tab content — only visible on mobile when Search tab is active */}
          {mobileTab === 'search' && (
            <div
              className="lg:hidden flex-1 px-4 pt-4 pb-32"
              data-testid="mobile-search-tab"
            >
              {/* Search input */}
              <div className="relative mb-4">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                  style={{ color: 'var(--text-tertiary)' }}
                />
                <input
                  type="text"
                  placeholder="搜尋..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full py-3 pl-10 pr-4 text-base outline-none"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-pill)',
                    color: 'var(--text-primary)',
                    backdropFilter: 'blur(8px)',
                  }}
                  data-testid="mobile-search-input"
                  autoFocus
                />
              </div>
              {/* Artist filter */}
              <div className="relative mb-3">
                <select
                  value={selectedArtist ?? ''}
                  onChange={(e) => setSelectedArtist(e.target.value || null)}
                  className="w-full font-medium py-2 px-3 outline-none appearance-none text-sm cursor-pointer"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-lg)',
                    color: 'var(--text-secondary)',
                  }}
                  data-testid="mobile-artist-filter"
                >
                  <option value="">全部歌手</option>
                  {allArtists.map(artist => (
                    <option key={artist} value={artist}>{artist}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                  <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
                </div>
              </div>
              {/* Search results */}
              <div>
                {flattenedSongs.length === 0 ? (
                  <div className="py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
                    <p className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>找不到符合條件的歌曲</p>
                  </div>
                ) : (
                  <div
                    ref={mobileSearchListRef}
                    style={{
                      height: `${mobileSearchVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {mobileSearchVirtualizer.getVirtualItems().map(virtualItem => {
                      const song = flattenedSongs[virtualItem.index];
                      return (
                        <div
                          key={`search-${song.id}-${song.performanceId}`}
                          data-index={virtualItem.index}
                          ref={mobileSearchVirtualizer.measureElement}
                          className="hover:z-10 focus-within:z-10"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualItem.start - (mobileSearchVirtualizer.options.scrollMargin ?? 0)}px)`,
                          }}
                        >
                          <MobileSearchRow
                            song={song}
                            isCurrentlyPlaying={currentTrackId === song.performanceId}
                            isUnavailable={unavailableVideoIds.has(song.videoId)}
                            onPlay={playTrack}
                            streamerSlug={slug}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile Library Tab content — only visible on mobile when Library tab is active */}
          {mobileTab === 'library' && (
            <div
              className="lg:hidden flex-1 px-4 pt-4 pb-32"
              data-testid="mobile-library-tab"
            >
              <div className="mb-4">
                <h2 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>你的音樂庫</h2>

                {/* Liked Songs */}
                <button
                  onClick={() => setShowLikedSongsPanel(true)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-radius-lg font-medium text-sm transition-all mb-2"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-lg)',
                  }}
                  data-testid="mobile-liked-songs-button"
                >
                  <span className="flex items-center gap-3">
                    <Heart className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-pink)' }} />
                    喜愛的歌曲
                  </span>
                  {likedCount > 0 && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: 'var(--bg-accent-pink-muted)', color: 'var(--accent-pink)' }}
                    >
                      {likedCount}
                    </span>
                  )}
                </button>

                {/* Recently Played */}
                <button
                  onClick={() => setShowRecentlyPlayedPanel(true)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-radius-lg font-medium text-sm transition-all mb-2"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-lg)',
                  }}
                  data-testid="mobile-recently-played-button"
                >
                  <span className="flex items-center gap-3">
                    <Clock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-pink)' }} />
                    最近播放
                  </span>
                  {recentCount > 0 && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: 'var(--bg-accent-pink-muted)', color: 'var(--accent-pink)' }}
                    >
                      {recentCount}
                    </span>
                  )}
                </button>

                {/* Create Playlist */}
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-radius-lg font-medium text-sm transition-all"
                  style={{
                    background: 'var(--bg-surface-glass)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-lg)',
                  }}
                  data-testid="mobile-create-playlist-button"
                >
                  <Plus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-pink)' }} />
                  建立新播放清單
                </button>
              </div>
              {playlists.length > 0 ? (
                <div>
                  <button
                    onClick={() => setShowPlaylistPanel(true)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-radius-lg font-medium text-sm transition-all mb-2"
                    style={{
                      background: 'var(--bg-surface-glass)',
                      border: '1px solid var(--border-glass)',
                      color: 'var(--text-secondary)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                    data-testid="mobile-view-playlists-button"
                  >
                    <span className="flex items-center gap-3">
                      <ListMusic className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-pink)' }} />
                      查看播放清單
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: 'var(--bg-accent-pink-muted)', color: 'var(--accent-pink)' }}
                    >
                      {playlists.length}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  <p className="text-base" style={{ color: 'var(--text-secondary)' }}>尚無播放清單，立即建立一個吧！</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile Streams Tab content — only visible on mobile when Streams tab is active */}
          {mobileTab === 'streams' && (
            <div
              className="lg:hidden flex-1 px-4 pt-4 pb-32"
              data-testid="mobile-streams-tab"
            >
              <h2 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>歌枠回放</h2>

              {/* Year filter chips */}
              <div className="flex gap-1.5 mb-4 overflow-x-auto" data-testid="mobile-streams-year-filter">
                {availableYears.map(year => (
                  <button
                    key={year}
                    data-testid="mobile-streams-year-chip"
                    onClick={() => toggleYear(year)}
                    className="font-medium text-sm transition-all flex-shrink-0"
                    style={{
                      borderRadius: 'var(--radius-pill)',
                      padding: '4px 12px',
                      ...(selectedYears.has(year)
                        ? { background: 'var(--bg-accent-pink)', color: 'var(--accent-pink)' }
                        : { background: 'var(--bg-surface-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)' }),
                    }}
                  >
                    {year}
                  </button>
                ))}
                {selectedYears.size > 0 && (
                  <button
                    onClick={clearYears}
                    className="font-medium text-xs transition-all flex-shrink-0"
                    style={{
                      borderRadius: 'var(--radius-pill)',
                      padding: '4px 10px',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    清除
                  </button>
                )}
              </div>

              {/* All songs button */}
              <button
                onClick={() => { setSelectedStreamId(null); setMobileTab('home'); }}
                className="w-full text-left px-4 py-3 rounded-radius-lg text-sm font-medium transition-all mb-2"
                style={{
                  background: 'var(--bg-surface-glass)',
                  border: '1px solid var(--border-glass)',
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-lg)',
                }}
                data-testid="mobile-streams-all-songs"
              >
                全部歌曲
              </button>

              {/* Stream list */}
              {filteredStreams.length === 0 ? (
                <div className="py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  <p className="text-base" style={{ color: 'var(--text-secondary)' }}>沒有符合條件的歌枠</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredStreams.map(stream => (
                    <button
                      key={stream.id}
                      data-testid="mobile-stream-card"
                      onClick={() => { setSelectedStreamId(stream.id); setMobileTab('home'); }}
                      className="w-full text-left px-4 py-3 rounded-radius-lg transition-all"
                      style={{
                        background: 'var(--bg-surface-glass)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: 'var(--radius-lg)',
                      }}
                    >
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{stream.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{stream.date}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>
      </div>

      {/* Mobile BottomNav — 64px + safe area, fixed bottom, mobile only */}
      <nav
        data-testid="mobile-bottom-nav"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-[70] flex items-start justify-around"
        style={{
          padding: '8px 0 calc(16px + var(--safe-area-bottom)) 0',
          background: 'var(--bg-surface-frosted)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-glass)',
        }}
      >
        {/* Home */}
        <button
          data-testid="bottom-nav-home"
          onClick={() => setMobileTab('home')}
          className="flex flex-col items-center justify-start"
          style={{ gap: '4px', flex: 1 }}
        >
          <House
            style={{
              width: '22px',
              height: '22px',
              color: mobileTab === 'home' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          />
          <span
            style={{
              fontSize: '10px',
              fontWeight: mobileTab === 'home' ? 700 : 500,
              color: mobileTab === 'home' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          >
            Home
          </span>
        </button>

        {/* Search */}
        <button
          data-testid="bottom-nav-search"
          onClick={() => setMobileTab('search')}
          className="flex flex-col items-center justify-start"
          style={{ gap: '4px', flex: 1 }}
        >
          <Search
            style={{
              width: '22px',
              height: '22px',
              color: mobileTab === 'search' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          />
          <span
            style={{
              fontSize: '10px',
              fontWeight: mobileTab === 'search' ? 700 : 500,
              color: mobileTab === 'search' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          >
            Search
          </span>
        </button>

        {/* Streams */}
        <button
          data-testid="bottom-nav-streams"
          onClick={() => setMobileTab('streams')}
          className="flex flex-col items-center justify-start"
          style={{ gap: '4px', flex: 1 }}
        >
          <Radio
            style={{
              width: '22px',
              height: '22px',
              color: mobileTab === 'streams' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          />
          <span
            style={{
              fontSize: '10px',
              fontWeight: mobileTab === 'streams' ? 700 : 500,
              color: mobileTab === 'streams' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          >
            歌枠
          </span>
        </button>

        {/* Library */}
        <button
          data-testid="bottom-nav-library"
          onClick={() => setMobileTab('library')}
          className="flex flex-col items-center justify-start"
          style={{ gap: '4px', flex: 1 }}
        >
          <ListMusic
            style={{
              width: '22px',
              height: '22px',
              color: mobileTab === 'library' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          />
          <span
            style={{
              fontSize: '10px',
              fontWeight: mobileTab === 'library' ? 700 : 500,
              color: mobileTab === 'library' ? 'var(--accent-pink)' : 'var(--text-tertiary)',
            }}
          >
            Library
          </span>
        </button>

      </nav>

      {/* Playlist UI */}
      <PlaylistPanel
        show={showPlaylistPanel}
        onClose={() => setShowPlaylistPanel(false)}
        songsData={songs}
        onToast={(msg) => { setToastMessage(msg); setShowToast(true); }}
      />
      <LikedSongsPanel
        show={showLikedSongsPanel}
        onClose={() => setShowLikedSongsPanel(false)}
        onToast={(msg) => { setToastMessage(msg); setShowToast(true); }}
      />
      <RecentlyPlayedPanel
        show={showRecentlyPlayedPanel}
        onClose={() => setShowRecentlyPlayedPanel(false)}
        onToast={(msg) => { setToastMessage(msg); setShowToast(true); }}
      />
      <CreatePlaylistDialog
        show={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSuccess={() => {
          setToastMessage('播放清單已建立');
          setShowToast(true);
        }}
      />
    </>
  );
}

'use client';

import { useRef, type RefObject } from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import {
  Search,
  Shuffle,
  ListMusic,
  Clock,
  Heart,
  ChevronDown,
  Plus,
  SlidersHorizontal,
  WifiOff,
  House,
  Radio,
  Film,
} from 'lucide-react';
import Toast from '../components/Toast';
import PlaylistPanel from '../components/PlaylistPanel';
import LikedSongsPanel from '../components/LikedSongsPanel';
import RecentlyPlayedPanel from '../components/RecentlyPlayedPanel';
import CreatePlaylistDialog from '../components/CreatePlaylistDialog';
import SidebarNav from '../components/SidebarNav';
import TimelineRow from '../components/TimelineRow';
import SongCard from '../components/SongCard';
import MobileSearchRow from '../components/MobileSearchRow';
import SearchBox from '../components/SearchBox';
import ThemeToggle from '../components/ThemeToggle';
import ViewModeToggle from '../components/ViewModeToggle';
import CatalogEmptyState from '../components/CatalogEmptyState';
import SocialLinkRow from '../components/SocialLinkRow';
import YearChips from '../components/YearChips';
import PlayAllIconButton from '../components/PlayAllIconButton';
import VerifiedBadge from '../components/VerifiedBadge';
import { useArchiveData } from './archive-data-context';
import { useArchiveFilters } from './archive-filters-context';
import { useArchiveUi } from './archive-ui-context';
import { useStreamer } from '../contexts/StreamerContext';
import { useCurrentTrack, usePlayerActions, usePlayerStatus, useTransport } from '../contexts/PlayerContext';
import { usePlaylist } from '../contexts/PlaylistContext';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';
import type { ArchiveLoadState } from '../lib/archive-loader';

export default function ArchivePageView() {
  return <ArchivePageChrome />;
}

function ArchivePageChrome() {
  return (
    <>
      <StatusOverlays />
      <div className="flex h-screen text-slate-600 font-sans selection:bg-pink-200 selection:text-pink-900 overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%)' }}>
        <ArchiveSidebar />
        <MobileTopBar />
        <MainContent />
      </div>
      <MobileBottomNavigation />
      <PlaylistOverlays />
    </>
  );
}


function StatusOverlays() {
  const { toastMessage, hideToast } = useArchiveUi();
  const { apiLoadError } = usePlayerStatus();

  return (
    <>
      <Toast message={toastMessage} onHide={hideToast} />
      {/* API Load Error Banner */}
      {apiLoadError && (
        <div
          data-testid="api-load-error"
          className="fixed top-0 left-0 right-0 z-[300] bg-red-500 text-white px-6 py-3 flex items-center justify-center gap-3 shadow-lg"
        >
          <span className="font-bold text-sm">{apiLoadError}</span>
        </div>
      )}
    </>
  );
}


function ArchiveSidebar() {
  const {
    hasActiveFilters, clearAllFilters, debouncedSearch, setDebouncedSearch,
    selectedArtist, setSelectedArtist, toggleYear, selectedYears,
    filteredStreams, setSelectedStreamId, selectedStreamId,
  } = useArchiveFilters();
  const { setShowCreateDialog, setShowPlaylistPanel, setShowLikedSongsPanel, setShowRecentlyPlayedPanel } = useArchiveUi();
  const { allArtists, availableYears } = useArchiveData();
  const { playlists } = usePlaylist();
  const { likedCount } = useLikedSongs();
  const { recentCount } = useRecentlyPlayed();

  return (
    <>
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
            <SearchBox
              value={debouncedSearch}
              onDebouncedChange={setDebouncedSearch}
              label="搜尋歌曲"
              placeholder="搜尋歌曲..."
              containerClassName="relative group"
              icon={
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search
                    className="w-4 h-4 transition-colors text-token-tertiary"
                  />
                </div>
              }
              inputClassName="w-full font-medium py-2.5 pl-9 pr-4 outline-none transition-colors text-base bg-surface-glass border border-border-token-glass rounded-radius-pill text-token-primary"
              inputStyle={{
                backdropFilter: 'blur(8px)',
              }}
            />
          </div>
        }
      >
        {/* ── Filters Section ── */}
        <div className="pt-2 pb-1">
          <div
            className="px-3 py-1.5 mb-1 font-bold uppercase tracking-widest flex items-center gap-2 text-token-tertiary text-token-xs"
            style={{ letterSpacing: '0.1em' }}
          >
            <SlidersHorizontal className="w-3 h-3" />
            篩選條件
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="ml-auto font-medium transition-colors text-accent-pink text-token-xs"
                data-testid="clear-all-filters"
              >
                清除全部
              </button>
            )}
          </div>

          {/* Artist dropdown */}
          <div className="relative px-1 mb-2">
            <label htmlFor="artist-filter" className="sr-only">
              依歌手篩選
            </label>
            <select
              id="artist-filter"
              value={selectedArtist ?? ''}
              onChange={(e) => setSelectedArtist(e.target.value || null)}
              className="w-full font-medium py-2 px-3 outline-none appearance-none text-sm cursor-pointer transition-colors bg-surface-glass border border-border-token-glass rounded-radius-lg text-token-secondary"
              data-testid="artist-filter"
            >
              <option value="">全部歌手</option>
              {allArtists.map(artist => (
                <option key={artist} value={artist}>{artist}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
              <ChevronDown className="w-3.5 h-3.5 text-token-tertiary" />
            </div>
          </div>

          {/* Year filter chips */}
          <div className="flex flex-wrap gap-1.5 px-1" data-testid="year-filter-sidebar">
            <YearChips years={availableYears} selectedYears={selectedYears} onToggle={toggleYear} chipTestId="year-filter-chip" />
          </div>
        </div>

        {/* ── Stream Playlists Section ── */}
        <div className="pt-2 pb-2">
          <div
            className="px-3 py-1.5 mb-1 font-bold uppercase tracking-widest text-token-tertiary text-token-xs"
            style={{ letterSpacing: '0.1em' }}
          >
            歌枠回放{selectedYears.size > 0 && ` (${Array.from(selectedYears).sort().join(', ')})`}
          </div>
          <button
            onClick={() => setSelectedStreamId(null)}
            className={`w-full text-left px-3 py-2 rounded-radius-lg text-sm font-medium transition-colors ${
              selectedStreamId === null
                ? 'text-accent-pink bg-accent-bg-pink'
                : 'text-token-secondary bg-transparent'
            }`}
          >
            全部歌曲
          </button>
          {filteredStreams.map(stream => (
            <button
              key={stream.id}
              data-testid="stream-filter-button"
              onClick={() => setSelectedStreamId(stream.id === selectedStreamId ? null : stream.id)}
              className={`w-full text-left px-3 py-2 rounded-radius-lg text-sm font-medium transition-colors ${
                selectedStreamId === stream.id
                  ? 'text-accent-pink bg-accent-bg-pink'
                  : 'text-token-secondary bg-transparent hover:bg-surface-muted'
              }`}
            >
              <div className="truncate">{stream.title}</div>
              <div className="text-xs text-token-muted">{stream.date}</div>
            </button>
          ))}
        </div>
      </SidebarNav>
    </>
  );
}


function MobileTopBar() {
  const streamerData = useStreamer();
  const slug = streamerData.slug;

  return (
    <>
      {/* Mobile TopBar — 56px + safe area, fixed top, mobile only */}
      <div
        data-testid="mobile-topbar"
        className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-surface-frosted backdrop-blur-[12px] border-b border-b-border-token-glass"
        style={{
          height: '56px',
          padding: 'var(--safe-area-top) 20px 0 20px',
        }}
      >
        <Link
          href="/"
          className="text-token-secondary"
          style={{ fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}
        >
          {streamerData.displayName}
        </Link>
        <div className="flex items-center" style={{ gap: '12px' }}>
          <a
            href={`https://vods.oshi.tw/?streamer=${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="歌回 VOD 資料庫"
            className="inline-flex items-center text-token-secondary"
          >
            <Film style={{ width: '20px', height: '20px' }} />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}


function MainContent() {
  const { scrollContainerRef, mobileTab } = useArchiveUi();

  return (
      <main className="flex-1 lg:m-3 overflow-hidden relative shadow-2xl shadow-indigo-100/50 flex flex-col rounded-radius-3xl bg-surface-glass backdrop-blur-[12px] border border-border-token-glass">

        {/* Decorative glows */}
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-pink-300/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute top-40 -left-20 w-72 h-72 bg-blue-300/20 rounded-full blur-3xl pointer-events-none"></div>

        {/* Scrollable area */}
        <div ref={scrollContainerRef} data-testid="archive-scroll-container" className="flex-1 overflow-y-auto custom-scrollbar relative z-10 pt-14 lg:pt-0">

          {/* Home tab content wrapper: always visible on desktop, only on home tab on mobile */}
          <div className={mobileTab !== 'home' ? 'hidden lg:block' : ''}>

            <MobileHero />
            <DesktopHero />
            <MobileHomeControls />
            <DesktopActionBar />
            <SongCatalog />
          {/* End home tab content wrapper */}
          </div>
            <MobileSearchTab />
            <MobileLibraryTab />
            <MobileStreamsTab />
        </div>
      </main>
  );
}


function MobileHero() {
  const streamerData = useStreamer();
  const { flattenedSongs } = useArchiveFilters();

  return (
    <>
          {/* Mobile Hero Section (§3.4.9.3) — vertical layout, mobile only */}
          <header
            data-testid="mobile-hero"
            className="lg:hidden flex flex-col items-center flex-shrink-0 border-b border-b-border-token-glass"
            style={{
              padding: '16px 24px 24px 24px',
              gap: '12px',
            }}
          >
            {/* Avatar: 160×160 circle with gradient border and outer shadow */}
            <div
              className="flex-shrink-0 bg-accent-gradient rounded-radius-xl"
              style={{
                width: '160px',
                height: '160px',
                padding: '3px',
                boxShadow: '0 8px 32px rgba(244, 114, 182, 0.25)',
              }}
            >
              <div
                className="rounded-radius-xl"
                style={{
                  width: '100%',
                  height: '100%',
                  overflow: 'hidden',
                }}
              >
                {/* Runtime remote avatar in a static export; no Next image optimizer is available. */}
                {/* eslint-disable @next/next/no-img-element */}
                {/* react-doctor-disable-next-line react-doctor/nextjs-no-img-element */}
                <img
                  src={streamerData.avatarUrl}
                  alt={streamerData.displayName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => {
                    const target = e.currentTarget as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      parent.classList.add('bg-accent-gradient');
                    }
                  }}
                />
                {/* eslint-enable @next/next/no-img-element */}
              </div>
            </div>

            {/* Verified Badge */}
            <VerifiedBadge />

            {/* Streamer Name: fontSize 36, fontWeight 900, letterSpacing -0.5 */}
            <h1
              className="text-token-primary"
              style={{
                fontSize: '36px',
                fontWeight: 900,
                letterSpacing: '-0.5px',
                lineHeight: 1.1,
                textAlign: 'center',
                margin: 0,
              }}
            >
              {streamerData.displayName}
            </h1>

            {/* Description: streamerData.description · {songCount} 首歌曲, fontSize 13, centered */}
            <p
              className="text-token-secondary"
              style={{
                fontSize: '13px',
                textAlign: 'center',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {streamerData.description}
              {' '}
              <span className="text-token-tertiary">·</span>
              {' '}
              <span style={{ fontWeight: 600 }}>{flattenedSongs.length} 首歌曲</span>
            </p>

            {/* Stats row: subscriberCount */}
            <p
              className="text-token-secondary"
              style={{
                fontSize: '13px',
                textAlign: 'center',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {streamerData.subscriberCount}位訂閱者
            </p>
          </header>
    </>
  );
}


function DesktopHero() {
  const streamerData = useStreamer();
  const { flattenedSongs } = useArchiveFilters();

  return (
    <>
          {/* Hero Section - Streamer Profile (~280px height) — desktop only */}
          <header
            className="relative hidden lg:flex items-center gap-8 overflow-hidden flex-shrink-0 border-b border-b-border-token-glass"
            style={{
              minHeight: '280px',
              padding: '40px 40px 0 40px',
            }}
          >
            {/* Left: Avatar */}
            <div
              className="flex-shrink-0 overflow-hidden rounded-radius-xl border border-border-token-glass"
              style={{
                width: '180px',
                height: '180px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                alignSelf: 'flex-end',
                marginBottom: '40px',
              }}
            >
              {/* Runtime remote avatar in a static export; no Next image optimizer is available. */}
              {/* eslint-disable @next/next/no-img-element */}
              {/* react-doctor-disable-next-line react-doctor/nextjs-no-img-element */}
              <img
                src={streamerData.avatarUrl}
                alt={streamerData.displayName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    parent.classList.add('bg-accent-gradient');
                    parent.style.display = 'flex';
                    parent.style.alignItems = 'center';
                    parent.style.justifyContent = 'center';
                  }
                }}
              />
              {/* eslint-enable @next/next/no-img-element */}
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
              <VerifiedBadge />

              {/* Streamer Name */}
              <h1
                className="tracking-tight leading-none text-token-3xl text-token-primary"
                style={{
                  fontWeight: 900,
                  lineHeight: 1.1,
                }}
              >
                {streamerData.displayName}
              </h1>

              {/* Description / Stats Text */}
              <p
                className="text-token-secondary text-token-base"
                style={{
                  maxWidth: '480px',
                  lineHeight: 1.5,
                  margin: '2px 0',
                }}
              >
                {streamerData.description}
                {' '}
                <span className="text-token-tertiary">·</span>
                {' '}
                <span style={{ fontWeight: 600 }}>{flattenedSongs.length} 首歌曲</span>
              </p>

              {/* Statistics Row: Followers */}
              <div
                className="flex items-center gap-6 text-token-base"
                style={{ marginTop: '4px' }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-token-primary text-token-xl"
                    style={{ fontWeight: 700 }}
                  >
                    {streamerData.subscriberCount}
                  </span>
                  <span className="text-token-secondary text-token-sm">
                    訂閱者
                  </span>
                </div>
              </div>

              {/* Social Links Row */}
              <div className="flex items-center gap-2" style={{ marginTop: '4px' }}>
                <SocialLinkRow socialLinks={streamerData.socialLinks} />
              </div>
            </div>

            {/* Bottom gradient overlay: fading to transparent from bottom up */}
            <div
              className="absolute bottom-0 left-0 right-0 pointer-events-none"
              style={{
                height: '60px',
                background: 'linear-gradient(to top, var(--bg-surface-glass) 0%, transparent 100%)',
              }}
            />
          </header>

    </>
  );
}


function MobileHomeControls() {
  const { handlePlayAll, clearYears, selectedYears, toggleYear } = useArchiveFilters();
  const { viewMode, setViewMode } = useArchiveUi();
  const { availableYears } = useArchiveData();
  const streamerData = useStreamer();
  const { shuffleOn } = useTransport();
  const { toggleShuffle } = usePlayerActions();

  return (
    <>
          {/* Mobile Action Bar (§3.4.9.4) — horizontal layout, mobile only */}
          <div
            data-testid="mobile-action-bar"
            className="lg:hidden flex items-center flex-shrink-0 backdrop-blur-[12px] border-b border-b-border-token-glass"
            style={{
              padding: '0 20px',
              gap: '12px',
              minHeight: '64px',
              background: 'var(--bg-overlay)',
            }}
          >
            {/* Play button: 48×48 circle, gradient fill (pink→blue) */}
            <PlayAllIconButton onClick={handlePlayAll} testId="mobile-play-all-button" />

            {/* Shuffle button: gradient fill when active, outline when off */}
            <button
              data-testid="mobile-shuffle-button"
              onClick={() => toggleShuffle()}
              className={`flex items-center justify-center flex-shrink-0 transition-[background,border-color,color,opacity] hover:opacity-90 rounded-radius-lg ${shuffleOn ? 'bg-accent-gradient' : 'bg-transparent'}`}
              style={{
                border: shuffleOn ? 'none' : '2px solid var(--accent-pink-light)',
                padding: '12px 28px',
                color: shuffleOn ? 'white' : 'var(--accent-pink)',
              }}
              title="隨機播放"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            {/* Flexible spacer */}
            <div style={{ flex: 1 }} />

            {streamerData.socialLinks.youtube && (
              <a
                href={streamerData.socialLinks.youtube}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="mobile-follow-button"
                className="flex items-center justify-center flex-shrink-0 font-semibold transition-opacity hover:opacity-80 border border-border-token text-token-secondary text-token-sm bg-transparent"
                style={{
                  borderRadius: '20px',
                  padding: '8px 24px',
                }}
              >
                追蹤
              </a>
            )}
          </div>

          {/* Mobile View Mode Toggle — full-width touch target, scrolls with page */}
          <div
            data-testid="mobile-view-mode-bar"
            className="lg:hidden flex items-center flex-shrink-0 px-5 py-3 border-b border-b-border-token-glass"
            style={{
              background: 'var(--bg-overlay)',
            }}
          >
            <ViewModeToggle
              value={viewMode}
              onChange={setViewMode}
              testIdPrefix="mobile-view-toggle"
              fullWidth
            />
          </div>

          {/* Mobile Year Filter Scroll — horizontal scrolling row, mobile only */}
          <div
            data-testid="mobile-stream-scroll"
            className="lg:hidden flex items-center flex-shrink-0 sticky top-0 z-[15] border-b border-b-border-token-glass bg-surface-frosted backdrop-blur-[12px]"
            style={{
              padding: '12px 20px',
              gap: '8px',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {/* All years chip */}
            <button
              onClick={clearYears}
              className={`flex-shrink-0 font-medium transition-colors text-token-sm ${selectedYears.size === 0 ? 'bg-accent-bg-pink border border-border-token-accent-pink text-accent-pink' : 'bg-transparent text-token-secondary'}`}
              style={{
                height: '36px',
                borderRadius: '12px',
                padding: '0 16px',
              }}
            >
              全部
            </button>
            {availableYears.map(year => (
              <button
                key={year}
                data-testid="year-filter-chip"
                onClick={() => toggleYear(year)}
                className={`flex-shrink-0 font-medium transition-colors text-token-sm ${selectedYears.has(year) ? 'bg-accent-bg-pink border border-border-token-accent-pink text-accent-pink' : 'bg-transparent text-token-secondary'}`}
                style={{
                  height: '36px',
                  borderRadius: '12px',
                  padding: '0 16px',
                  whiteSpace: 'nowrap',
                }}
              >
                {year}
              </button>
            ))}
          </div>

    </>
  );
}


function DesktopActionBar() {
  const { handlePlayAll, clearYears, selectedYears, toggleYear } = useArchiveFilters();
  const { viewMode, setViewMode } = useArchiveUi();
  const { availableYears } = useArchiveData();
  const streamerData = useStreamer();

  return (
    <>
          {/* Action Bar — desktop only */}
          <div
            className="hidden lg:flex sticky top-0 z-20 px-6 items-center gap-3 flex-wrap backdrop-blur-[12px] border-t border-t-border-token-glass border-b border-b-border-token-glass"
            style={{
              background: 'var(--bg-overlay)',
              minHeight: '64px',
              paddingTop: '10px',
              paddingBottom: '10px',
            }}
          >
            {/* Left side: Play Controls */}
            <div className="flex items-center gap-3 flex-shrink-0">

              {/* PlayButton — 48×48 circular gradient play button */}
              <PlayAllIconButton onClick={handlePlayAll} testId="desktop-play-all-button" />

              {/* GradientButton — "播放全部" pill */}
              <button
                className="font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-90 flex-shrink-0 bg-accent-gradient rounded-radius-pill text-token-sm py-token-3 px-token-5 text-token-on-accent"
                onClick={handlePlayAll}
              >
                播放全部
              </button>

              {streamerData.socialLinks.youtube && (
                <a
                  href={streamerData.socialLinks.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-80 flex-shrink-0 bg-transparent border border-border-token rounded-radius-pill text-token-sm py-token-3 px-token-5 text-token-secondary"
                >
                  追蹤
                </a>
              )}

              {/* View Mode Toggle — restyled to match design language */}
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </div>

            {/* Flexible spacer */}
            <div className="flex-1 hidden lg:block" />

            {/* Right side: Year Filter Chips */}
            <div className="hidden lg:flex items-center gap-1.5 flex-wrap" data-testid="year-filter-bar">
              {/* "全部" chip */}
              <button
                onClick={clearYears}
                className={`font-medium transition-colors rounded-radius-pill text-token-sm py-token-2 px-token-4 ${selectedYears.size === 0 ? 'bg-accent-gradient text-token-on-accent' : 'bg-surface-muted text-token-secondary'}`}
              >
                全部
              </button>
              {availableYears.map(year => (
                <button
                  key={year}
                  data-testid="year-filter-chip"
                  onClick={() => toggleYear(year)}
                  className={`font-medium transition-colors rounded-radius-pill text-token-sm py-token-2 px-token-4 ${selectedYears.has(year) ? 'bg-accent-gradient text-token-on-accent' : 'bg-surface-muted text-token-secondary'}`}
                >
                  {year}
                </button>
              ))}
            </div>

          </div>

    </>
  );
}


function CatalogStatus({ loadState, retryLoad }: { loadState: ArchiveLoadState; retryLoad: () => void }) {
  if (loadState === 'error') {
    return (
      /* Song API Load Error State */
      <div
        data-testid="song-load-error"
        className="flex flex-col items-center justify-center py-32 gap-6 text-token-secondary"
      >
        <div
          className="flex items-center justify-center w-16 h-16 rounded-full bg-accent-bg-pink-muted"
        >
          <WifiOff className="w-8 h-8 text-accent-pink" />
        </div>
        <p
          className="text-center font-medium max-w-sm text-token-secondary text-token-base"
          style={{ lineHeight: 1.6 }}
        >
          無法載入歌曲資料，請檢查網路連線後重新整理頁面
        </p>
        <button
          data-testid="retry-button"
          onClick={retryLoad}
          className="font-semibold transition-opacity hover:opacity-90 bg-accent-gradient rounded-radius-pill text-token-sm py-token-3 px-token-6 text-token-on-accent"
        >
          重新整理
        </button>
      </div>
    );
  }

  return (
    /* Initial catalog loading skeleton — keeps the "no songs" empty
       state from flashing while data is still in flight */
    <div data-testid="catalog-loading" aria-busy="true" className="mt-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 animate-pulse" style={{ height: 56 }}>
          <div className="w-8" />
          <div className="w-10 h-10 rounded" style={{ background: 'var(--border-table)', opacity: 0.5 }} />
          <div className="flex-1 min-w-0">
            <div className="h-3 rounded mb-2" style={{ background: 'var(--border-table)', width: '40%' }} />
            <div className="h-3 rounded" style={{ background: 'var(--border-table)', width: '24%', opacity: 0.6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}


function SongCatalog() {
  const { flattenedSongs, groupedSongs } = useArchiveFilters();
  const { loadState, retryLoad } = useArchiveData();
  const { viewMode, mobileTab, scrollContainerRef } = useArchiveUi();

  const isTimelineActive = viewMode === 'timeline' && mobileTab === 'home';
  const isGroupedActive = viewMode === 'grouped' && mobileTab === 'home';

  const timelineListRef = useRef<HTMLDivElement>(null);
  const groupedListRef = useRef<HTMLDivElement>(null);

  // Both virtualizers stay mounted here regardless of which view is showing —
  // only the active one gets a live count. An inactive virtualizer with count
  // 0 renders nothing. This keeps both instances (and their scroll offsets)
  // alive across view-mode toggles instead of recreating one from scratch,
  // which would otherwise reset the shared scroll container back to the top.
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

  return (
    <>
          {/* Song List - Conditional Rendering based on View Mode */}
          <div className="px-4 pb-32 mt-2">
            {/* Always-visible logical counts for E2E tests (virtual scrolling caps DOM nodes) */}
            <span data-testid="total-performance-count" className="sr-only">{flattenedSongs.length}</span>
            <span data-testid="total-song-card-count" className="sr-only">{groupedSongs.length}</span>
            {loadState === 'error' || loadState === 'loading' ? (
              <CatalogStatus loadState={loadState} retryLoad={retryLoad} />
            ) : viewMode === 'timeline' ? (
              <TimelineSongList virtualizer={timelineVirtualizer} listRef={timelineListRef} />
            ) : (
              <GroupedSongList virtualizer={groupedVirtualizer} listRef={groupedListRef} />
            )}
          </div>
    </>
  );
}


function TimelineSongList({
  virtualizer,
  listRef,
}: {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const { flattenedSongs, hasActiveFilters, clearAllFilters, handlePlayFromFlattened } = useArchiveFilters();
  const { songs } = useArchiveData();
  const { handleAddToQueue, handleAddToPlaylistSuccess, toggleLike } = useArchiveUi();
  const { unavailableVideoIds } = usePlayerStatus();
  const currentTrackId = useCurrentTrack()?.performanceId ?? null;
  const { isLiked } = useLikedSongs();
  const { slug } = useStreamer();

  return (
    <>
      {/* SongTableHeader */}
      <div
        className="grid grid-cols-[32px_40px_1fr_60px] lg:grid-cols-[32px_40px_2fr_2fr_100px_60px] gap-0 px-3 py-2 sticky top-[60px] lg:top-[88px] z-10 border-b border-b-border-token-table bg-surface-frosted backdrop-blur-[12px]"
      >
        <div
          className="flex items-center justify-center text-center font-bold uppercase tracking-wider text-token-tertiary text-token-xs"
        >
          #
        </div>
        {/* Album art header spacer */}
        <div />
        <div
          className="flex items-center font-bold uppercase tracking-wider lg:pl-3 text-token-tertiary text-token-xs"
        >
          標題
        </div>
        <div
          className="hidden lg:flex items-center font-bold uppercase tracking-wider pl-3 text-token-tertiary text-token-xs"
        >
          出處直播
        </div>
        <div
          className="hidden lg:flex items-center font-bold uppercase tracking-wider pl-3 text-token-tertiary text-token-xs"
        >
          發布日期
        </div>
        <div
          className="flex items-center justify-center text-token-tertiary"
        >
          <Clock className="w-icon-sm h-icon-sm" />
        </div>
      </div>

      <div className="mt-1">
        {flattenedSongs.length === 0 ? (
          <CatalogEmptyState
            catalogEmpty={songs.length === 0 && !hasActiveFilters}
            hasActiveFilters={hasActiveFilters}
            onClearAllFilters={clearAllFilters}
          />
        ) : (
          <div
            ref={listRef}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map(virtualItem => {
              const song = flattenedSongs[virtualItem.index];
              return (
                <div
                  key={`${song.id}-${song.performanceId}`}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="hover:z-10 focus-within:z-10"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
                  }}
                >
                  <TimelineRow
                    song={song}
                    index={virtualItem.index}
                    isCurrentlyPlaying={currentTrackId === song.performanceId}
                    isUnavailable={unavailableVideoIds.has(song.videoId)}
                    isLiked={isLiked(song.performanceId)}
                    onToggleLike={toggleLike}
                    onPlay={handlePlayFromFlattened}
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
  );
}


function GroupedSongList({
  virtualizer: groupedVirtualizer,
  listRef: groupedListRef,
}: {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const { groupedSongs, hasActiveFilters, clearAllFilters, handlePlayFromGrouped } = useArchiveFilters();
  const { songs } = useArchiveData();
  const { handleAddToQueue, handleAddToPlaylistSuccess, toggleLike, expandedSongs, toggleSongExpansion } = useArchiveUi();
  const { unavailableVideoIds } = usePlayerStatus();
  const { isLiked } = useLikedSongs();
  const { slug } = useStreamer();

  return (
    <div className="mt-2">
      {groupedSongs.length === 0 ? (
        <CatalogEmptyState
          catalogEmpty={songs.length === 0 && !hasActiveFilters}
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
        />
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
                  onPlay={handlePlayFromGrouped}
                  onAddToQueue={handleAddToQueue}
                  onAddToPlaylistSuccess={handleAddToPlaylistSuccess}
                  isLiked={isLiked}
                  onToggleLike={toggleLike}
                  unavailableVideoIds={unavailableVideoIds}
                  streamerSlug={slug}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function MobileSearchTab() {
  const { debouncedSearch, setDebouncedSearch, selectedArtist, setSelectedArtist, flattenedSongs, handlePlayFromFlattened } = useArchiveFilters();
  const { mobileTab, scrollContainerRef } = useArchiveUi();
  const { allArtists } = useArchiveData();
  const { unavailableVideoIds } = usePlayerStatus();
  const currentTrackId = useCurrentTrack()?.performanceId ?? null;
  const { slug } = useStreamer();

  const mobileSearchListRef = useRef<HTMLDivElement>(null);
  const mobileSearchVirtualizer = useVirtualizer({
    count: mobileTab === 'search' ? flattenedSongs.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 64,
    overscan: 15,
    scrollMargin: mobileSearchListRef.current?.offsetTop ?? 0,
  });

  return (
    <>
          {/* Mobile Search Tab content — only visible on mobile when Search tab is active */}
          {mobileTab === 'search' && (
            <div
              className="lg:hidden flex-1 px-4 pt-4 pb-32"
              data-testid="mobile-search-tab"
            >
              {/* Search input */}
              <SearchBox
                value={debouncedSearch}
                onDebouncedChange={setDebouncedSearch}
                label="搜尋歌曲"
                placeholder="搜尋..."
                containerClassName="relative mb-4"
                icon={
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-token-tertiary"
                  />
                }
                inputClassName="w-full py-3 pl-10 pr-4 text-base outline-none bg-surface-glass border border-border-token-glass rounded-radius-pill text-token-primary"
                inputStyle={{
                  backdropFilter: 'blur(8px)',
                }}
                inputTestId="mobile-search-input"
                autoFocus
              />
              {/* Artist filter */}
              <div className="relative mb-3">
                <label htmlFor="mobile-artist-filter" className="sr-only">
                  依歌手篩選
                </label>
                <select
                  id="mobile-artist-filter"
                  value={selectedArtist ?? ''}
                  onChange={(e) => setSelectedArtist(e.target.value || null)}
                  className="w-full font-medium py-2 px-3 outline-none appearance-none text-sm cursor-pointer bg-surface-glass border border-border-token-glass rounded-radius-lg text-token-secondary"
                  data-testid="mobile-artist-filter"
                >
                  <option value="">全部歌手</option>
                  {allArtists.map(artist => (
                    <option key={artist} value={artist}>{artist}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                  <ChevronDown className="w-3.5 h-3.5 text-token-tertiary" />
                </div>
              </div>
              {/* Search results */}
              <div>
                {flattenedSongs.length === 0 ? (
                  <div className="py-16 text-center text-token-tertiary">
                    <p className="text-base font-medium text-token-secondary">找不到符合條件的歌曲</p>
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
                            onPlay={handlePlayFromFlattened}
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

    </>
  );
}


function MobileLibraryTab() {
  const { mobileTab, setShowLikedSongsPanel, setShowRecentlyPlayedPanel, setShowCreateDialog, setShowPlaylistPanel } = useArchiveUi();
  const { likedCount } = useLikedSongs();
  const { recentCount } = useRecentlyPlayed();
  const { playlists } = usePlaylist();

  return (
    <>
          {/* Mobile Library Tab content — only visible on mobile when Library tab is active */}
          {mobileTab === 'library' && (
            <div
              className="lg:hidden flex-1 px-4 pt-4 pb-32"
              data-testid="mobile-library-tab"
            >
              <div className="mb-4">
                <h2 className="text-lg font-bold mb-3 text-token-primary">你的音樂庫</h2>

                {/* Liked Songs */}
                <button
                  onClick={() => setShowLikedSongsPanel(true)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-radius-lg font-medium text-sm transition-colors mb-2 bg-surface-glass border border-border-token-glass text-token-secondary"
                  data-testid="mobile-liked-songs-button"
                >
                  <span className="flex items-center gap-3">
                    <Heart className="w-4 h-4 flex-shrink-0 text-accent-pink" />
                    喜愛的歌曲
                  </span>
                  {likedCount > 0 && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent-bg-pink-muted text-accent-pink"
                    >
                      {likedCount}
                    </span>
                  )}
                </button>

                {/* Recently Played */}
                <button
                  onClick={() => setShowRecentlyPlayedPanel(true)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-radius-lg font-medium text-sm transition-colors mb-2 bg-surface-glass border border-border-token-glass text-token-secondary"
                  data-testid="mobile-recently-played-button"
                >
                  <span className="flex items-center gap-3">
                    <Clock className="w-4 h-4 flex-shrink-0 text-accent-pink" />
                    最近播放
                  </span>
                  {recentCount > 0 && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent-bg-pink-muted text-accent-pink"
                    >
                      {recentCount}
                    </span>
                  )}
                </button>

                {/* Create Playlist */}
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-radius-lg font-medium text-sm transition-colors bg-surface-glass border border-border-token-glass text-token-secondary"
                  data-testid="mobile-create-playlist-button"
                >
                  <Plus className="w-4 h-4 flex-shrink-0 text-accent-pink" />
                  建立新播放清單
                </button>
              </div>
              {playlists.length > 0 ? (
                <div>
                  <button
                    onClick={() => setShowPlaylistPanel(true)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-radius-lg font-medium text-sm transition-colors mb-2 bg-surface-glass border border-border-token-glass text-token-secondary"
                    data-testid="mobile-view-playlists-button"
                  >
                    <span className="flex items-center gap-3">
                      <ListMusic className="w-4 h-4 flex-shrink-0 text-accent-pink" />
                      查看播放清單
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent-bg-pink-muted text-accent-pink"
                    >
                      {playlists.length}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="py-16 text-center text-token-tertiary">
                  <p className="text-base text-token-secondary">尚無播放清單，立即建立一個吧！</p>
                </div>
              )}
            </div>
          )}

    </>
  );
}


function MobileStreamsTab() {
  const { toggleYear, selectedYears, clearYears, setSelectedStreamId, filteredStreams } = useArchiveFilters();
  const { mobileTab, setMobileTab } = useArchiveUi();
  const { availableYears } = useArchiveData();

  return (
    <>
          {/* Mobile Streams Tab content — only visible on mobile when Streams tab is active */}
          {mobileTab === 'streams' && (
            <div
              className="lg:hidden flex-1 px-4 pt-4 pb-32"
              data-testid="mobile-streams-tab"
            >
              <h2 className="text-lg font-bold mb-3 text-token-primary">歌枠回放</h2>

              {/* Year filter chips */}
              <div className="flex gap-1.5 mb-4 overflow-x-auto" data-testid="mobile-streams-year-filter">
                <YearChips years={availableYears} selectedYears={selectedYears} onToggle={toggleYear} chipTestId="mobile-streams-year-chip" shrink />
                {selectedYears.size > 0 && (
                  <button
                    onClick={clearYears}
                    className="font-medium text-xs transition-colors flex-shrink-0 rounded-radius-pill text-token-tertiary"
                    style={{
                      padding: '4px 10px',
                    }}
                  >
                    清除
                  </button>
                )}
              </div>

              {/* All songs button */}
              <button
                onClick={() => { setSelectedStreamId(null); setMobileTab('home'); }}
                className="w-full text-left px-4 py-3 rounded-radius-lg text-sm font-medium transition-colors mb-2 bg-surface-glass border border-border-token-glass text-token-secondary"
                data-testid="mobile-streams-all-songs"
              >
                全部歌曲
              </button>

              {/* Stream list */}
              {filteredStreams.length === 0 ? (
                <div className="py-16 text-center text-token-tertiary">
                  <p className="text-base text-token-secondary">沒有符合條件的歌枠</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredStreams.map(stream => (
                    <button
                      key={stream.id}
                      data-testid="mobile-stream-card"
                      onClick={() => { setSelectedStreamId(stream.id); setMobileTab('home'); }}
                      className="w-full text-left px-4 py-3 rounded-radius-lg transition-colors bg-surface-glass border border-border-token-glass"
                    >
                      <div className="text-sm font-medium truncate text-token-primary">{stream.title}</div>
                      <div className="text-xs mt-0.5 text-token-muted">{stream.date}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
    </>
  );
}


const BOTTOM_NAV_ITEMS = [
  { tab: 'home', icon: House, label: 'Home', testId: 'bottom-nav-home' },
  { tab: 'search', icon: Search, label: 'Search', testId: 'bottom-nav-search' },
  { tab: 'streams', icon: Radio, label: '歌枠', testId: 'bottom-nav-streams' },
  { tab: 'library', icon: ListMusic, label: 'Library', testId: 'bottom-nav-library' },
] as const;

function MobileBottomNavigation() {
  const { mobileTab, setMobileTab } = useArchiveUi();

  return (
    <>
      {/* Mobile BottomNav — 64px + safe area, fixed bottom, mobile only */}
      <nav
        data-testid="mobile-bottom-nav"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-[70] flex items-start justify-around bg-surface-frosted backdrop-blur-[12px] border-t border-t-border-token-glass"
        style={{
          padding: '8px 0 calc(16px + var(--safe-area-bottom)) 0',
        }}
      >
        {BOTTOM_NAV_ITEMS.map(({ tab, icon: Icon, label, testId }) => (
          <button
            key={tab}
            data-testid={testId}
            onClick={() => setMobileTab(tab)}
            className="flex flex-col items-center justify-start"
            style={{ gap: '4px', flex: 1 }}
          >
            <Icon
              className={mobileTab === tab ? 'text-accent-pink' : 'text-token-tertiary'}
              style={{
                width: '22px',
                height: '22px',
              }}
            />
            <span
              className={mobileTab === tab ? 'text-accent-pink' : 'text-token-tertiary'}
              style={{
                fontSize: '10px',
                fontWeight: mobileTab === tab ? 700 : 500,
              }}
            >
              {label}
            </span>
          </button>
        ))}
      </nav>
    </>
  );
}


function PlaylistOverlays() {
  const {
    showPlaylistPanel, setShowPlaylistPanel, setToastMessage,
    showLikedSongsPanel, setShowLikedSongsPanel,
    showRecentlyPlayedPanel, setShowRecentlyPlayedPanel,
    showCreateDialog, setShowCreateDialog,
  } = useArchiveUi();
  const { songs } = useArchiveData();

  return (
    <>
      {/* Playlist UI */}
      <PlaylistPanel
        show={showPlaylistPanel}
        onClose={() => setShowPlaylistPanel(false)}
        songsData={songs}
        onToast={setToastMessage}
      />
      <LikedSongsPanel
        show={showLikedSongsPanel}
        onClose={() => setShowLikedSongsPanel(false)}
        onToast={setToastMessage}
      />
      <RecentlyPlayedPanel
        show={showRecentlyPlayedPanel}
        onClose={() => setShowRecentlyPlayedPanel(false)}
        onToast={setToastMessage}
      />
      {showCreateDialog && (
        <CreatePlaylistDialog
          onClose={() => setShowCreateDialog(false)}
          onSuccess={() => setToastMessage('播放清單已建立')}
        />
      )}
    </>
  );
}

'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import {
  Disc3,
  Home as HomeIcon,
  Play,
  LayoutList,
  Sparkles,
  Heart,
  Clock,
  Plus,
  ListMusic,
} from 'lucide-react';

interface SidebarNavProps {
  activePage: 'home' | 'now-playing';
  /** Override Home highlight (main page: !hasActiveFilters). Defaults to activePage === 'home'. */
  isHomeActive?: boolean;
  /** When provided, Home renders as <button> calling this. Otherwise renders as <Link href="/">. */
  onHomeClick?: () => void;
  onCreatePlaylist?: () => void;
  onViewPlaylists?: () => void;
  playlistCount?: number;
  onViewLikedSongs?: () => void;
  likedSongsCount?: number;
  onViewRecentlyPlayed?: () => void;
  recentlyPlayedCount?: number;
  /** Rendered between logo and scrollable body (e.g. search box). */
  searchSlot?: ReactNode;
  /** Rendered at the end of the scrollable body (e.g. filters, stream playlists). */
  children?: ReactNode;
}

export default function SidebarNav({
  activePage,
  isHomeActive,
  onHomeClick,
  onCreatePlaylist,
  onViewPlaylists,
  playlistCount = 0,
  onViewLikedSongs,
  likedSongsCount = 0,
  onViewRecentlyPlayed,
  recentlyPlayedCount = 0,
  searchSlot,
  children,
}: SidebarNavProps) {
  const homeActive = isHomeActive ?? activePage === 'home';
  const nowPlayingActive = activePage === 'now-playing';

  const activeStyle = {
    background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
    color: 'var(--text-on-accent)',
  };
  const inactiveStyle = {
    background: 'transparent',
    color: 'var(--text-secondary)',
  };

  const navItemClass =
    'w-full flex items-center gap-3 px-3 py-2.5 rounded-radius-lg font-medium text-sm transition-all';
  const inactiveNavItemClass = `${navItemClass} hover:bg-white/40`;

  return (
    <aside
      className="w-64 bg-white/60 backdrop-blur-xl border-r border-white/40 flex flex-col flex-shrink-0 hidden lg:flex shadow-sm z-20 overflow-hidden"
      style={{
        background: 'var(--bg-surface-frosted)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRight: '1px solid var(--border-glass)',
      }}
    >
      {/* ── 1. Logo Area ── */}
      <div className="px-5 py-5 flex items-center gap-3 flex-shrink-0">
        <div
          className="w-9 h-9 rounded-radius-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))' }}
        >
          <Disc3 className="w-5 h-5 text-white" />
        </div>
        <span
          className="font-bold text-xl tracking-tight bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))' }}
        >
          MizukiPrism
        </span>
      </div>

      {/* ── 2. Search Slot ── */}
      {searchSlot}

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 space-y-1 pb-3">
        {/* ── 3. DISCOVER Section ── */}
        <div className="pt-2 pb-1">
          <div
            className="px-3 py-1.5 mb-1 font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)', letterSpacing: '0.1em' }}
          >
            DISCOVER
          </div>

          {/* Home */}
          {onHomeClick ? (
            <button
              onClick={onHomeClick}
              className={navItemClass}
              style={homeActive ? activeStyle : inactiveStyle}
            >
              <HomeIcon className="w-4 h-4 flex-shrink-0" />
              首頁
            </button>
          ) : (
            <Link
              href="/"
              className={homeActive ? navItemClass : inactiveNavItemClass}
              style={homeActive ? activeStyle : inactiveStyle}
            >
              <HomeIcon className="w-4 h-4 flex-shrink-0" />
              首頁
            </Link>
          )}

          {/* Now Playing */}
          <Link
            href="/now-playing"
            className={nowPlayingActive ? navItemClass : inactiveNavItemClass}
            style={nowPlayingActive ? activeStyle : inactiveStyle}
          >
            <Play className="w-4 h-4 flex-shrink-0" style={nowPlayingActive ? { fill: 'currentColor' } : undefined} />
            正在播放
          </Link>

          {/* Browse */}
          <button
            className={inactiveNavItemClass}
            style={inactiveStyle}
          >
            <LayoutList className="w-4 h-4 flex-shrink-0" />
            瀏覽
          </button>

          {/* Trending */}
          <button
            className={inactiveNavItemClass}
            style={inactiveStyle}
          >
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            熱門
          </button>
        </div>

        {/* ── 4. YOUR LIBRARY Section ── */}
        <div className="pt-2 pb-1">
          <div
            className="px-3 py-1.5 mb-1 font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)', letterSpacing: '0.1em' }}
          >
            YOUR LIBRARY
          </div>

          {/* Liked Songs */}
          <button
            onClick={onViewLikedSongs}
            className={likedSongsCount > 0
              ? "w-full flex items-center justify-between px-3 py-2.5 rounded-radius-lg font-medium text-sm transition-all hover:bg-white/40"
              : inactiveNavItemClass}
            style={inactiveStyle}
            data-testid="view-liked-songs-button"
          >
            <span className="flex items-center gap-3">
              <Heart className="w-4 h-4 flex-shrink-0" />
              喜愛的歌曲
            </span>
            {likedSongsCount > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--bg-accent-pink-muted)', color: 'var(--accent-pink)' }}
              >
                {likedSongsCount}
              </span>
            )}
          </button>

          {/* Recently Played */}
          <button
            onClick={onViewRecentlyPlayed}
            className={recentlyPlayedCount > 0
              ? "w-full flex items-center justify-between px-3 py-2.5 rounded-radius-lg font-medium text-sm transition-all hover:bg-white/40"
              : inactiveNavItemClass}
            style={inactiveStyle}
            data-testid="view-recently-played-button"
          >
            <span className="flex items-center gap-3">
              <Clock className="w-4 h-4 flex-shrink-0" />
              最近播放
            </span>
            {recentlyPlayedCount > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--bg-accent-pink-muted)', color: 'var(--accent-pink)' }}
              >
                {recentlyPlayedCount}
              </span>
            )}
          </button>

          {/* Create Playlist */}
          {onCreatePlaylist && (
            <button
              onClick={onCreatePlaylist}
              className={inactiveNavItemClass}
              style={inactiveStyle}
              data-testid="create-playlist-button"
            >
              <Plus className="w-4 h-4 flex-shrink-0" />
              建立新播放清單
            </button>
          )}

          {/* View Playlists */}
          {onViewPlaylists && playlistCount > 0 && (
            <button
              onClick={onViewPlaylists}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-radius-lg font-medium text-sm transition-all hover:bg-white/40"
              style={inactiveStyle}
              data-testid="view-playlists-button"
            >
              <span className="flex items-center gap-3">
                <ListMusic className="w-4 h-4 flex-shrink-0" />
                查看播放清單
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--bg-accent-pink-muted)', color: 'var(--accent-pink)' }}
              >
                {playlistCount}
              </span>
            </button>
          )}
        </div>

        {/* ── Page-specific content (filters, stream playlists, etc.) ── */}
        {children}
      </div>

      {/* ── 5. Footer ── */}
      <div
        className="flex-shrink-0 px-3 py-3 border-t"
        style={{ borderTop: '1px solid var(--border-glass)' }}
      >
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
          Made with <Heart className="w-3 h-3 inline text-pink-400 fill-current" /> for 浠Mizuki
        </p>
      </div>
    </aside>
  );
}

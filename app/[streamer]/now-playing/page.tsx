'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Music2, Share2, Heart } from 'lucide-react';
import { useStreamer } from '../../contexts/StreamerContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useLikedSongs } from '../../contexts/LikedSongsContext';
import { useRecentlyPlayed } from '../../contexts/RecentlyPlayedContext';
import AlbumArt from '../../components/AlbumArt';
import NowPlayingControls from '../../components/NowPlayingControls';
import ProgressBar from '../../components/ProgressBar';
import UpNextSection from '../../components/UpNextSection';
import SidebarNav from '../../components/SidebarNav';
import LikedSongsPanel from '../../components/LikedSongsPanel';
import RecentlyPlayedPanel from '../../components/RecentlyPlayedPanel';
import Toast from '../../components/Toast';
import Link from 'next/link';

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function NowPlayingPage() {
  const router = useRouter();
  const { slug } = useStreamer();
  const {
    currentTrack,
    isPlaying,
    trackCurrentTime,
    trackDuration,
    seekTo,
  } = usePlayer();

  const [showLikedSongsPanel, setShowLikedSongsPanel] = useState(false);
  const [showRecentlyPlayedPanel, setShowRecentlyPlayedPanel] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const { likedCount, isLiked, toggleLike } = useLikedSongs();
  const { recentCount } = useRecentlyPlayed();

  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const handleToggleLike = () => {
    if (!currentTrack) return;
    toggleLike({
      performanceId: currentTrack.id,
      songTitle: currentTrack.title,
      originalArtist: currentTrack.originalArtist,
      videoId: currentTrack.videoId,
      timestamp: currentTrack.timestamp,
      endTimestamp: currentTrack.endTimestamp,
      albumArtUrl: currentTrack.albumArtUrl,
    });
  };

  const hasKnownDuration = trackDuration != null && trackDuration > 0;
  const progress = hasKnownDuration
    ? (trackCurrentTime / trackDuration) * 100
    : 0;
  const clampedProgress = Math.min(100, Math.max(0, progress));

  const handleSeek = (percentage: number) => {
    if (!hasKnownDuration || !currentTrack) return;
    seekTo(currentTrack.timestamp + trackDuration * percentage);
  };

  const handleShare = async () => {
    if (!currentTrack) return;
    const url = `https://www.youtube.com/watch?v=${currentTrack.videoId}&t=${Math.floor(currentTrack.timestamp)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${currentTrack.title} - ${currentTrack.originalArtist}`, url });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  // Keyboard: Escape to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        router.back();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  // Empty state
  if (!currentTrack) {
    return (
      <div
        data-testid="now-playing-page"
        className="min-h-screen flex items-center justify-center"
        style={{
          background: 'linear-gradient(180deg, var(--bg-page-start), #F0F8FF, var(--bg-page-end))',
        }}
      >
        <div className="text-center" style={{ padding: '32px' }}>
          <div
            className="mx-auto mb-6 flex items-center justify-center"
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '24px',
              background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
            }}
          >
            <Music2 style={{ width: '48px', height: '48px', color: 'white' }} />
          </div>
          <p
            data-testid="now-playing-empty"
            style={{ fontSize: '18px', color: 'var(--text-secondary)', marginBottom: '16px' }}
          >
            目前沒有播放中的歌曲
          </p>
          <Link
            href={`/${slug}`}
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--accent-pink)',
              textDecoration: 'none',
            }}
          >
            Browse the catalog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="now-playing-page"
      className="flex min-h-screen"
      style={{
        background: 'linear-gradient(180deg, var(--bg-page-start), #F0F8FF, var(--bg-page-end))',
      }}
    >
      {/* Desktop sidebar */}
      <SidebarNav
        activePage="now-playing"
        onViewLikedSongs={() => setShowLikedSongsPanel(true)}
        likedSongsCount={likedCount}
        onViewRecentlyPlayed={() => setShowRecentlyPlayedPanel(true)}
        recentlyPlayedCount={recentCount}
      />

      {/* ─── MOBILE LAYOUT (<lg) ─── */}
      <div className="flex flex-col flex-1 lg:hidden" style={{ minHeight: '100vh' }}>
        {/* Top bar */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: '16px 20px' }}
        >
          <button
            onClick={() => router.back()}
            aria-label="Back"
            data-testid="np-back-button"
            style={{ color: 'var(--text-primary)', padding: '4px' }}
          >
            <ChevronDown style={{ width: '28px', height: '28px' }} />
          </button>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Now Playing
          </span>
          {/* Spacer to keep title centered */}
          <div style={{ width: '36px' }} />
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center" style={{ padding: '0 32px', gap: '24px' }}>
          {/* Album art */}
          <AlbumArt
            src={currentTrack.albumArtUrl}
            alt={`${currentTrack.title} - ${currentTrack.originalArtist}`}
            size={320}
            borderRadius={32}
          />

          {/* Song info */}
          <div className="text-center w-full" style={{ marginTop: '8px' }}>
            <h1
              className="truncate"
              style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)' }}
            >
              {currentTrack.title}
            </h1>
            <div className="flex items-center justify-center" style={{ gap: '6px', marginTop: '4px' }}>
              <span style={{ fontSize: '16px', color: '#64748B' }}>
                {currentTrack.originalArtist}
              </span>
              <button
                onClick={handleToggleLike}
                className="transition-all transform hover:scale-110"
                aria-label={liked ? '取消喜愛' : '喜愛'}
                data-testid="np-like-button"
                style={{ color: liked ? 'var(--accent-pink)' : 'var(--text-tertiary)', padding: '4px' }}
              >
                <Heart style={{ width: '22px', height: '22px' }} className={liked ? 'fill-current' : ''} />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full" style={{ marginTop: '8px' }}>
            <ProgressBar
              progress={clampedProgress}
              onSeek={handleSeek}
              height={6}
              showTimestamps
              currentTime={formatTime(trackCurrentTime)}
              totalTime={hasKnownDuration ? formatTime(trackDuration) : '--:--'}
            />
          </div>

          {/* Controls */}
          <NowPlayingControls size="mobile" />

          {/* Bottom actions */}
          <div className="flex items-center justify-end w-full" style={{ marginTop: '16px', padding: '0 16px' }}>
            <button
              onClick={handleShare}
              className="flex items-center transition-colors"
              style={{
                gap: '6px',
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                padding: '8px 12px',
                borderRadius: '8px',
              }}
              aria-label="Share"
            >
              Share
              <Share2 style={{ width: '18px', height: '18px' }} />
            </button>
          </div>
        </div>

      </div>

      {/* ─── DESKTOP LAYOUT (lg+) ─── */}
      <main
        className="hidden lg:flex flex-1 flex-col items-center justify-center"
        style={{ padding: '40px', gap: '28px', overflowY: 'auto' }}
      >
        {/* Album art */}
        <AlbumArt
          src={currentTrack.albumArtUrl}
          alt={`${currentTrack.title} - ${currentTrack.originalArtist}`}
          size={400}
          borderRadius={24}
        />

        {/* Song info */}
        <div className="text-center">
          <h1 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {currentTrack.title}
          </h1>
          <div className="flex items-center justify-center" style={{ gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '16px', color: '#64748B' }}>
              {currentTrack.originalArtist}
            </span>
            <button
              onClick={handleToggleLike}
              className="transition-all transform hover:scale-110"
              aria-label={liked ? '取消喜愛' : '喜愛'}
              data-testid="np-like-button-desktop"
              style={{ color: liked ? 'var(--accent-pink)' : 'var(--text-tertiary)', padding: '4px' }}
            >
              <Heart style={{ width: '24px', height: '24px' }} className={liked ? 'fill-current' : ''} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: '400px' }}>
          <ProgressBar
            progress={clampedProgress}
            onSeek={handleSeek}
            height={4}
            showTimestamps
            currentTime={formatTime(trackCurrentTime)}
            totalTime={hasKnownDuration ? formatTime(trackDuration) : '--:--'}
          />
        </div>

        {/* Controls */}
        <NowPlayingControls size="desktop" />

        {/* Up Next section */}
        <UpNextSection />
      </main>

      <Toast message={toastMessage} show={showToast} onHide={() => setShowToast(false)} />
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
    </div>
  );
}

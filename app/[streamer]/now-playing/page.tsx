'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Music2, Share2, Heart } from 'lucide-react';
import { useStreamer } from '../../contexts/StreamerContext';
import { useCurrentTrack, usePlaybackTime } from '../../contexts/PlayerContext';
import { useLikedSongs } from '../../contexts/LikedSongsContext';
import { useRecentlyPlayed } from '../../contexts/RecentlyPlayedContext';
import { useCurrentTrackLike } from '../../lib/use-current-track-like';
import { useTrackProgress } from '../../lib/use-track-progress';
import AlbumArt from '../../components/AlbumArt';
import NowPlayingControls from '../../components/NowPlayingControls';
import ProgressBar from '../../components/ProgressBar';
import UpNextSection from '../../components/UpNextSection';
import SidebarNav from '../../components/SidebarNav';
import LikedSongsPanel from '../../components/LikedSongsPanel';
import RecentlyPlayedPanel from '../../components/RecentlyPlayedPanel';
import Toast from '../../components/Toast';
import Link from 'next/link';
import { formatTime, youtubeWatchUrl } from '../../lib/format';

export default function NowPlayingPage() {
  const router = useRouter();
  const { slug } = useStreamer();
  const currentTrack = useCurrentTrack();
  const { trackCurrentTime } = usePlaybackTime();

  const [showLikedSongsPanel, setShowLikedSongsPanel] = useState(false);
  const [showRecentlyPlayedPanel, setShowRecentlyPlayedPanel] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hideToast = useCallback(() => setToastMessage(null), []);
  const { likedCount } = useLikedSongs();
  const { recentCount } = useRecentlyPlayed();
  const { liked, toggleCurrentLike: toggleCurrentLikeRaw } = useCurrentTrackLike();
  const { progress, handleSeek, knownDuration } = useTrackProgress();

  // toggleCurrentLike's write can fail (storage quota); this page has a toast
  // affordance, so surface the failure here.
  const toggleCurrentLike = useCallback(async () => {
    const result = await toggleCurrentLikeRaw();
    if (result && !result.success) setToastMessage(result.error);
  }, [toggleCurrentLikeRaw]);

  const handleShare = async () => {
    if (!currentTrack) return;
    const url = youtubeWatchUrl(currentTrack.videoId, currentTrack.timestamp);
    if (navigator.share) {
      try {
        await navigator.share({ title: `${currentTrack.songTitle} - ${currentTrack.originalArtist}`, url });
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
          background: 'linear-gradient(180deg, var(--bg-page-start), var(--bg-page-mid), var(--bg-page-end))',
        }}
      >
        <div className="text-center" style={{ padding: '32px' }}>
          <div
            className="mx-auto mb-6 flex items-center justify-center bg-accent-gradient"
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '24px',
            }}
          >
            <Music2 style={{ width: '48px', height: '48px', color: 'white' }} />
          </div>
          <p
            data-testid="now-playing-empty"
            className="text-token-secondary"
            style={{ fontSize: '18px', marginBottom: '16px' }}
          >
            目前沒有播放中的歌曲
          </p>
          <Link
            href={`/${slug}`}
            className="text-accent-pink"
            style={{
              fontSize: '15px',
              fontWeight: 600,
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
        background: 'linear-gradient(180deg, var(--bg-page-start), var(--bg-page-mid), var(--bg-page-end))',
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
            className="text-token-primary"
            style={{ padding: '4px' }}
          >
            <ChevronDown style={{ width: '28px', height: '28px' }} />
          </button>
          <span className="text-token-primary" style={{ fontSize: '16px', fontWeight: 600 }}>
            Now Playing
          </span>
          {/* Spacer to keep title centered */}
          <div style={{ width: '36px' }} />
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center" style={{ padding: '0 32px', gap: '24px' }}>
          {/* Album art */}
          <AlbumArt
            alt={`${currentTrack.songTitle} - ${currentTrack.originalArtist}`}
            size={320}
            borderRadius={32}
          />

          {/* Song info */}
          <div className="text-center w-full" style={{ marginTop: '8px' }}>
            <h1
              className="truncate text-token-primary"
              style={{ fontSize: '28px', fontWeight: 700 }}
            >
              {currentTrack.songTitle}
            </h1>
            <div className="flex items-center justify-center" style={{ gap: '6px', marginTop: '4px' }}>
              <span className="text-token-secondary" style={{ fontSize: '16px' }}>
                {currentTrack.originalArtist}
              </span>
              <button
                onClick={toggleCurrentLike}
                className={`transition-[color,transform] transform hover:scale-110 ${liked ? 'text-accent-pink' : 'text-token-tertiary'}`}
                aria-label={liked ? '取消喜愛' : '喜愛'}
                data-testid="np-like-button"
                style={{ padding: '4px' }}
              >
                <Heart style={{ width: '22px', height: '22px' }} className={liked ? 'fill-current' : ''} />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full" style={{ marginTop: '8px' }}>
            <ProgressBar
              progress={progress}
              onSeek={handleSeek}
              height={6}
              showTimestamps
              currentTime={formatTime(trackCurrentTime)}
              totalTime={knownDuration != null ? formatTime(knownDuration) : '--:--'}
            />
          </div>

          {/* Controls */}
          <NowPlayingControls size="mobile" />

          {/* Bottom actions */}
          <div className="flex items-center justify-end w-full" style={{ marginTop: '16px', padding: '0 16px' }}>
            <button
              onClick={handleShare}
              className="flex items-center transition-colors text-token-secondary"
              style={{
                gap: '6px',
                fontSize: '14px',
                fontWeight: 500,
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
          alt={`${currentTrack.songTitle} - ${currentTrack.originalArtist}`}
          size={400}
          borderRadius={24}
        />

        {/* Song info */}
        <div className="text-center">
          <h1 className="text-token-primary" style={{ fontSize: '32px', fontWeight: 700 }}>
            {currentTrack.songTitle}
          </h1>
          <div className="flex items-center justify-center" style={{ gap: '6px', marginTop: '6px' }}>
            <span className="text-token-secondary" style={{ fontSize: '16px' }}>
              {currentTrack.originalArtist}
            </span>
            <button
              onClick={toggleCurrentLike}
              className={`transition-[color,transform] transform hover:scale-110 ${liked ? 'text-accent-pink' : 'text-token-tertiary'}`}
              aria-label={liked ? '取消喜愛' : '喜愛'}
              data-testid="np-like-button-desktop"
              style={{ padding: '4px' }}
            >
              <Heart style={{ width: '24px', height: '24px' }} className={liked ? 'fill-current' : ''} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: '400px' }}>
          <ProgressBar
            progress={progress}
            onSeek={handleSeek}
            height={4}
            showTimestamps
            currentTime={formatTime(trackCurrentTime)}
            totalTime={knownDuration != null ? formatTime(knownDuration) : '--:--'}
          />
        </div>

        {/* Controls */}
        <NowPlayingControls size="desktop" />

        {/* Up Next section */}
        <UpNextSection />
      </main>

      <Toast message={toastMessage} onHide={hideToast} />
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
    </div>
  );
}

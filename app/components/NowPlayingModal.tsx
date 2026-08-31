'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Shuffle, Repeat, Repeat1, Heart } from 'lucide-react';
import {
  useCurrentTrack,
  useOverlays,
  usePlayerActions,
  usePlaybackTime,
  useQueue,
  useTransport,
} from '../contexts/PlayerContext';
import { useCurrentTrackLike } from '../lib/use-current-track-like';
import { useTrackProgress } from '../lib/use-track-progress';
import { useHydrated } from '../lib/use-hydrated';
import AlbumArt from './AlbumArt';
import VolumeControl from './VolumeControl';
import ProgressBar from './ProgressBar';
import { formatTime } from '../lib/format';

export default function NowPlayingModal() {
  const mounted = useHydrated();
  const currentTrack = useCurrentTrack();
  const { isPlaying, repeatMode, shuffleOn } = useTransport();
  const { showModal } = useOverlays();
  const queue = useQueue();
  const { togglePlayPause, previous, next, setShowModal, toggleRepeat, toggleShuffle, setShowQueue } = usePlayerActions();
  const { trackCurrentTime } = usePlaybackTime();
  const { liked, toggleCurrentLike } = useCurrentTrackLike();
  const { hasKnownDuration, progress, handleSeek, knownDuration } = useTrackProgress();

  // Keyboard navigation: Escape to close modal
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, setShowModal]);

  if (!showModal || !currentTrack) return null;

  if (!mounted) return null;

  const modalContent = (
    <div
      data-testid="now-playing-modal"
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => setShowModal(false)}
    >
      <div
        className="backdrop-blur-xl rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto bg-surface-frosted"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 backdrop-blur-xl px-6 py-4 flex items-center justify-between bg-surface-frosted border-b border-b-border-token"
        >
          <h2 className="text-lg font-bold text-token-primary">正在播放</h2>
          <button
            onClick={() => setShowModal(false)}
            className="transition-colors p-2 rounded-full text-token-tertiary"
            aria-label="Minimize"
          >
            <ChevronDown className="w-6 h-6" />
          </button>
        </div>

        {/* Album Art + Video Player Placeholder */}
        <div className="p-6">
          {/* Album Art — 300×300 centered */}
          <div className="flex justify-center mb-6">
            <AlbumArt
              alt={`${currentTrack.songTitle} - ${currentTrack.originalArtist}`}
              size={300}
            />
          </div>

          {/* Track Info */}
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-bold mb-2 text-token-primary">{currentTrack.songTitle}</h3>
            <p className="text-lg text-token-secondary">{currentTrack.originalArtist}</p>
            <button
              onClick={toggleCurrentLike}
              className={`mt-3 transition-[color,transform] transform hover:scale-110 ${liked ? 'text-accent-pink' : 'text-token-tertiary'}`}
              aria-label={liked ? '取消喜愛' : '喜愛'}
              data-testid="modal-like-button"
            >
              <Heart className={`w-6 h-6 ${liked ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <ProgressBar
              progress={progress}
              onSeek={handleSeek}
              disabled={!hasKnownDuration}
              height={8}
            />
            <div className="flex justify-between text-xs mt-2 font-mono text-token-tertiary">
              <span>{formatTime(trackCurrentTime)}</span>
              <span>{knownDuration != null ? formatTime(knownDuration) : '--:--'}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6 mt-8">
            <button
              onClick={toggleShuffle}
              className={`transition-[color,transform] transform hover:scale-110 ${shuffleOn ? 'text-accent-pink' : ''}`}
              aria-label="Shuffle"
              data-testid="modal-shuffle-button"
            >
              <Shuffle className={`w-6 h-6 ${shuffleOn ? '' : 'text-token-tertiary'}`} />
            </button>

            <button
              onClick={previous}
              className="transition-transform transform hover:scale-110 text-token-tertiary"
              aria-label="Previous"
            >
              <SkipBack className="w-8 h-8" />
            </button>

            <button
              onClick={togglePlayPause}
              className="w-16 h-16 rounded-full bg-accent-gradient text-white flex items-center justify-center shadow-2xl hover:brightness-110 transform hover:scale-105 transition-[filter,transform]"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-1" />
              )}
            </button>

            <button
              onClick={next}
              className="transition-transform transform hover:scale-110 text-token-tertiary"
              aria-label="Next"
            >
              <SkipForward className="w-8 h-8" />
            </button>

            <button
              onClick={toggleRepeat}
              className={`transition-[color,transform] transform hover:scale-110 ${repeatMode !== 'off' ? 'text-accent-pink' : ''}`}
              aria-label="Repeat"
              data-testid="modal-repeat-button"
            >
              {repeatMode === 'one'
                ? <Repeat1 className="w-6 h-6" />
                : <Repeat className={`w-6 h-6 ${repeatMode === 'off' ? 'text-token-tertiary' : ''}`} />
              }
            </button>
          </div>

          {/* Volume control */}
          <div className="flex justify-center mt-6">
            <VolumeControl size="full" />
          </div>

          {/* Next Up — queue preview */}
          <div className="mt-8 pt-6 border-t border-t-border-token">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-token-secondary">Next Up</h4>
              {queue.length > 0 && (
                <button
                  onClick={() => {
                    setShowQueue(true);
                    setShowModal(false);
                  }}
                  className="text-xs font-medium transition-colors hover:brightness-110 text-accent-pink"
                >
                  查看完整佇列
                </button>
              )}
            </div>
            {queue.length === 0 ? (
              <p className="text-sm text-center py-4 text-token-tertiary">佇列中沒有歌曲</p>
            ) : (
              <div className="flex flex-col">
                {queue.slice(0, 5).map((track, index) => (
                  <div
                    key={track.queueEntryId}
                    className={`flex items-center gap-3 py-2 ${index < Math.min(queue.length, 5) - 1 ? 'border-b border-b-border-token' : ''}`}
                  >
                    <AlbumArt
                      alt={`${track.songTitle} - ${track.originalArtist}`}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate text-token-primary">{track.songTitle}</div>
                      <div className="text-xs truncate text-token-secondary">{track.originalArtist}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

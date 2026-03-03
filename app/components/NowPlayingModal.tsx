'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, SkipBack, SkipForward, ChevronDown, Shuffle, Repeat, Repeat1, ListMusic } from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import AlbumArt from './AlbumArt';
import VolumeControl from './VolumeControl';
import ProgressBar from './ProgressBar';

export default function NowPlayingModal() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  const {
    currentTrack,
    isPlaying,
    trackCurrentTime,
    trackDuration,
    togglePlayPause,
    seekTo,
    previous,
    next,
    showModal,
    setShowModal,
    repeatMode,
    shuffleOn,
    toggleRepeat,
    toggleShuffle,
    queue,
    setShowQueue,
  } = usePlayer();

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

  const hasKnownDuration = trackDuration != null && trackDuration > 0;
  const progress = hasKnownDuration
    ? (trackCurrentTime / trackDuration) * 100
    : 0;

  const handleSeek = (percentage: number) => {
    if (!hasKnownDuration) return;
    seekTo(currentTrack.timestamp + trackDuration * percentage);
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!mounted) return null;

  const modalContent = (
    <div
      data-testid="now-playing-modal"
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => setShowModal(false)}
    >
      <div
        className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl border-b border-slate-200/60 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">正在播放</h2>
          <button
            onClick={() => setShowModal(false)}
            className="text-slate-500 hover:text-slate-800 transition-colors p-2 hover:bg-slate-100 rounded-full"
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
              src={currentTrack.albumArtUrl}
              alt={`${currentTrack.title} - ${currentTrack.originalArtist}`}
              size={300}
            />
          </div>

          {/* Track Info */}
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-bold text-slate-800 mb-2">{currentTrack.title}</h3>
            <p className="text-lg text-slate-500">{currentTrack.originalArtist}</p>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <ProgressBar
              progress={Math.min(100, Math.max(0, progress))}
              onSeek={handleSeek}
              height={8}
            />
            <div className="flex justify-between text-xs text-slate-500 mt-2 font-mono">
              <span>{formatTime(trackCurrentTime)}</span>
              <span>{hasKnownDuration ? formatTime(trackDuration) : '--:--'}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6 mt-8">
            <button
              onClick={toggleShuffle}
              className="transition-all transform hover:scale-110"
              aria-label="Shuffle"
              data-testid="modal-shuffle-button"
              style={{ color: shuffleOn ? 'var(--accent-pink)' : undefined }}
            >
              <Shuffle className={`w-6 h-6 ${shuffleOn ? '' : 'text-slate-600 hover:text-slate-800'}`} />
            </button>

            <button
              onClick={previous}
              className="text-slate-600 hover:text-slate-800 transition-all transform hover:scale-110"
              aria-label="Previous"
            >
              <SkipBack className="w-8 h-8" />
            </button>

            <button
              onClick={togglePlayPause}
              className="w-16 h-16 rounded-full bg-gradient-to-r from-pink-400 to-blue-400 text-white flex items-center justify-center shadow-2xl hover:brightness-110 transform hover:scale-105 transition-all"
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
              className="text-slate-600 hover:text-slate-800 transition-all transform hover:scale-110"
              aria-label="Next"
            >
              <SkipForward className="w-8 h-8" />
            </button>

            <button
              onClick={toggleRepeat}
              className="transition-all transform hover:scale-110"
              aria-label="Repeat"
              data-testid="modal-repeat-button"
              style={{ color: repeatMode !== 'off' ? 'var(--accent-pink)' : undefined }}
            >
              {repeatMode === 'one'
                ? <Repeat1 className="w-6 h-6" />
                : <Repeat className={`w-6 h-6 ${repeatMode === 'off' ? 'text-slate-600 hover:text-slate-800' : ''}`} />
              }
            </button>
          </div>

          {/* Volume control */}
          <div className="flex justify-center mt-6">
            <VolumeControl size="full" />
          </div>

          {/* Next Up — queue preview */}
          <div className="mt-8 border-t border-slate-200/60 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Next Up</h4>
              {queue.length > 0 && (
                <button
                  onClick={() => {
                    setShowQueue(true);
                    setShowModal(false);
                  }}
                  className="text-xs font-medium transition-colors hover:brightness-110"
                  style={{ color: 'var(--accent-pink)' }}
                >
                  查看完整佇列
                </button>
              )}
            </div>
            {queue.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">佇列中沒有歌曲</p>
            ) : (
              <div className="flex flex-col">
                {queue.slice(0, 5).map((track, index) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 py-2"
                    style={{ borderBottom: index < Math.min(queue.length, 5) - 1 ? '1px solid rgba(0,0,0,0.06)' : undefined }}
                  >
                    <AlbumArt
                      src={track.albumArtUrl}
                      alt={`${track.title} - ${track.originalArtist}`}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">{track.title}</div>
                      <div className="text-xs text-slate-500 truncate">{track.originalArtist}</div>
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

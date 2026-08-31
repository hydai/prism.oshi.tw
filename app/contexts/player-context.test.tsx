import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PlayerProvider,
  useCurrentTrack,
  useOverlays,
  usePlaybackTime,
  usePlayerActions,
  usePlayerNotices,
  usePlayerStatus,
  useQueue,
  useTransport,
  useVolume,
} from './PlayerContext';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ContextProbe() {
  const actions = usePlayerActions();
  const currentTrack = useCurrentTrack();
  const queue = useQueue();
  const { isPlaying, repeatMode, shuffleOn } = useTransport();
  const { isPlayerReady, playerError, apiLoadError, unavailableVideoIds } = usePlayerStatus();
  const { timestampWarning, skipNotification } = usePlayerNotices();
  const { showModal, showQueue } = useOverlays();
  const { volume, isMuted } = useVolume();
  const playback = usePlaybackTime();
  const actionsReady = [
    actions.clearTimestampWarning,
    actions.clearSkipNotification,
    actions.playTrackWithQueue,
    actions.togglePlayPause,
    actions.seekTo,
    actions.previous,
    actions.next,
    actions.setShowModal,
    actions.addToQueue,
    actions.removeFromQueue,
    actions.reorderQueue,
    actions.setShowQueue,
    actions.toggleRepeat,
    actions.toggleShuffle,
    actions.setVolume,
    actions.toggleMute,
    actions.ensurePlayerApi,
  ].every((action) => typeof action === 'function');

  return (
    <output
      data-current-track={currentTrack?.performanceId ?? 'none'}
      data-is-playing={String(isPlaying)}
      data-is-player-ready={String(isPlayerReady)}
      data-errors={`${playerError ?? 'none'},${apiLoadError ?? 'none'}`}
      data-unavailable-count={unavailableVideoIds.size}
      data-notices={`${timestampWarning ?? 'none'},${skipNotification ?? 'none'}`}
      data-queue-count={queue.length}
      data-overlays={`${showModal},${showQueue}`}
      data-modes={`${repeatMode},${shuffleOn}`}
      data-volume={`${volume},${isMuted}`}
      data-actions-ready={String(actionsReady)}
      data-playback={`${playback.currentTime},${playback.duration},${playback.trackCurrentTime},${playback.trackDuration ?? 'none'}`}
    >
      player-context-ready
    </output>
  );
}

const html = renderToStaticMarkup(
  <PlayerProvider>
    <ContextProbe />
  </PlayerProvider>,
);

assert(html.includes('player-context-ready'), 'provider renders its children');
assert(html.includes('data-current-track="none"'), 'player starts without a current track');
assert(html.includes('data-is-playing="false"') && html.includes('data-is-player-ready="false"'), 'player starts paused and not ready');
assert(html.includes('data-errors="none,none"'), 'player starts without errors');
assert(html.includes('data-unavailable-count="0"'), 'player starts without unavailable videos');
assert(html.includes('data-notices="none,none"'), 'player starts without notices');
assert(html.includes('data-queue-count="0"'), 'queue starts empty');
assert(html.includes('data-overlays="false,false"'), 'player overlays start closed');
assert(html.includes('data-modes="off,false"'), 'repeat and shuffle start disabled');
assert(html.includes('data-volume="75,false"'), 'volume contract retains its session defaults');
assert(html.includes('data-actions-ready="true"'), 'all player actions remain available to consumers');
assert(html.includes('data-playback="0,0,0,none"'), 'playback-time hook retains its initial snapshot');

console.log('✓ PlayerProvider preserves its initial context and action contract');

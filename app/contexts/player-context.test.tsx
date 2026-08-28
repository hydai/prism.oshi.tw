import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerProvider, usePlaybackTime, usePlayer } from './PlayerContext';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ContextProbe() {
  const player = usePlayer();
  const playback = usePlaybackTime();
  const actionsReady = [
    player.clearTimestampWarning,
    player.clearSkipNotification,
    player.playTrackWithQueue,
    player.togglePlayPause,
    player.seekTo,
    player.previous,
    player.next,
    player.setShowModal,
    player.addToQueue,
    player.removeFromQueue,
    player.reorderQueue,
    player.setShowQueue,
    player.toggleRepeat,
    player.toggleShuffle,
    player.setVolume,
    player.toggleMute,
  ].every((action) => typeof action === 'function');

  return (
    <output
      data-current-track={player.currentTrack?.performanceId ?? 'none'}
      data-is-playing={String(player.isPlaying)}
      data-is-player-ready={String(player.isPlayerReady)}
      data-errors={`${player.playerError ?? 'none'},${player.apiLoadError ?? 'none'}`}
      data-unavailable-count={player.unavailableVideoIds.size}
      data-notices={`${player.timestampWarning ?? 'none'},${player.skipNotification ?? 'none'}`}
      data-queue-count={player.queue.length}
      data-overlays={`${player.showModal},${player.showQueue}`}
      data-modes={`${player.repeatMode},${player.shuffleOn}`}
      data-volume={`${player.volume},${player.isMuted}`}
      data-store-time={player.timeStore.getSnapshot().currentTime}
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
assert(html.includes('data-store-time="0"'), 'playback store starts at zero');
assert(html.includes('data-actions-ready="true"'), 'all player actions remain available to consumers');
assert(html.includes('data-playback="0,0,0,none"'), 'playback-time hook retains its initial snapshot');

console.log('✓ PlayerProvider preserves its initial context and action contract');

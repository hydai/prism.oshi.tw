import assert from 'node:assert/strict';
import type {
  YouTubePlayer,
  YouTubePlayerEventWithData,
  YouTubePlayerOptions,
  YouTubeReadyEvent,
} from './youtube-iframe';

const player = {
  destroy: () => undefined,
  getCurrentTime: () => 0,
  getDuration: () => 120,
  getPlayerState: () => 1,
  loadVideoById: () => undefined,
  mute: () => undefined,
  pauseVideo: () => undefined,
  playVideo: () => undefined,
  seekTo: () => undefined,
  setVolume: () => undefined,
  unMute: () => undefined,
} satisfies YouTubePlayer;

const readyEvent = { target: player } satisfies YouTubeReadyEvent;
const stateEvent = { target: player, data: 1 } satisfies YouTubePlayerEventWithData<number>;

let readyTarget: YouTubePlayer | null = null;
let stateData: number | null = null;

const options = {
  height: '100%',
  width: '100%',
  events: {
    onReady(event) {
      readyTarget = event.target;
      assert.equal('data' in event, false);
    },
    onStateChange(event) {
      stateData = event.data;
    },
  },
} satisfies YouTubePlayerOptions;

options.events.onReady(readyEvent);
options.events.onStateChange(stateEvent);

assert.equal(readyTarget, player);
assert.equal(stateData, 1);

// @ts-expect-error Ready events should not expose a data payload.
const invalidReadyEvent = { target: player, data: 1 } satisfies YouTubeReadyEvent;
void invalidReadyEvent;

// @ts-expect-error State and error events require a data payload.
const invalidStateEvent = { target: player } satisfies YouTubePlayerEventWithData<number>;
void invalidStateEvent;

const readyHandler: NonNullable<YouTubePlayerOptions['events']>['onReady'] = (event) => {
  // @ts-expect-error Ready handlers should not read event.data.
  event.data;
};
void readyHandler;

console.log('✓ youtube iframe types');

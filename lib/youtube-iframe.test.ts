import assert from 'node:assert/strict';
import {
  loadYouTubeIframeApi,
  type ScriptDocument,
  type YouTubeApiHost,
  type YouTubeNamespace,
} from './youtube-iframe';
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

// --- loadYouTubeIframeApi behavior ---

const fakeYT: YouTubeNamespace = {
  Player: function FakePlayer() {
    return player;
  } as unknown as YouTubeNamespace['Player'],
};

interface FakeScript {
  src: string;
  onerror: ((event?: unknown) => void) | null;
}

function makeFakeDom() {
  const injected: FakeScript[] = [];
  const existingScript = {
    parentNode: {
      insertBefore: (node: FakeScript) => {
        injected.push(node);
      },
    },
  };
  const doc = {
    createElement: () => ({ src: '', onerror: null } as FakeScript),
    getElementsByTagName: () => [existingScript],
    head: null,
  } as unknown as ScriptDocument;
  return { doc, injected };
}

async function runLoaderTests() {
  // resolves immediately without injecting when the API is already present
  {
    const { doc, injected } = makeFakeDom();
    const win: YouTubeApiHost = { YT: fakeYT };
    const api = await loadYouTubeIframeApi(win, doc, 50);
    assert.equal(api, fakeYT);
    assert.equal(injected.length, 0, 'should not inject a script when YT already exists');
  }

  // injects the iframe_api script once and resolves when the ready callback fires
  {
    const { doc, injected } = makeFakeDom();
    const win: YouTubeApiHost = {};
    const pending = loadYouTubeIframeApi(win, doc, 1000);
    assert.equal(injected.length, 1);
    assert.equal(injected[0].src, 'https://www.youtube.com/iframe_api');
    assert.equal(typeof win.onYouTubeIframeAPIReady, 'function');
    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    const api = await pending;
    assert.equal(api, fakeYT);
  }

  // concurrent calls share one in-flight load (single script tag)
  {
    const { doc, injected } = makeFakeDom();
    const win: YouTubeApiHost = {};
    const first = loadYouTubeIframeApi(win, doc, 1000);
    const second = loadYouTubeIframeApi(win, doc, 1000);
    assert.equal(injected.length, 1, 'second call must not inject another script');
    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    assert.equal(await first, fakeYT);
    assert.equal(await second, fakeYT);
  }

  // rejects when the script fails to load
  {
    const { doc, injected } = makeFakeDom();
    const win: YouTubeApiHost = {};
    const pending = loadYouTubeIframeApi(win, doc, 1000);
    injected[0].onerror?.(new Error('blocked'));
    await assert.rejects(() => pending);
  }

  // rejects when the API never becomes ready within the timeout
  {
    const { doc } = makeFakeDom();
    const win: YouTubeApiHost = {};
    await assert.rejects(() => loadYouTubeIframeApi(win, doc, 20));
  }

  // a failed load can be retried with a fresh script
  {
    const { doc, injected } = makeFakeDom();
    const win: YouTubeApiHost = {};
    const failing = loadYouTubeIframeApi(win, doc, 1000);
    injected[0].onerror?.(new Error('blocked'));
    await assert.rejects(() => failing);

    const retry = loadYouTubeIframeApi(win, doc, 1000);
    assert.equal(injected.length, 2, 'retry should inject a new script');
    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    assert.equal(await retry, fakeYT);
  }

  console.log('✓ youtube iframe api loader');
}

runLoaderTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

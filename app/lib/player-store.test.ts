import assert from 'node:assert/strict';
import {
  createPlayerStore,
  type PlayerStore,
  type PollScheduler,
  type Track,
} from './player-store';
import type {
  YouTubePlayer,
  YouTubePlayerOptions,
} from '../../lib/youtube-iframe';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class FakePlayer implements YouTubePlayer {
  options: YouTubePlayerOptions;
  videoId: string;
  currentTime: number;
  duration = 0;
  videoDataId: string | undefined;
  calls: { name: string; args: unknown[] }[] = [];
  destroyed = false;

  constructor(options: YouTubePlayerOptions) {
    this.options = options;
    this.videoId = options.videoId ?? '';
    this.videoDataId = this.videoId;
    const start = options.playerVars?.start;
    this.currentTime = typeof start === 'number' ? start : 0;
  }

  private log(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  callNames(): string[] {
    return this.calls.map((c) => c.name);
  }
  callsOf(name: string): unknown[][] {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  }

  destroy() { this.destroyed = true; this.log('destroy'); }
  getCurrentTime() { return this.currentTime; }
  getDuration() { return this.duration; }
  getPlayerState() { return 1; }
  getVideoData() { return { video_id: this.videoDataId }; }
  loadVideoById(videoIdOrOptions: string | { videoId: string; startSeconds?: number }) {
    this.log('loadVideoById', videoIdOrOptions);
    if (typeof videoIdOrOptions === 'string') {
      this.videoId = videoIdOrOptions;
      this.currentTime = 0;
    } else {
      this.videoId = videoIdOrOptions.videoId;
      this.currentTime = videoIdOrOptions.startSeconds ?? 0;
    }
    this.videoDataId = this.videoId;
  }
  mute() { this.log('mute'); }
  pauseVideo() { this.log('pauseVideo'); }
  playVideo() { this.log('playVideo'); }
  seekTo(seconds: number, allowSeekAhead: boolean) {
    this.log('seekTo', seconds, allowSeekAhead);
    this.currentTime = seconds;
  }
  setVolume(volume: number) { this.log('setVolume', volume); }
  unMute() { this.log('unMute'); }

  // Event helpers — all player events are fired manually by the tests.
  ready() { this.options.events?.onReady?.({ target: this }); }
  firePlaying() { this.options.events?.onStateChange?.({ target: this, data: 1 }); }
  firePaused() { this.options.events?.onStateChange?.({ target: this, data: 2 }); }
  fireEnded() { this.options.events?.onStateChange?.({ target: this, data: 0 }); }
  fireError(code: number) { this.options.events?.onError?.({ target: this, data: code }); }
}

class ManualScheduler implements PollScheduler {
  private nextId = 1;
  active = new Map<number, () => void>();
  setInterval(fn: () => void, _ms: number): unknown {
    const id = this.nextId++;
    this.active.set(id, fn);
    return id;
  }
  clearInterval(id: unknown): void {
    this.active.delete(id as number);
  }
  tick() {
    for (const fn of [...this.active.values()]) fn();
  }
}

interface Harness {
  store: PlayerStore;
  scheduler: ManualScheduler;
  players: FakePlayer[];
  resolveApi: () => Promise<void>;
  rejectApi: () => Promise<void>;
  notifications: number;
}

function createHarness(): Harness {
  const players: FakePlayer[] = [];
  const scheduler = new ManualScheduler();
  let settle: { resolve: () => void; reject: () => void } | null = null;
  const harness: Harness = {
    store: null as unknown as PlayerStore,
    scheduler,
    players,
    // Resolving/rejecting the in-flight loadApi promise, then draining microtasks.
    resolveApi: async () => { settle?.resolve(); settle = null; await Promise.resolve(); await Promise.resolve(); },
    rejectApi: async () => { settle?.reject(); settle = null; await Promise.resolve(); await Promise.resolve(); },
    notifications: 0,
  };
  harness.store = createPlayerStore({
    loadApi: () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
    createPlayer: (_elementId, options) => {
      const player = new FakePlayer(options);
      players.push(player);
      return player;
    },
    schedule: scheduler,
  });
  harness.store.subscribe(() => { harness.notifications++; });
  return harness;
}

function track(id: string, extra: Partial<Track> = {}): Track {
  return {
    performanceId: id,
    songId: `song-${id}`,
    songTitle: `Song ${id}`,
    originalArtist: 'Artist',
    videoId: `video-${id}`,
    timestamp: 100,
    endTimestamp: 200,
    streamerSlug: 'mizuki',
    ...extra,
  };
}

async function startPlaying(h: Harness, current: Track, following: Track[] = []): Promise<FakePlayer> {
  h.store.actions.playTrackWithQueue(current, following);
  await h.resolveApi();
  const player = h.players[h.players.length - 1];
  player.ready();
  return player;
}

// tsx transpiles this project's tests to CJS (no top-level `"type": "module"`
// in package.json), which does not support top-level await — so, like
// archive-loader.test.ts and youtube-iframe.test.ts, every block below runs
// inside one async function instead of directly at module scope. The catch
// below calls process.exit (not exitCode) so a rejection also hard-fails the
// file under node --test.
async function run() {

// ---------------------------------------------------------------------------
// 1. Initial snapshot + server snapshot identity
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const s = h.store.getSnapshot();
  assert.equal(s.currentTrack, null);
  assert.equal(s.isPlaying, false);
  assert.equal(s.isPlayerReady, false);
  assert.equal(s.playerError, null);
  assert.equal(s.apiLoadError, null);
  assert.equal(s.unavailableVideoIds.size, 0);
  assert.equal(s.timestampWarning, null);
  assert.equal(s.skipNotification, null);
  assert.equal(s.showModal, false);
  assert.equal(s.showQueue, false);
  assert.deepEqual(s.queue, []);
  assert.equal(s.repeatMode, 'off');
  assert.equal(s.shuffleOn, false);
  assert.equal(h.store.getServerSnapshot(), h.store.getServerSnapshot(), 'server snapshot identity is stable');
  console.log('✓ initial snapshot matches the SSR contract');
}

// ---------------------------------------------------------------------------
// 2. playTrackWithQueue: optimistic state, queue materialization, player creation
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1');
  const t2 = track('t2');
  const t3 = track('t3');
  h.store.actions.playTrackWithQueue(t1, [t2, t3]);
  let s = h.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't1');
  assert.equal(s.isPlaying, true, 'optimistic isPlaying on the user click');
  assert.equal(s.queue.length, 2);
  assert.notEqual(s.queue[0].queueEntryId, s.queue[1].queueEntryId, 'queue entry ids are unique');
  assert.equal(h.store.timeStore.getSnapshot().currentTime, 100, 'clock jumps to the track timestamp');
  assert.equal(h.players.length, 0, 'no player until the API resolves');

  await h.resolveApi();
  s = h.store.getSnapshot();
  assert.equal(s.isPlayerReady, true);
  assert.equal(h.players.length, 1, 'player created once the API is ready');
  const player = h.players[0];
  assert.equal(player.videoId, 'video-t1');
  assert.equal(player.options.playerVars?.start, 100);

  player.duration = 5000;
  player.ready();
  assert.deepEqual(player.callsOf('seekTo')[0], [100, true], 'onReady seeks to the track timestamp');
  assert.ok(player.callNames().includes('playVideo'));
  assert.deepEqual(player.callsOf('setVolume')[0], [75], 'saved volume applied (fallback 75)');
  assert.ok(player.callNames().includes('unMute'), 'unmuted by default');
  console.log('✓ playTrackWithQueue materializes the queue and boots the player');
}

// ---------------------------------------------------------------------------
// 3. Pause pressed while the API is still loading is honored at onReady
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  h.store.actions.playTrackWithQueue(track('t1'), []);
  h.store.actions.togglePlayPause(); // no player yet — flips intent to paused
  assert.equal(h.store.getSnapshot().isPlaying, false);
  await h.resolveApi();
  const player = h.players[0];
  player.ready();
  assert.ok(player.callNames().includes('pauseVideo'), 'onReady honors the pre-ready pause');
  assert.equal(h.store.getSnapshot().isPlaying, false, 'no transient isPlaying flash');
  console.log('✓ pre-ready pause intent is honored');
}

// ---------------------------------------------------------------------------
// 4. API load failure sets the error and resets optimistic playback
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  h.store.actions.playTrackWithQueue(track('t1'), []);
  await h.rejectApi();
  let s = h.store.getSnapshot();
  assert.equal(s.apiLoadError, '播放器載入失敗，請重新整理頁面');
  assert.equal(s.isPlaying, false, 'optimistic flip reset on failure');

  // A later play retries the loader and clears the error on success.
  h.store.actions.playTrackWithQueue(track('t2'), []);
  await h.resolveApi();
  s = h.store.getSnapshot();
  assert.equal(s.apiLoadError, null);
  assert.equal(h.players.length, 1);
  console.log('✓ API failure resets playback; the next attempt retries');
}

// ---------------------------------------------------------------------------
// 5. Player reuse: same-video seek vs cross-video load with clamped start
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const a1 = track('a1', { videoId: 'vod-A', timestamp: 100 });
  const a2 = track('a2', { videoId: 'vod-A', timestamp: 900 });
  const b1 = track('b1', { videoId: 'vod-B', timestamp: 50 });
  const player = await startPlaying(h, a1);
  player.duration = 5000;

  h.store.actions.playTrackWithQueue(a2, []);
  assert.ok(player.callsOf('seekTo').some((args) => args[0] === 900), 'same VOD seeks, no reload');
  assert.equal(player.callsOf('loadVideoById').length, 0);

  h.store.actions.playTrackWithQueue(b1, []);
  assert.deepEqual(player.callsOf('loadVideoById')[0], [{ videoId: 'vod-B', startSeconds: 50 }]);
  assert.equal(h.players.length, 1, 'iframe reused across videos');

  // Learn vod-B's duration, then start a vod-B performance whose timestamp
  // exceeds it: startSeconds clamps to 0.
  player.duration = 300;
  player.videoDataId = 'vod-B';
  player.firePlaying();
  const bLate = track('b2', { videoId: 'vod-B', timestamp: 5000 });
  h.store.actions.playTrackWithQueue(track('a3', { videoId: 'vod-A', timestamp: 1 }), []);
  h.store.actions.playTrackWithQueue(bLate, []);
  const loads = player.callsOf('loadVideoById');
  assert.deepEqual(loads[loads.length - 1], [{ videoId: 'vod-B', startSeconds: 0 }], 'known-too-long timestamp clamps to 0');
  console.log('✓ player reuse: seek same-VOD, load cross-VOD, clamp known-bad timestamps');
}

// ---------------------------------------------------------------------------
// 6. Duration attribution uses the event video, not the pending one
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const a1 = track('a1', { videoId: 'vod-A', timestamp: 10 });
  const player = await startPlaying(h, a1);
  // Track moved on to vod-B, but a queued PLAYING event still describes vod-A.
  h.store.actions.playTrackWithQueue(track('b1', { videoId: 'vod-B', timestamp: 7000 }), []);
  player.duration = 6000;
  player.videoDataId = 'vod-A';
  player.firePlaying();
  // If 6000 were mis-attributed to vod-B, this next play would clamp b2's
  // timestamp 7000 to 0. It must NOT (vod-B has no known duration).
  h.store.actions.playTrackWithQueue(track('a2', { videoId: 'vod-A', timestamp: 20 }), []);
  h.store.actions.playTrackWithQueue(track('b2', { videoId: 'vod-B', timestamp: 7000 }), []);
  const loads = player.callsOf('loadVideoById');
  assert.deepEqual(loads[loads.length - 1], [{ videoId: 'vod-B', startSeconds: 7000 }]);
  console.log('✓ late PLAYING events attribute duration to their own video');
}

// ---------------------------------------------------------------------------
// 7. timestampWarning fires once per performance, only on real durations
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const long = track('t1', { videoId: 'vod-A', timestamp: 900 });
  const player = await startPlaying(h, long); // duration still 0 at ready
  assert.equal(h.store.getSnapshot().timestampWarning, null, 'a zero duration is not "known"');

  player.duration = 500;
  player.firePlaying();
  assert.equal(h.store.getSnapshot().timestampWarning, '時間戳可能有誤');
  h.store.actions.clearTimestampWarning();
  player.firePlaying();
  assert.equal(h.store.getSnapshot().timestampWarning, null, 'same performance never re-flags');

  // A different too-long performance on the same (already cached) video flags at set time.
  h.store.actions.playTrackWithQueue(track('t2', { videoId: 'vod-A', timestamp: 800 }), []);
  assert.equal(h.store.getSnapshot().timestampWarning, '時間戳可能有誤');
  console.log('✓ timestamp warning: once per performance, cached-duration aware');
}

// ---------------------------------------------------------------------------
// 8. next(): advance, stop-at-end, repeat-all refill
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1', { videoId: 'vod-A' });
  const t2 = track('t2', { videoId: 'vod-B' });
  const player = await startPlaying(h, t1, [t2]);

  h.store.actions.next();
  let s = h.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't2');
  assert.equal(s.queue.length, 0);
  assert.equal(s.isPlaying, true);

  // Queue empty + repeat off: stop and reset intent.
  h.store.actions.next();
  s = h.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't2', 'track unchanged');
  assert.equal(s.isPlaying, false);
  assert.ok(player.callNames().includes('pauseVideo'));

  // previous() through history restores t1.
  h.store.actions.previous();
  s = h.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't1');
  assert.equal(s.isPlaying, true);

  // Repeat-all with an empty queue refills from every track seen this session
  // and rotates the finished track to the end.
  h.store.actions.next(); // queue still empty, repeat off -> stops again
  h.store.actions.toggleRepeat(); // off -> all
  h.store.actions.next();
  s = h.store.getSnapshot();
  assert.equal(s.repeatMode, 'all');
  assert.ok(s.currentTrack, 'repeat-all keeps playing from the session pool');
  assert.ok(s.queue.length >= 1, 'refilled queue rotates the finished track to the end');
  console.log('✓ next/previous/repeat-all advance semantics hold');
}

// ---------------------------------------------------------------------------
// 9. Deleted entries are skipped with a notification; all-deleted finishes
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1');
  const dead = track('dead', { deleted: true });
  const t2 = track('t2');
  await startPlaying(h, t1, [dead, t2]);
  h.store.actions.next();
  let s = h.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't2');
  assert.equal(s.skipNotification, '已跳過無法播放的版本');

  const h2 = createHarness();
  await startPlaying(h2, track('t1'), [track('d1', { deleted: true }), track('d2', { deleted: true })]);
  h2.store.actions.next();
  s = h2.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't1', 'nothing playable: current track stays');
  assert.equal(s.isPlaying, false);
  assert.deepEqual(s.queue, []);
  assert.equal(s.skipNotification, '播放完畢');
  console.log('✓ deleted-entry skipping and end-of-queue notification');
}

// ---------------------------------------------------------------------------
// 10. ENDED events: advance or repeat-one replay
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1', { timestamp: 100 });
  const t2 = track('t2');
  const player = await startPlaying(h, t1, [t2]);

  h.store.actions.toggleRepeat(); // all
  h.store.actions.toggleRepeat(); // one
  player.fireEnded();
  assert.equal(h.store.getSnapshot().currentTrack?.performanceId, 't1', 'repeat-one replays');
  assert.ok(player.callsOf('seekTo').some((args) => args[0] === 100));

  h.store.actions.toggleRepeat(); // one -> off
  player.fireEnded();
  assert.equal(h.store.getSnapshot().currentTrack?.performanceId, 't2', 'ENDED advances the queue');
  console.log('✓ ENDED handling: repeat-one replay and queue advance');
}

// ---------------------------------------------------------------------------
// 11. The 500ms poll: clock updates, endTimestamp clip advance, timer lifecycle
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1', { timestamp: 100, endTimestamp: 200 });
  const t2 = track('t2');
  const player = await startPlaying(h, t1, [t2]);
  assert.equal(h.scheduler.active.size, 1, 'poll timer runs while playing');

  player.currentTime = 150;
  h.scheduler.tick();
  assert.equal(h.store.timeStore.getSnapshot().currentTime, 150);

  player.currentTime = 201;
  h.scheduler.tick();
  assert.equal(h.store.getSnapshot().currentTrack?.performanceId, 't2', 'clip end advances');

  h.store.actions.togglePlayPause();
  assert.equal(h.scheduler.active.size, 0, 'pause stops the poll timer');
  h.store.actions.togglePlayPause();
  assert.equal(h.scheduler.active.size, 1, 'resume restarts it');

  // next() with an emptied queue (repeat off) stops playback and the timer.
  h.store.actions.next();
  const s = h.store.getSnapshot();
  assert.equal(s.isPlaying, false);
  assert.equal(h.scheduler.active.size, 0);
  console.log('✓ poll timer lifecycle and endTimestamp clip advance');
}

// ---------------------------------------------------------------------------
// 12. Playback errors mark the video unavailable; error is per-track
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1', { videoId: 'vod-A' });
  const player = await startPlaying(h, t1);
  player.fireError(5); // HTML5 error — not an availability error
  assert.equal(h.store.getSnapshot().playerError, null);
  player.fireError(150);
  let s = h.store.getSnapshot();
  assert.equal(s.playerError, '此影片已無法播放');
  assert.ok(s.unavailableVideoIds.has('vod-A'));

  h.store.actions.playTrackWithQueue(track('t2', { videoId: 'vod-B' }), []);
  s = h.store.getSnapshot();
  assert.equal(s.playerError, null, 'error clears on a track from another video');
  assert.ok(s.unavailableVideoIds.has('vod-A'), 'unavailable set persists');
  console.log('✓ error codes 100/101/150 mark availability; 5 does not');
}

// ---------------------------------------------------------------------------
// 13. Volume and mute drive the player and auto-unmute on raise
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const player = await startPlaying(h, track('t1'));
  h.store.actions.setVolume(150);
  assert.equal(h.store.volumeStore.getSnapshot(), 100, 'clamped to 100');
  assert.ok(player.callsOf('setVolume').some((args) => args[0] === 100));

  h.store.actions.toggleMute();
  assert.equal(h.store.mutedStore.getSnapshot(), true);
  assert.ok(player.callNames().includes('mute'));

  h.store.actions.setVolume(40);
  assert.equal(h.store.mutedStore.getSnapshot(), false, 'raising volume unmutes');
  assert.ok(player.callNames().includes('unMute'));
  console.log('✓ volume/mute wiring with clamp and auto-unmute');
}

// ---------------------------------------------------------------------------
// 14. Queue editing: add (with session-pool dedupe), remove, reorder
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  await startPlaying(h, track('t1'));
  h.store.actions.addToQueue(track('q1'));
  h.store.actions.addToQueue(track('q2'));
  h.store.actions.addToQueue(track('q3'));
  let s = h.store.getSnapshot();
  assert.deepEqual(s.queue.map((q) => q.performanceId), ['q1', 'q2', 'q3']);

  h.store.actions.reorderQueue(0, 2);
  s = h.store.getSnapshot();
  assert.deepEqual(s.queue.map((q) => q.performanceId), ['q2', 'q3', 'q1']);

  h.store.actions.removeFromQueue(1);
  s = h.store.getSnapshot();
  assert.deepEqual(s.queue.map((q) => q.performanceId), ['q2', 'q1']);
  console.log('✓ queue add/remove/reorder');
}

// ---------------------------------------------------------------------------
// 15. Overlays, notices, shuffle toggle
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  h.store.actions.setShowModal(true);
  h.store.actions.setShowQueue(true);
  h.store.actions.toggleShuffle();
  let s = h.store.getSnapshot();
  assert.equal(s.showModal, true);
  assert.equal(s.showQueue, true);
  assert.equal(s.shuffleOn, true);
  h.store.actions.toggleShuffle();
  assert.equal(h.store.getSnapshot().shuffleOn, false);
  console.log('✓ overlays and shuffle toggles');
}

// ---------------------------------------------------------------------------
// 16. Subscribe/notify and snapshot identity discipline
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const before = h.notifications;
  h.store.actions.setShowModal(true);
  assert.ok(h.notifications > before, 'setState notifies subscribers');
  const s1 = h.store.getSnapshot();
  h.store.actions.setShowQueue(true);
  const s2 = h.store.getSnapshot();
  assert.notEqual(s1, s2, 'snapshot identity changes on update');
  assert.equal(s1.queue, s2.queue, 'untouched fields keep their identity');

  let called = 0;
  const unsubscribe = h.store.subscribe(() => { called++; });
  h.store.actions.setShowModal(false);
  unsubscribe();
  h.store.actions.setShowModal(true);
  assert.equal(called, 1, 'unsubscribed listeners stop firing');
  console.log('✓ subscription contract and structural sharing');
}

// ---------------------------------------------------------------------------
// 17. destroy() releases the player and timer; the store stays usable
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const player = await startPlaying(h, track('t1'));
  h.store.destroy();
  assert.equal(player.destroyed, true);
  assert.equal(h.scheduler.active.size, 0);

  h.store.actions.playTrackWithQueue(track('t2'), []);
  await h.resolveApi();
  assert.equal(h.players.length, 2, 'a fresh player is created after destroy');
  console.log('✓ destroy releases resources without poisoning the store');
}

// ---------------------------------------------------------------------------
// 18. Re-clicking the already-playing track restarts it (sanctioned improvement #3)
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1', { videoId: 'vod-A', timestamp: 100 });
  const player = await startPlaying(h, t1);
  player.calls.length = 0;
  h.store.actions.playTrackWithQueue(t1, []);
  assert.ok(player.callsOf('seekTo').some((args) => args[0] === 100), 're-click seeks back to the clip start');
  assert.ok(player.callNames().includes('playVideo'), 're-click restarts playback');
  assert.equal(h.store.timeStore.getSnapshot().currentTime, 100);
  console.log('✓ re-clicking the playing track restarts it (sanctioned improvement #3)');
}

// ---------------------------------------------------------------------------
// 19. destroy() cancels in-flight API callbacks without poisoning the store
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  h.store.actions.playTrackWithQueue(track('t1'), []); // loadApi in flight
  h.store.destroy();
  const before = h.store.getSnapshot();
  await h.resolveApi(); // settles the PRE-destroy promise
  assert.equal(h.players.length, 0, 'no player is created for a destroyed epoch');
  assert.equal(h.store.getSnapshot(), before, 'stale loadApi success does not touch state');

  // The store itself stays usable: a fresh play under the new epoch works.
  h.store.actions.playTrackWithQueue(track('t2'), []);
  await h.resolveApi();
  assert.equal(h.players.length, 1);
  assert.equal(h.store.getSnapshot().isPlayerReady, true);

  const h2 = createHarness();
  h2.store.actions.playTrackWithQueue(track('t1'), []);
  h2.store.destroy();
  await h2.rejectApi();
  assert.equal(h2.store.getSnapshot().apiLoadError, null, 'stale loadApi failure does not touch state');
  console.log('✓ destroy cancels in-flight API callbacks without poisoning the store');
}

// ---------------------------------------------------------------------------
// 20. ensurePlayerApi syncs the player only on the not-ready -> ready transition
// ---------------------------------------------------------------------------
{
  // Production's loader caches: it resolves on a microtask after EVERY call.
  const players: FakePlayer[] = [];
  const scheduler = new ManualScheduler();
  const store = createPlayerStore({
    loadApi: () => Promise.resolve(),
    createPlayer: (_elementId, options) => {
      const player = new FakePlayer(options);
      players.push(player);
      return player;
    },
    schedule: scheduler,
  });
  const t1 = track('t1', { videoId: 'vod-A', timestamp: 100 });
  const t2 = track('t2', { videoId: 'vod-A', timestamp: 400 });
  store.actions.playTrackWithQueue(t1, [t2]);
  await Promise.resolve();
  await Promise.resolve();
  const player = players[0];
  player.ready();
  store.actions.next(); // the advance calls ensurePlayerApi again — it resolves a microtask later
  const seeksAfterAdvance = player.callsOf('seekTo').length;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(player.callsOf('seekTo').length, seeksAfterAdvance, 'an already-ready API resolution does not re-seek the current track');
  console.log('✓ ensurePlayerApi only syncs the player on the not-ready -> ready transition');
}

// ---------------------------------------------------------------------------
// 21. PAUSED events settle isPlaying and stop the poll timer
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const player = await startPlaying(h, track('t1'));
  assert.equal(h.scheduler.active.size, 1);
  player.firePaused();
  assert.equal(h.store.getSnapshot().isPlaying, false, 'a player-initiated pause lands in state');
  assert.equal(h.scheduler.active.size, 0, 'and stops the poll timer');
  console.log('✓ PAUSED events settle isPlaying and the poll timer');
}

// ---------------------------------------------------------------------------
// 22. onReady seeks from FRESH state, not the creation-time track (improvement #2)
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const a1 = track('a1', { videoId: 'vod-A', timestamp: 100 });
  const a2 = track('a2', { videoId: 'vod-A', timestamp: 900 });
  h.store.actions.playTrackWithQueue(a1, []);
  await h.resolveApi();
  const player = h.players[0];
  // Same video, different performance picked while the player is still booting:
  // syncPlayer's reuse branch already seeked (ignored by a not-ready player) —
  // onReady must position at a2's timestamp, not creation-time a1's.
  h.store.actions.playTrackWithQueue(a2, []);
  player.calls.length = 0;
  player.ready();
  assert.ok(player.callsOf('seekTo').some((args) => args[0] === 900), 'onReady seeks to the CURRENT track timestamp');
  assert.ok(!player.callsOf('seekTo').some((args) => args[0] === 100), 'and not to the stale creation-time timestamp');

  // Cross-video switch during boot: loadedVideoId moved on and the ready
  // event still describes the old video — no closure seek at all.
  const h2 = createHarness();
  h2.store.actions.playTrackWithQueue(track('b1', { videoId: 'vod-B', timestamp: 50 }), []);
  await h2.resolveApi();
  const player2 = h2.players[0];
  h2.store.actions.playTrackWithQueue(track('c1', { videoId: 'vod-C', timestamp: 70 }), []);
  player2.videoDataId = 'vod-B'; // onReady still reports the pre-switch video
  player2.calls.length = 0;
  player2.ready();
  assert.equal(player2.callsOf('seekTo').length, 0, 'onReady never seeks when the loaded video moved on');
  console.log('✓ onReady positions from fresh state (sanctioned improvement #2)');
}

// ---------------------------------------------------------------------------
// 23. The poll's clip-end honors repeat-one: seek back, no advance
// ---------------------------------------------------------------------------
{
  const h = createHarness();
  const t1 = track('t1', { timestamp: 100, endTimestamp: 200 });
  const t2 = track('t2');
  const player = await startPlaying(h, t1, [t2]);
  h.store.actions.toggleRepeat(); // all
  h.store.actions.toggleRepeat(); // one
  player.currentTime = 250;
  h.scheduler.tick();
  const s = h.store.getSnapshot();
  assert.equal(s.currentTrack?.performanceId, 't1', 'repeat-one never advances at clip end');
  assert.equal(s.queue.length, 1, 'queue untouched');
  assert.ok(player.callsOf('seekTo').some((args) => args[0] === 100), 'seeks back to the clip start');
  console.log('✓ poll clip-end honors repeat-one');
}

console.log('✓ createPlayerStore behaves like the PlayerContext it replaces');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { createPlaybackTimeStore, type PlaybackTimeStore } from './playback-time-store';
import { createPersistedStore, type PersistedStore } from './persisted-store';
import { loadYouTubeIframeApi } from '../../lib/youtube-iframe';
import type {
  YouTubeNamespace,
  YouTubePlayer,
  YouTubePlayerEventWithData,
  YouTubePlayerOptions,
  YouTubeReadyEvent,
} from '../../lib/youtube-iframe';
import type { PerformanceRef } from '../types/archive';

export type Track = PerformanceRef & {
  /** Set by playlists whose performance no longer exists in the archive. */
  deleted?: boolean;
};

export interface QueueEntry extends PerformanceRef {
  deleted?: boolean;
  queueEntryId: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  isPlayerReady: boolean;
  /** Derived: the loaded video errored AND the current track still points at it. */
  playerError: string | null;
  apiLoadError: string | null;
  unavailableVideoIds: Set<string>;
  timestampWarning: string | null;
  skipNotification: string | null;
  showModal: boolean;
  showQueue: boolean;
  queue: QueueEntry[];
  repeatMode: RepeatMode;
  shuffleOn: boolean;
}

export interface PlayerActions {
  playTrackWithQueue: (track: Track, following: Track[]) => void;
  togglePlayPause: () => void;
  seekTo: (seconds: number) => void;
  previous: () => void;
  next: () => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  setShowModal: (show: boolean) => void;
  setShowQueue: (show: boolean) => void;
  clearTimestampWarning: () => void;
  clearSkipNotification: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  ensurePlayerApi: () => void;
}

export interface PollScheduler {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

export interface PlayerStoreDeps {
  loadApi?: () => Promise<unknown>;
  createPlayer?: (elementId: string, options: YouTubePlayerOptions) => YouTubePlayer;
  schedule?: PollScheduler;
}

export interface PlayerStore {
  getSnapshot: () => PlayerState;
  getServerSnapshot: () => PlayerState;
  subscribe: (listener: () => void) => () => void;
  actions: PlayerActions;
  /** High-frequency playback clock — consume via usePlaybackTime(), not directly. */
  timeStore: PlaybackTimeStore;
  volumeStore: PersistedStore<number>;
  mutedStore: PersistedStore<boolean>;
  /** Release the iframe player and poll timer. The store stays usable — the next play recreates them. */
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** The hidden iframe host rendered by YouTubePlayerContainer. */
export const PLAYER_DIV_ID = 'youtube-player';

// previous() only ever pops the top of the history stack — a bounded window
// is invisible to users but keeps long sessions from growing without limit.
const PLAY_HISTORY_LIMIT = 100;

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createPlayerStore(deps: PlayerStoreDeps = {}): PlayerStore {
  const loadApi = deps.loadApi ?? (() => loadYouTubeIframeApi(window, document));
  const createPlayer =
    deps.createPlayer ?? ((elementId: string, options: YouTubePlayerOptions) => new window.YT!.Player(elementId, options));
  const schedule: PollScheduler = deps.schedule ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as Parameters<typeof clearInterval>[0]),
  };
  // Captured at creation: the SSR store instance never touches the API; the
  // client gets its own instance with a real window.
  const canUseYouTube = deps.loadApi !== undefined || typeof window !== 'undefined';

  const initialState: PlayerState = {
    currentTrack: null,
    isPlaying: false,
    isPlayerReady: false,
    playerError: null,
    apiLoadError: null,
    unavailableVideoIds: new Set<string>(),
    timestampWarning: null,
    skipNotification: null,
    showModal: false,
    showQueue: false,
    queue: [],
    repeatMode: 'off',
    shuffleOn: false,
  };
  let state = initialState;
  const listeners = new Set<() => void>();

  // Engine internals — plain closures, never rendered, so no reactivity needed.
  // (These replace the 9 mirror refs the React implementation carried.)
  let player: YouTubePlayer | null = null;
  let loadedVideoId: string | null = null;
  let erroredVideoId: string | null = null;
  let playHistory: { track: Track; rotatedEntryId?: string }[] = [];
  const forwardEntryIds = new Set<string>();
  // Repeat-all refill pool — deliberately uncapped: deduped by performanceId and
  // bounded by the number of distinct performances played this session.
  const allTracks: Track[] = [];
  const allTrackIds = new Set<string>();
  // Duration of each loaded video, learned only from the player's own async
  // onReady/onStateChange callbacks.
  const videoDurations = new Map<string, number>();
  // Which performance already got its timestamp-vs-duration check.
  let checkedTimestampFor: string | null = null;
  let pollTimerId: unknown = null;
  let queueEntrySeq = 0;
  // Bumped by destroy(): in-flight loadApi callbacks from before the bump
  // must not touch state or create a player against a removed host div.
  // A remounted provider calls ensurePlayerApi again under the new epoch.
  let engineEpoch = 0;

  const timeStore = createPlaybackTimeStore();
  const volumeStore = createPersistedStore<number>({
    key: 'prism_volume',
    fallback: 75,
    parse: (raw) => {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 75;
    },
    // Volatile UI setting: keep the slider and the YouTube player's real
    // volume moving together even when storage refuses the write.
    persist: 'best-effort',
  });
  const mutedStore = createPersistedStore<boolean>({
    key: 'prism_muted',
    fallback: false,
    parse: (raw) => raw === true || raw === 'true',
    // Same as volumeStore: don't freeze the mute icon under a storage failure.
    persist: 'best-effort',
  });

  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch };
    syncPollTimer();
    for (const listener of [...listeners]) listener();
  }

  function playerErrorFor(track: Track | null): string | null {
    return track && erroredVideoId === track.videoId ? '此影片已無法播放' : null;
  }

  function createQueueEntry(track: Track): QueueEntry {
    return { ...track, queueEntryId: `q-${queueEntrySeq++}` };
  }

  function pushHistory(track: Track, rotatedEntryId?: string): void {
    playHistory = [...playHistory, { track, rotatedEntryId }].slice(-PLAY_HISTORY_LIMIT);
  }

  function addAllTracks(tracks: Track[]): void {
    for (const track of tracks) {
      if (!allTrackIds.has(track.performanceId)) {
        allTrackIds.add(track.performanceId);
        allTracks.push(track);
      }
    }
  }

  /**
   * Flag a too-long timestamp exactly once per performance, as soon as its
   * video's real duration is known. getDuration() reports 0 until YouTube's
   * metadata loads, so a cached 0 is not actually "known" yet.
   * Returns a state patch so callers fold it into their own setState.
   */
  function checkTimestampOnce(track: Track): Partial<PlayerState> {
    if (track.performanceId === checkedTimestampFor) return {};
    const known = videoDurations.get(track.videoId);
    if (known === undefined || known <= 0) return {};
    checkedTimestampFor = track.performanceId;
    if (track.timestamp > 0 && track.timestamp >= known) {
      return { timestampWarning: '時間戳可能有誤' };
    }
    return {};
  }

  /** Cache a learned duration and run the timestamp check it may unlock. */
  function rememberDuration(videoId: string | null, duration: number): Partial<PlayerState> {
    if (duration <= 0 || !videoId) return {};
    videoDurations.set(videoId, duration);
    const track = state.currentTrack;
    if (!track || track.videoId !== videoId) return {};
    return checkTimestampOnce(track);
  }

  function applyAudioSettings(target: YouTubePlayer): void {
    target.setVolume(volumeStore.getSnapshot());
    if (mutedStore.getSnapshot()) {
      target.mute();
    } else {
      target.unMute();
    }
  }

  function syncPollTimer(): void {
    if (state.isPlaying && pollTimerId === null) {
      pollTimerId = schedule.setInterval(pollPlaybackTime, 500);
    } else if (!state.isPlaying && pollTimerId !== null) {
      schedule.clearInterval(pollTimerId);
      pollTimerId = null;
    }
  }

  function pollPlaybackTime(): void {
    if (!player?.getCurrentTime) return;
    const current = player.getCurrentTime();
    timeStore.setTime(current);
    const track = state.currentTrack;
    if (!track?.endTimestamp || current < track.endTimestamp) return;
    // Reached the clip's end timestamp.
    if (state.repeatMode === 'one') {
      player.seekTo(track.timestamp, true);
      return;
    }
    if (state.queue.length > 0 || state.repeatMode === 'all') {
      advanceSkippingDeleted(state.queue, track);
    } else {
      player.pauseVideo();
      setState({ isPlaying: false });
    }
  }

  // Load the YouTube IFrame API on demand. Safe to call repeatedly — the
  // loader caches an in-flight/successful load and a failed load is retried
  // by the next call.
  function ensurePlayerApi(): void {
    if (!canUseYouTube) return;
    const epoch = engineEpoch;
    loadApi()
      .then(() => {
        // A destroy() between the call and this resolving invalidates it —
        // the store may have been torn down (or remounted into a fresh
        // epoch, which issues its own ensurePlayerApi call).
        if (epoch !== engineEpoch) return;
        // Only the false→true transition may start the player: this resolves
        // on EVERY call (the loader caches), and an unconditional syncPlayer
        // here would re-seek the already-playing track a microtask after each
        // queue advance. (The old React code got this for free — setting
        // already-true state skipped the re-render, so the load effect never
        // re-ran.)
        const becameReady = !state.isPlayerReady;
        setState({ apiLoadError: null, isPlayerReady: true });
        if (becameReady) syncPlayer();
      })
      .catch(() => {
        // Same guard as .then — a stale failure must not smear apiLoadError
        // onto a store that has moved past this epoch.
        if (epoch !== engineEpoch) return;
        // Reset the optimistic isPlaying flip made by the caller — with the
        // API blocked, nothing is actually going to play.
        setState({ apiLoadError: '播放器載入失敗，請重新整理頁面', isPlaying: false });
      });
  }

  // Point the iframe at the current track: seek within the same VOD, load a
  // different VOD in place, or create the player on first use. Called after
  // every state change that moves currentTrack, and once the API turns ready.
  // Reuses the existing player instance to preserve autoplay permission.
  function syncPlayer(): void {
    const track = state.currentTrack;
    if (!state.isPlayerReady || !track) return;

    if (player && loadedVideoId) {
      if (track.videoId === loadedVideoId) {
        // Same VOD — seek to the new timestamp. onStateChange reports the
        // resulting isPlaying state once the seek's buffering settles.
        const videoDuration = player.getDuration?.() || 0;
        if (track.timestamp > 0 && videoDuration > 0 && track.timestamp >= videoDuration) {
          player.seekTo(0, true);
        } else {
          player.seekTo(track.timestamp, true);
        }
        applyAudioSettings(player);
        player.playVideo();
        return;
      }
      // Different VOD — load without destroying the iframe. A too-long
      // timestamp gets the same seek-to-0 recovery, but only when this
      // video's duration is already cached (it can't be read before load).
      loadedVideoId = track.videoId;
      const knownDuration = videoDurations.get(track.videoId);
      // A cached 0 means metadata hadn't loaded when it was recorded, not a
      // genuinely known (zero-length) duration — ignore it.
      const startSeconds =
        knownDuration !== undefined && knownDuration > 0 && track.timestamp > 0 && track.timestamp >= knownDuration
          ? 0
          : track.timestamp;
      player.loadVideoById({ videoId: track.videoId, startSeconds });
      applyAudioSettings(player);
      return;
    }

    // First-time creation. Destroy any leftover player (shouldn't happen, but safety).
    if (player) {
      player.destroy();
      player = null;
    }
    loadedVideoId = track.videoId;
    player = createPlayer(PLAYER_DIV_ID, {
      height: '360',
      width: '640',
      videoId: track.videoId,
      playerVars: {
        start: track.timestamp,
        autoplay: 1,
        controls: 1,
        rel: 0,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
      events: { onReady, onStateChange, onError },
    });
  }

  function onReady(event: YouTubeReadyEvent): void {
    const target = event.target;
    // Capture BEFORE playVideo(): a synchronously-firing stub delivers the
    // PLAYING state change re-entrantly, which would overwrite the intent.
    // A pause pressed while the API was still loading (togglePlayPause's
    // no-player branch) lands here as isPlaying === false.
    const pausedIntent = !state.isPlaying;
    const videoDuration = target.getDuration();
    timeStore.setDuration(videoDuration);
    // If the user picked a different track while this player was becoming
    // ready, syncPlayer has already moved loadedVideoId on — resolve which
    // video this event actually describes before attributing its duration.
    const readyVideoId = target.getVideoData?.()?.video_id ?? loadedVideoId;
    const durationPatch = rememberDuration(readyVideoId, videoDuration);

    // Seek only when the ready video is still the current track's video —
    // otherwise syncPlayer already positioned the newer video.
    const track = state.currentTrack;
    if (track && readyVideoId === track.videoId) {
      if (track.timestamp > 0 && videoDuration > 0 && track.timestamp >= videoDuration) {
        target.seekTo(0, true);
      } else {
        target.seekTo(track.timestamp, true);
      }
    }

    applyAudioSettings(target);
    target.playVideo();
    if (pausedIntent) {
      // Autoplay above would override the user's pre-ready pause — honor it.
      target.pauseVideo?.();
      setState({ ...durationPatch, isPlaying: false });
    } else {
      setState({ ...durationPatch, isPlaying: true });
    }
  }

  function onStateChange(event: YouTubePlayerEventWithData<number>): void {
    // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0
    if (event.data === 1) {
      const duration = event.target.getDuration();
      let durationPatch: Partial<PlayerState> = {};
      if (duration > 0) {
        timeStore.setDuration(duration);
        // Resolve which video this event actually describes — a queued
        // PLAYING event for the previous video can arrive after
        // loadedVideoId has already moved on.
        const eventVideoId = event.target.getVideoData?.()?.video_id ?? loadedVideoId;
        durationPatch = rememberDuration(eventVideoId, duration);
      }
      setState({ ...durationPatch, isPlaying: true });
    } else if (event.data === 2) {
      setState({ isPlaying: false });
    } else if (event.data === 0) {
      const track = state.currentTrack;
      if (state.repeatMode === 'one' && track) {
        player?.seekTo(track.timestamp, true);
        player?.playVideo();
        return;
      }
      if (state.queue.length > 0 || state.repeatMode === 'all') {
        advanceSkippingDeleted(state.queue, track);
      } else {
        setState({ isPlaying: false });
      }
    }
  }

  function onError(event: YouTubePlayerEventWithData<number>): void {
    // YouTube error codes — 100: not found / removed, 101/150: embedding
    // restricted by the owner. (2: bad parameter, 5: HTML5 error — transient.)
    const errorVideoId = loadedVideoId;
    if (![100, 101, 150].includes(event.data) || !errorVideoId) return;
    erroredVideoId = errorVideoId;
    setState({
      unavailableVideoIds: new Set([...state.unavailableVideoIds, errorVideoId]),
      playerError: playerErrorFor(state.currentTrack),
    });
  }

  // Advance to the next non-deleted track in the queue. Returns false when
  // nothing playable remains (queue emptied, playback stopped).
  function advanceSkippingDeleted(currentQueue: QueueEntry[], fromTrack: Track | null): boolean {
    let skippedAny = false;
    let remainingQueue = currentQueue;
    while (remainingQueue.length > 0 && remainingQueue[0].deleted) {
      skippedAny = true;
      remainingQueue = remainingQueue.slice(1);
    }

    // Queue exhausted with repeat-all on: re-populate from the session pool.
    if (remainingQueue.length === 0 && state.repeatMode === 'all' && allTracks.length > 0) {
      const tracks = allTracks.filter((t) => !t.deleted);
      if (tracks.length > 0) {
        const entries = tracks.map(createQueueEntry);
        remainingQueue = state.shuffleOn ? shuffleArray(entries) : entries;
      }
    }

    const playable = remainingQueue.filter((t) => !t.deleted);
    if (playable.length === 0) {
      setState({
        queue: [],
        isPlaying: false,
        ...(skippedAny ? { skipNotification: '播放完畢' } : {}),
      });
      player?.pauseVideo();
      return false;
    }

    // Covers the auto-advance/polling path landing before the idle prefetch
    // has run; idempotent, and its .catch resets isPlaying if it fails.
    ensurePlayerApi();

    const forwardIndex = playable.findIndex((entry) => forwardEntryIds.has(entry.queueEntryId));
    const pickIndex = forwardIndex >= 0 ? forwardIndex : state.shuffleOn ? Math.floor(Math.random() * playable.length) : 0;
    const nextTrack = playable[pickIndex];
    forwardEntryIds.delete(nextTrack.queueEntryId);
    const actualIndex = remainingQueue.indexOf(nextTrack);
    const newQueue = [...remainingQueue];
    newQueue.splice(actualIndex, 1);
    // Repeat-all: rotate the finished track to the end of the queue.
    let rotatedEntryId: string | undefined;
    if (state.repeatMode === 'all' && fromTrack && !fromTrack.deleted) {
      const rotated = createQueueEntry(fromTrack);
      rotatedEntryId = rotated.queueEntryId;
      newQueue.push(rotated);
    }
    if (fromTrack) pushHistory(fromTrack, rotatedEntryId);
    timeStore.setTime(nextTrack.timestamp);
    setState({
      queue: newQueue,
      currentTrack: nextTrack,
      // Optimistic: advancing is initiated by a click or the clip-end poll,
      // not guessed from an effect — onStateChange corrects it if playback
      // doesn't actually start.
      isPlaying: true,
      playerError: playerErrorFor(nextTrack),
      ...(skippedAny ? { skipNotification: '已跳過無法播放的版本' } : {}),
      ...checkTimestampOnce(nextTrack),
    });
    syncPlayer();
    return true;
  }

  const actions: PlayerActions = {
    // Play a track and REPLACE the whole queue with `following` — clicking a
    // song in any list establishes that list as the new playback context.
    playTrackWithQueue(track, following) {
      forwardEntryIds.clear();
      // Covers fast clicks that land before the idle prefetch has run.
      ensurePlayerApi();
      const prevTrack = state.currentTrack;
      if (prevTrack && prevTrack.performanceId !== track.performanceId) {
        pushHistory(prevTrack);
      }
      timeStore.setTime(track.timestamp);
      addAllTracks([track, ...following]);
      setState({
        currentTrack: track,
        // Optimistic: the user's own click — onStateChange corrects it if
        // playback doesn't actually start.
        isPlaying: true,
        queue: following.map(createQueueEntry),
        playerError: playerErrorFor(track),
        ...checkTimestampOnce(track),
      });
      syncPlayer();
    },

    togglePlayPause() {
      if (!player) {
        // The iframe API hasn't finished loading — still flip the intent so
        // the control responds, and so onReady can honor a pause once ready.
        setState({ isPlaying: !state.isPlaying });
        return;
      }
      if (state.isPlaying) {
        player.pauseVideo();
        setState({ isPlaying: false });
      } else {
        player.playVideo();
        setState({ isPlaying: true });
      }
    },

    seekTo(seconds) {
      if (!player) return;
      player.seekTo(seconds, true);
      timeStore.setTime(seconds);
    },

    previous() {
      const track = state.currentTrack;
      if (!track) return;
      const timePlayed = timeStore.getSnapshot().currentTime - track.timestamp;
      if (timePlayed > 3) {
        actions.seekTo(track.timestamp);
        return;
      }
      if (playHistory.length === 0) return;
      // Idempotent; its .catch resets isPlaying if the API isn't available.
      ensurePlayerApi();
      const { track: prevTrack, rotatedEntryId } = playHistory[playHistory.length - 1];
      playHistory = playHistory.slice(0, -1);
      const forward = createQueueEntry(track);
      forwardEntryIds.add(forward.queueEntryId);
      timeStore.setTime(prevTrack.timestamp);
      setState({
        // Undo only the repeat-all rotation made by this transition, not an
        // intentional duplicate the user queued. Next retraces this step even
        // with shuffle enabled, then returns to normal queue selection.
        queue: [forward, ...state.queue.filter((entry) => entry.queueEntryId !== rotatedEntryId)],
        currentTrack: prevTrack,
        isPlaying: true,
        playerError: playerErrorFor(prevTrack),
        ...checkTimestampOnce(prevTrack),
      });
      syncPlayer();
    },

    next() {
      // User pressed next — always advance (ignore repeat-one).
      if (state.queue.length > 0 || state.repeatMode === 'all') {
        advanceSkippingDeleted(state.queue, state.currentTrack);
      } else {
        // No queue: stop playback. Reset the intent unconditionally — a Next
        // pressed while the iframe API is still loading has no player yet,
        // and a lingering optimistic isPlaying would make onReady start it.
        setState({ isPlaying: false });
        player?.pauseVideo();
      }
    },

    addToQueue(track) {
      addAllTracks([track]);
      setState({ queue: [...state.queue, createQueueEntry(track)] });
    },

    removeFromQueue(index) {
      const entry = state.queue[index];
      if (entry) forwardEntryIds.delete(entry.queueEntryId);
      setState({ queue: state.queue.filter((_, i) => i !== index) });
    },

    reorderQueue(fromIndex, toIndex) {
      if (!state.queue[fromIndex] || !state.queue[toIndex]) return;
      forwardEntryIds.clear();
      const newQueue = [...state.queue];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      setState({ queue: newQueue });
    },

    toggleRepeat() {
      setState({ repeatMode: state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off' });
    },

    toggleShuffle() {
      setState({ shuffleOn: !state.shuffleOn });
    },

    setShowModal(show) {
      setState({ showModal: show });
    },

    setShowQueue(show) {
      setState({ showQueue: show });
    },

    clearTimestampWarning() {
      setState({ timestampWarning: null });
    },

    clearSkipNotification() {
      setState({ skipNotification: null });
    },

    setVolume(volume) {
      const clamped = Math.max(0, Math.min(100, volume));
      volumeStore.update(() => clamped);
      player?.setVolume?.(clamped);
      // Auto-unmute when dragging above 0 while muted.
      if (clamped > 0 && mutedStore.getSnapshot()) {
        mutedStore.update(() => false);
        player?.unMute?.();
      }
    },

    toggleMute() {
      const newMuted = !mutedStore.getSnapshot();
      mutedStore.update(() => newMuted);
      if (newMuted) {
        player?.mute?.();
      } else {
        player?.unMute?.();
      }
    },

    ensurePlayerApi,
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initialState,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
    timeStore,
    volumeStore,
    mutedStore,
    destroy() {
      engineEpoch++;
      if (pollTimerId !== null) {
        schedule.clearInterval(pollTimerId);
        pollTimerId = null;
      }
      player?.destroy();
      player = null;
      loadedVideoId = null;
    },
  };
}

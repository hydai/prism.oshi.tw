'use client';

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPlaybackTimeStore, type PlaybackTimeStore } from '../lib/playback-time-store';
import { createPersistedStore, usePersistedStore } from '../lib/persisted-store';
import { loadYouTubeIframeApi } from '../../lib/youtube-iframe';
import type {
  YouTubeNamespace,
  YouTubePlayer,
  YouTubePlayerEventWithData,
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

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isPlayerReady: boolean;
  playerError: string | null;
  apiLoadError: string | null;
  unavailableVideoIds: Set<string>;
  timestampWarning: string | null;
  clearTimestampWarning: () => void;
  skipNotification: string | null;
  clearSkipNotification: () => void;
  /** High-frequency playback clock — consume via usePlaybackTime(), not directly */
  timeStore: PlaybackTimeStore;
  playTrackWithQueue: (track: Track, following: Track[]) => void;
  togglePlayPause: () => void;
  seekTo: (seconds: number) => void;
  previous: () => void;
  next: () => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  queue: QueueEntry[];
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  showQueue: boolean;
  setShowQueue: (show: boolean) => void;
  repeatMode: RepeatMode;
  shuffleOn: boolean;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  volume: number;
  isMuted: boolean;
  setVolume: (n: number) => void;
  toggleMute: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};

// Playback clock for components that display time/progress. Subscribing here
// re-renders only those components on the 500ms tick — the PlayerContext value
// itself no longer changes while a track plays.
export const usePlaybackTime = () => {
  const { timeStore, currentTrack } = usePlayer();
  const { currentTime, duration } = useSyncExternalStore(
    timeStore.subscribe,
    timeStore.getSnapshot,
    timeStore.getSnapshot,
  );
  const trackCurrentTime = currentTrack
    ? Math.max(0, currentTime - currentTrack.timestamp)
    : 0;
  const trackDuration = currentTrack?.endTimestamp != null
    ? currentTrack.endTimestamp - currentTrack.timestamp
    : null;
  return { currentTime, duration, trackCurrentTime, trackDuration };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// previous() only ever pops the top of the history stack — a bounded window
// is invisible to users but keeps long sessions from growing without limit
const PLAY_HISTORY_LIMIT = 100;

function usePlayerController(): PlayerContextType {
  const volumeKey = 'prism_volume';
  const mutedKey = 'prism_muted';
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  // Which video id last errored — compared against the current track so the
  // error clears itself on a track change, with no setState in the load effect.
  const [erroredVideoId, setErroredVideoId] = useState<string | null>(null);
  const playerError = currentTrack && erroredVideoId === currentTrack.videoId ? '此影片已無法播放' : null;
  const [apiLoadError, setApiLoadError] = useState<string | null>(null);
  const [unavailableVideoIds, setUnavailableVideoIds] = useState<Set<string>>(new Set());
  // Duration of each loaded video, learned only from the player's own async
  // onReady/onStateChange callbacks — lets a reused player validate a track's
  // timestamp below without a synchronous read (and setState) in the load effect.
  const [videoDurations, setVideoDurations] = useState<Map<string, number>>(new Map());
  const [timestampWarning, setTimestampWarning] = useState<string | null>(null);
  const [skipNotification, setSkipNotification] = useState<string | null>(null);
  // Lazy state initializer: built once per mount, never rebuilt (and no ref read during render).
  const [timeStore] = useState(createPlaybackTimeStore);
  const [showModal, setShowModal] = useState(false);
  const [playHistory, setPlayHistory] = useState<Track[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [shuffleOn, setShuffleOn] = useState(false);
  // Repeat-all refill pool — deliberately uncapped: it is deduped by performanceId and
  // bounded by the number of distinct performances played this session
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const volumeStore = useMemo(() => createPersistedStore<number>({
    key: volumeKey,
    fallback: 75,
    parse: (raw) => {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 75;
    },
    // Volatile UI setting: keep the slider and the YouTube player's real
    // volume moving together even when storage refuses the write.
    persist: 'best-effort',
  }), []);
  const mutedStore = useMemo(() => createPersistedStore<boolean>({
    key: mutedKey,
    fallback: false,
    parse: (raw) => raw === true || raw === 'true',
    // Same as volumeStore: don't freeze the mute icon under a storage failure.
    persist: 'best-effort',
  }), []);
  const volume = usePersistedStore(volumeStore);
  const isMuted = usePersistedStore(mutedStore);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerDivId = 'youtube-player';
  const loadedVideoIdRef = useRef<string | null>(null);
  // Refs to always have fresh values in async callbacks
  const queueRef = useRef<QueueEntry[]>([]);
  const currentTrackRef = useRef<Track | null>(null);
  const repeatModeRef = useRef<RepeatMode>('off');
  const shuffleOnRef = useRef(false);
  const allTracksRef = useRef<Track[]>([]);
  const volumeRef = useRef(75);
  const isMutedRef = useRef(false);
  // Mirrors isPlaying — read inside the player-creation onReady handler so a
  // pause pressed while the iframe API was still loading (togglePlayPause's
  // early-return branch flips isPlaying but can't reach the player yet) is
  // still honored once the player becomes available.
  const isPlayingRef = useRef(false);
  // Mirrors videoDurations state — read inside the player-load effect below so
  // a newly-learned duration doesn't retrigger that effect (and re-seek/re-play
  // whatever is already loaded); the reactive state itself drives the render-time
  // timestamp check above, which does need to react to it.
  const videoDurationsRef = useRef<Map<string, number>>(new Map());
  const queueEntryIdPrefix = useId();
  const nextQueueEntryId = useRef(0);

  const createQueueEntry = useCallback((track: Track): QueueEntry => ({
    ...track,
    queueEntryId: `${queueEntryIdPrefix}-${nextQueueEntryId.current++}`,
  }), [queueEntryIdPrefix]);

  const clearTimestampWarning = useCallback(() => setTimestampWarning(null), []);
  const clearSkipNotification = useCallback(() => setSkipNotification(null), []);

  // Adjust state while rendering (React's documented alternative to copying a
  // prop into state via an Effect): flag a too-long timestamp exactly once
  // per track, as soon as its video's real duration is known, instead of a
  // synchronous setState in the player-load effect below.
  const currentTrackKey = currentTrack?.performanceId ?? null;
  const [checkedTimestampKey, setCheckedTimestampKey] = useState<string | null>(null);
  if (currentTrack && currentTrackKey !== checkedTimestampKey) {
    const knownDuration = videoDurations.get(currentTrack.videoId);
    // getDuration() reports 0 until YouTube's metadata finishes loading, so a
    // cached 0 is not actually "known" yet — wait for a positive duration.
    if (knownDuration !== undefined && knownDuration > 0) {
      setCheckedTimestampKey(currentTrackKey);
      if (currentTrack.timestamp > 0 && currentTrack.timestamp >= knownDuration) {
        setTimestampWarning('時間戳可能有誤');
      }
    }
  }

  // Keep refs in sync with state
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { shuffleOnRef.current = shuffleOn; }, [shuffleOn]);
  useEffect(() => { allTracksRef.current = allTracks; }, [allTracks]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { videoDurationsRef.current = videoDurations; }, [videoDurations]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const setVolume = useCallback((n: number) => {
    const clamped = Math.max(0, Math.min(100, n));
    volumeStore.update(() => clamped);
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(clamped);
    }
    // Auto-unmute when dragging above 0 while muted
    if (clamped > 0 && isMutedRef.current) {
      mutedStore.update(() => false);
      if (playerRef.current && playerRef.current.unMute) {
        playerRef.current.unMute();
      }
    }
  }, [mutedStore, volumeStore]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMutedRef.current;
    mutedStore.update(() => newMuted);
    if (playerRef.current) {
      if (newMuted) {
        playerRef.current.mute?.();
      } else {
        playerRef.current.unMute?.();
      }
    }
  }, [mutedStore]);

  // Load the YouTube IFrame API on demand. Safe to call repeatedly — the
  // loader caches an in-flight/successful load and a failed load is retried
  // by the next call.
  const ensurePlayerApi = useCallback(() => {
    if (typeof window === 'undefined') return;
    loadYouTubeIframeApi(window, document)
      .then(() => {
        setApiLoadError(null);
        setIsPlayerReady(true);
      })
      .catch(() => {
        setApiLoadError('播放器載入失敗，請重新整理頁面');
        // Reset the optimistic isPlaying flip made by the caller — with the
        // API blocked, nothing is actually going to play.
        setIsPlaying(false);
      });
  }, []);

  // Advance to next non-deleted track in queue, skipping deleted ones.
  // Returns true if a non-deleted track was found and set as current, false if all remaining are deleted or queue is empty.
  const advanceSkippingDeleted = useCallback((currentQ: QueueEntry[], fromTrack: Track | null): boolean => {
    // Filter out deleted tracks
    let skippedAny = false;
    let remainingQueue = currentQ;
    while (remainingQueue.length > 0 && remainingQueue[0].deleted) {
      skippedAny = true;
      remainingQueue = remainingQueue.slice(1);
    }

    // If queue empty and repeat-all is on, re-populate from allTracks
    if (remainingQueue.length === 0 && repeatModeRef.current === 'all' && allTracksRef.current.length > 0) {
      const tracks = allTracksRef.current.filter(t => !t.deleted);
      if (tracks.length > 0) {
        const entries = tracks.map(createQueueEntry);
        remainingQueue = shuffleOnRef.current ? shuffleArray(entries) : entries;
      }
    }

    const playable = remainingQueue.filter(t => !t.deleted);

    if (playable.length === 0) {
      // Nothing playable
      if (skippedAny) {
        setSkipNotification('播放完畢');
      }
      setQueue([]);
      setIsPlaying(false);
      if (playerRef.current) {
        playerRef.current.pauseVideo();
      }
      return false;
    }

    // Covers the auto-advance/polling path landing before the idle prefetch
    // has run; idempotent, and its .catch resets isPlaying if it fails.
    ensurePlayerApi();

    // Shuffle: pick random track from playable queue; otherwise take first
    let pickIndex: number;
    if (shuffleOnRef.current) {
      pickIndex = Math.floor(Math.random() * playable.length);
    } else {
      pickIndex = 0;
    }
    const nextTrack = playable[pickIndex];

    // Remove picked track from remainingQueue (find first occurrence)
    const actualIndex = remainingQueue.indexOf(nextTrack);
    const newQueue = [...remainingQueue];
    newQueue.splice(actualIndex, 1);
    // Repeat-all: rotate the finished track to the end of the queue
    if (repeatModeRef.current === 'all' && fromTrack && !fromTrack.deleted) {
      newQueue.push(createQueueEntry(fromTrack));
    }
    setQueue(newQueue);

    if (fromTrack) {
      setPlayHistory(prev => [...prev, fromTrack].slice(-PLAY_HISTORY_LIMIT));
    }
    if (skippedAny) {
      setSkipNotification('已跳過無法播放的版本');
    }
    setCurrentTrack(nextTrack);
    // Optimistic: advancing is initiated here (a click, or the polling
    // effect's end-of-track check), not guessed inside the player-load
    // effect — onStateChange corrects it if playback doesn't actually start.
    setIsPlaying(true);
    timeStore.setTime(nextTrack.timestamp);
    return true;
  }, [createQueueEntry, ensurePlayerApi, timeStore]);

  // Prefetch the YouTube API once the browser is idle so the first play is
  // instant, without competing with the initial page load for connections.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(ensurePlayerApi, { timeout: 8000 });
    } else {
      timerId = setTimeout(ensurePlayerApi, 2500);
    }
    return () => {
      if (idleId !== null) w.cancelIdleCallback?.(idleId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [ensurePlayerApi]);

  useEffect(() => () => {
    playerRef.current?.destroy();
    playerRef.current = null;
  }, []);

  const updatePlaybackTime = useEffectEvent(() => {
    if (playerRef.current && playerRef.current.getCurrentTime) {
      const current = playerRef.current.getCurrentTime();
      timeStore.setTime(current);

      const track = currentTrackRef.current;
      // Check if reached end timestamp
      if (track?.endTimestamp && current >= track.endTimestamp) {
        // Repeat-one: loop back to start of current track
        if (repeatModeRef.current === 'one') {
          playerRef.current.seekTo(track.timestamp, true);
          return;
        }
        // Auto-play next song in queue if available, skipping deleted versions
        const freshQueue = queueRef.current;
        if (freshQueue.length > 0 || repeatModeRef.current === 'all') {
          advanceSkippingDeleted(freshQueue, currentTrackRef.current);
        } else {
          playerRef.current.pauseVideo();
          setIsPlaying(false);
        }
      }
    }
  });

  // React owns the polling timer's lifetime so pause and provider unmount
  // always stop it, including when YouTube callbacks arrive asynchronously.
  useEffect(() => {
    if (!isPlaying) return;
    const intervalId = window.setInterval(updatePlaybackTime, 500);
    return () => window.clearInterval(intervalId);
  }, [isPlaying]);

  // Initialize YouTube player when ready and track is available.
  // Reuses the existing player instance to preserve autoplay permission.
  useEffect(() => {
    if (!isPlayerReady || !currentTrack) return;

    const player = playerRef.current;

    // --- Reuse existing player ---
    if (player && loadedVideoIdRef.current) {
      if (currentTrack.videoId === loadedVideoIdRef.current) {
        // Same VOD — seek to the new timestamp. A too-long timestamp is
        // flagged reactively above from the cached video duration; onStateChange
        // (bound when this player was created) reports the resulting isPlaying
        // state once the seek's buffering settles, so neither needs a setState here.
        const videoDuration = player.getDuration?.() || 0;
        if (currentTrack.timestamp > 0 && videoDuration > 0 && currentTrack.timestamp >= videoDuration) {
          player.seekTo(0, true);
        } else {
          player.seekTo(currentTrack.timestamp, true);
        }
        player.setVolume(volumeRef.current);
        if (isMutedRef.current) { player.mute(); } else { player.unMute(); }
        player.playVideo();
        return;
      } else {
        // Different VOD — load new video without destroying the iframe.
        // onStateChange (bound when this player was created) reports the
        // resulting isPlaying state and duration once loadVideoById settles.
        // A too-long timestamp gets the same seekTo(0)-equivalent recovery as
        // the same-VOD branch above, but only when this video's duration is
        // already cached (we can't read it imperatively before it loads).
        loadedVideoIdRef.current = currentTrack.videoId;
        const knownDuration = videoDurationsRef.current.get(currentTrack.videoId);
        // A cached 0 means getDuration() hadn't loaded metadata yet when it was
        // recorded, not a genuinely known (zero-length) duration — ignore it.
        const startSeconds = knownDuration !== undefined
          && knownDuration > 0
          && currentTrack.timestamp > 0
          && currentTrack.timestamp >= knownDuration
          ? 0
          : currentTrack.timestamp;
        player.loadVideoById({
          videoId: currentTrack.videoId,
          startSeconds,
        });
        player.setVolume(volumeRef.current);
        if (isMutedRef.current) { player.mute(); } else { player.unMute(); }
        return;
      }
    }

    // --- First-time creation ---
    // Destroy any leftover player (shouldn't happen, but safety)
    if (player) {
      player.destroy();
      playerRef.current = null;
    }

    loadedVideoIdRef.current = currentTrack.videoId;
    playerRef.current = new window.YT!.Player(playerDivId, {
      height: '360',
      width: '640',
      videoId: currentTrack.videoId,
      playerVars: {
        start: currentTrack.timestamp,
        autoplay: 1,
        controls: 1,
        rel: 0,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
      events: {
        onReady: (event: YouTubeReadyEvent) => {
          const videoDuration = event.target.getDuration();
          timeStore.setDuration(videoDuration);
          // If the user picked a different track while this player was still
          // becoming ready, the reuse effect above has already moved it on
          // (loadedVideoIdRef.current + loadVideoById) — resolve which video
          // is actually loaded so the duration is attributed to it, not to
          // this callback's closed-over currentTrack.
          const readyVideoId = event.target.getVideoData?.()?.video_id ?? loadedVideoIdRef.current;
          // getDuration() can report 0 here if metadata hasn't loaded yet —
          // only cache a real duration (mirrors the d > 0 guard in onStateChange
          // below), so downstream consumers never treat 0 as "known".
          if (videoDuration > 0 && readyVideoId) {
            setVideoDurations(prev => new Map(prev).set(readyVideoId, videoDuration));
          }

          // Only run the closure-based seek recovery when this callback's
          // currentTrack is still the video that's actually loaded — otherwise
          // the reuse effect already positioned the newer video and this would
          // fight it with the stale track's timestamp.
          if (readyVideoId === currentTrack.videoId) {
            // Check if timestamp exceeds video length. The warning itself is owned
            // by the render-time check above (fires once videoDurations reflects a
            // real duration) — this only performs the seek-to-start recovery.
            if (currentTrack.timestamp > 0 && videoDuration > 0 && currentTrack.timestamp >= videoDuration) {
              event.target.seekTo(0, true);
            } else {
              event.target.seekTo(currentTrack.timestamp, true);
            }
          }

          // Apply saved volume/mute settings to newly created player
          event.target.setVolume(volumeRef.current);
          if (isMutedRef.current) {
            event.target.mute();
          } else {
            event.target.unMute();
          }

          event.target.playVideo();
          setIsPlaying(true);

          // The user pressed pause while the API was still loading (recorded
          // via isPlayingRef by togglePlayPause's early-return branch) —
          // autoplay above would otherwise override that intent. A transient
          // PLAYING event may still fire before the PAUSED event below settles
          // isPlaying back to false.
          if (!isPlayingRef.current) {
            event.target.pauseVideo?.();
          }
        },
        onStateChange: (event: YouTubePlayerEventWithData<number>) => {
          // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0
          if (event.data === 1) {
            setIsPlaying(true);
            // Update duration (needed after loadVideoById since onReady doesn't re-fire)
            const d = event.target.getDuration();
            if (d > 0) {
              timeStore.setDuration(d);
              // Resolve which video this event actually describes — same as
              // onReady above. A queued PLAYING event for the previous video
              // can be delivered after loadedVideoIdRef.current has already
              // moved on to the next one, which would otherwise cache the
              // old video's duration under the new video's id.
              const eventVideoId = event.target.getVideoData?.()?.video_id ?? loadedVideoIdRef.current;
              if (eventVideoId) {
                setVideoDurations(prev => (prev.get(eventVideoId) === d ? prev : new Map(prev).set(eventVideoId, d)));
              }
            }
          } else if (event.data === 2) {
            setIsPlaying(false);
          } else if (event.data === 0) {
            // Video ended — repeat-one: seek back and replay
            if (repeatModeRef.current === 'one' && currentTrackRef.current) {
              playerRef.current?.seekTo(currentTrackRef.current.timestamp, true);
              playerRef.current?.playVideo();
              return;
            }
            // Auto-play next in queue, skipping deleted versions
            const freshQueue = queueRef.current;
            if (freshQueue.length > 0 || repeatModeRef.current === 'all') {
              advanceSkippingDeleted(freshQueue, currentTrackRef.current);
            } else {
              setIsPlaying(false);
            }
          }
        },
        onError: (event: YouTubePlayerEventWithData<number>) => {
          // YouTube error codes:
          // 2: Invalid parameter
          // 5: HTML5 player error
          // 100: Video not found / removed
          // 101: Video not allowed in embedded players
          // 150: Same as 101 (owner restricted embedding)
          const errorVideoId = loadedVideoIdRef.current;
          if ([100, 101, 150].includes(event.data) && errorVideoId) {
            setErroredVideoId(errorVideoId);
            setUnavailableVideoIds(prev => new Set([...prev, errorVideoId]));
          }
        },
      },
    });
  // YouTube event callbacks read mutable playback state through refs.
  }, [isPlayerReady, currentTrack, timeStore, advanceSkippingDeleted]);

  const toggleRepeat = useCallback(() => {
    setRepeatMode(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleOn(prev => !prev);
  }, []);

  const addToAllTracks = useCallback((track: Track) => {
    setAllTracks(prev => prev.some(t => t.performanceId === track.performanceId) ? prev : [...prev, track]);
  }, []);

  // Play a track and REPLACE the whole queue with `following` — clicking a song
  // in any list establishes that list as the new playback context (Spotify-style).
  // Reads currentTrackRef (not state) so stale closures held by memoized list
  // rows can still call it safely.
  const playTrackWithQueue = useCallback((track: Track, following: Track[]) => {
    // Covers fast clicks that land before the idle prefetch has run
    ensurePlayerApi();
    const prevTrack = currentTrackRef.current;
    if (prevTrack && prevTrack.performanceId !== track.performanceId) {
      setPlayHistory((prev) => [...prev, prevTrack].slice(-PLAY_HISTORY_LIMIT));
    }
    setCurrentTrack(track);
    // Optimistic: this is the user's own click, not a guess made from an
    // effect — the player-load effect's onStateChange corrects it if playback
    // doesn't actually start.
    setIsPlaying(true);
    timeStore.setTime(track.timestamp);
    setQueue(following.map(createQueueEntry));
    setAllTracks((prev) => {
      const seen = new Set(prev.map((t) => t.performanceId));
      const merged = [...prev];
      for (const t of [track, ...following]) {
        if (!seen.has(t.performanceId)) {
          seen.add(t.performanceId);
          merged.push(t);
        }
      }
      return merged.length === prev.length ? prev : merged;
    });
  }, [createQueueEntry, ensurePlayerApi, timeStore]);

  const togglePlayPause = useCallback(() => {
    if (!playerRef.current) {
      // The iframe API hasn't finished loading yet — still flip the intent so
      // the control responds, and so onReady can honor a pause once ready.
      setIsPlaying((prev) => !prev);
      return;
    }

    if (isPlaying) {
      playerRef.current.pauseVideo();
      setIsPlaying(false);
    } else {
      playerRef.current.playVideo();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const seekTo = useCallback((seconds: number) => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(seconds, true);
    timeStore.setTime(seconds);
  }, [timeStore]);

  const previous = useCallback(() => {
    if (!currentTrack) return;

    const timePlayed = timeStore.getSnapshot().currentTime - currentTrack.timestamp;

    if (timePlayed > 3) {
      // Restart current song
      seekTo(currentTrack.timestamp);
    } else {
      // Go to previous song in history
      if (playHistory.length > 0) {
        // Idempotent; its .catch resets isPlaying if the API isn't available.
        ensurePlayerApi();
        const prevTrack = playHistory[playHistory.length - 1];
        setPlayHistory((prev) => prev.slice(0, -1));
        setCurrentTrack(prevTrack);
        // Optimistic: the user's own click, not a guess made from an effect —
        // onStateChange corrects it if playback doesn't actually start.
        setIsPlaying(true);
        timeStore.setTime(prevTrack.timestamp);
      }
    }
  }, [currentTrack, ensurePlayerApi, playHistory, seekTo, timeStore]);

  const next = useCallback(() => {
    // User pressed next — always advance (ignore repeat-one)
    if (queue.length > 0 || repeatMode === 'all') {
      advanceSkippingDeleted(queue, currentTrack);
    } else {
      // No queue, stop playback. Reset the intent unconditionally: a Next
      // pressed while the iframe API is still loading has no player yet, and
      // a lingering optimistic isPlaying would make onReady start the track.
      setIsPlaying(false);
      playerRef.current?.pauseVideo();
    }
  }, [advanceSkippingDeleted, currentTrack, queue, repeatMode]);

  const addToQueue = useCallback((track: Track) => {
    const entry = createQueueEntry(track);
    setQueue(prev => [...prev, entry]);
    addToAllTracks(track);
  }, [addToAllTracks, createQueueEntry]);

  const removeFromQueue = useCallback((index: number) => {
    setQueue(prev => prev.filter((_, i) => i !== index));
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueue(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
  }, []);

  return useMemo<PlayerContextType>(() => ({
    currentTrack,
    isPlaying,
    isPlayerReady,
    playerError,
    apiLoadError,
    unavailableVideoIds,
    timestampWarning,
    clearTimestampWarning,
    skipNotification,
    clearSkipNotification,
    timeStore,
    playTrackWithQueue,
    togglePlayPause,
    seekTo,
    previous,
    next,
    showModal,
    setShowModal,
    queue,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    showQueue,
    setShowQueue,
    repeatMode,
    shuffleOn,
    toggleRepeat,
    toggleShuffle,
    volume,
    isMuted,
    setVolume,
    toggleMute,
  }), [
    currentTrack,
    isPlaying,
    isPlayerReady,
    playerError,
    apiLoadError,
    unavailableVideoIds,
    timestampWarning,
    clearTimestampWarning,
    skipNotification,
    clearSkipNotification,
    timeStore,
    playTrackWithQueue,
    togglePlayPause,
    seekTo,
    previous,
    next,
    showModal,
    setShowModal,
    queue,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    showQueue,
    setShowQueue,
    repeatMode,
    shuffleOn,
    toggleRepeat,
    toggleShuffle,
    volume,
    isMuted,
    setVolume,
    toggleMute,
  ]);
}

export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const value = usePlayerController();
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

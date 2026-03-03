'use client';

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';

export interface Track {
  id: string;
  songId: string;
  title: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  deleted?: boolean;
  albumArtUrl?: string;
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
  currentTime: number;
  duration: number;
  trackCurrentTime: number;
  trackDuration: number | null;
  playTrack: (track: Track) => void;
  togglePlayPause: () => void;
  seekTo: (seconds: number) => void;
  previous: () => void;
  next: () => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  queue: Track[];
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

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [apiLoadError, setApiLoadError] = useState<string | null>(null);
  const [unavailableVideoIds, setUnavailableVideoIds] = useState<Set<string>>(new Set());
  const [timestampWarning, setTimestampWarning] = useState<string | null>(null);
  const [skipNotification, setSkipNotification] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [playHistory, setPlayHistory] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [shuffleOn, setShuffleOn] = useState(false);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [volume, setVolumeState] = useState(75);
  const [isMuted, setIsMuted] = useState(false);

  // Derived track-relative time values (never fall back to full VOD duration)
  const trackCurrentTime = currentTrack
    ? Math.max(0, currentTime - currentTrack.timestamp)
    : 0;
  const trackDuration = currentTrack?.endTimestamp != null
    ? currentTrack.endTimestamp - currentTrack.timestamp
    : null;

  const playerRef = useRef<any>(null);
  const playerDivId = 'youtube-player';
  const timeUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const apiLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Refs to always have fresh values in async callbacks
  const queueRef = useRef<Track[]>([]);
  const currentTrackRef = useRef<Track | null>(null);
  const repeatModeRef = useRef<RepeatMode>('off');
  const shuffleOnRef = useRef(false);
  const allTracksRef = useRef<Track[]>([]);
  const volumeRef = useRef(75);
  const isMutedRef = useRef(false);

  const clearTimestampWarning = () => setTimestampWarning(null);
  const clearSkipNotification = () => setSkipNotification(null);

  // Keep refs in sync with state
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { shuffleOnRef.current = shuffleOn; }, [shuffleOn]);
  useEffect(() => { allTracksRef.current = allTracks; }, [allTracks]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Load volume/mute from localStorage on mount (SSR-safe)
  useEffect(() => {
    try {
      const savedVolume = localStorage.getItem('mizuki-volume');
      const savedMuted = localStorage.getItem('mizuki-muted');
      if (savedVolume !== null) {
        const v = Number(savedVolume);
        if (!isNaN(v) && v >= 0 && v <= 100) {
          setVolumeState(v);
          volumeRef.current = v;
        }
      }
      if (savedMuted !== null) {
        const m = savedMuted === 'true';
        setIsMuted(m);
        isMutedRef.current = m;
      }
    } catch {
      // localStorage unavailable — use session defaults
    }
  }, []);

  const setVolume = (n: number) => {
    const clamped = Math.max(0, Math.min(100, n));
    setVolumeState(clamped);
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(clamped);
    }
    // Auto-unmute when dragging above 0 while muted
    if (clamped > 0 && isMutedRef.current) {
      setIsMuted(false);
      if (playerRef.current && playerRef.current.unMute) {
        playerRef.current.unMute();
      }
      try { localStorage.setItem('mizuki-muted', 'false'); } catch {}
    }
    try { localStorage.setItem('mizuki-volume', String(clamped)); } catch {}
  };

  const toggleMute = () => {
    const newMuted = !isMutedRef.current;
    setIsMuted(newMuted);
    if (playerRef.current) {
      if (newMuted) {
        playerRef.current.mute?.();
      } else {
        playerRef.current.unMute?.();
      }
    }
    try { localStorage.setItem('mizuki-muted', String(newMuted)); } catch {}
  };

  // Advance to next non-deleted track in queue, skipping deleted ones.
  // Returns true if a non-deleted track was found and set as current, false if all remaining are deleted or queue is empty.
  const advanceSkippingDeleted = (currentQ: Track[], fromTrack: Track | null): boolean => {
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
        remainingQueue = shuffleOnRef.current ? shuffleArray(tracks) : [...tracks];
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
      newQueue.push(fromTrack);
    }
    setQueue(newQueue);

    if (fromTrack) {
      setPlayHistory(prev => [...prev, fromTrack]);
    }
    if (skippedAny) {
      setSkipNotification('已跳過無法播放的版本');
    }
    setCurrentTrack(nextTrack);
    setCurrentTime(nextTrack.timestamp);
    return true;
  };

  // Load YouTube IFrame API
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.YT && window.YT.Player) {
      setIsPlayerReady(true);
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // Set timeout for API load failure (10 seconds)
    apiLoadTimeoutRef.current = setTimeout(() => {
      if (!window.YT || !window.YT.Player) {
        setApiLoadError('播放器載入失敗，請重新整理頁面');
      }
    }, 10000);

    window.onYouTubeIframeAPIReady = () => {
      if (apiLoadTimeoutRef.current) {
        clearTimeout(apiLoadTimeoutRef.current);
        apiLoadTimeoutRef.current = null;
      }
      setIsPlayerReady(true);
    };

    // Handle script load error
    tag.onerror = () => {
      if (apiLoadTimeoutRef.current) {
        clearTimeout(apiLoadTimeoutRef.current);
        apiLoadTimeoutRef.current = null;
      }
      setApiLoadError('播放器載入失敗，請重新整理頁面');
    };

    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
      }
      if (apiLoadTimeoutRef.current) {
        clearTimeout(apiLoadTimeoutRef.current);
      }
    };
  }, []);

  // Start (or restart) the time-update polling interval.
  // Uses refs so the callback always sees fresh track/queue state.
  const startTimeUpdateInterval = () => {
    if (timeUpdateIntervalRef.current) {
      clearInterval(timeUpdateIntervalRef.current);
    }
    timeUpdateIntervalRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        const current = playerRef.current.getCurrentTime();
        setCurrentTime(current);

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
            if (timeUpdateIntervalRef.current) {
              clearInterval(timeUpdateIntervalRef.current);
            }
          }
        }
      }
    }, 500);
  };

  // Initialize YouTube player when ready and track is available.
  // Reuses the existing player instance to preserve autoplay permission.
  useEffect(() => {
    if (!isPlayerReady || !currentTrack) return;

    // Clear previous errors when starting new track
    setPlayerError(null);

    const player = playerRef.current;

    // --- Reuse existing player ---
    if (player && loadedVideoIdRef.current) {
      if (currentTrack.videoId === loadedVideoIdRef.current) {
        // Same VOD — just seek to the new timestamp
        const videoDuration = player.getDuration?.() || 0;
        if (currentTrack.timestamp > 0 && videoDuration > 0 && currentTrack.timestamp >= videoDuration) {
          player.seekTo(0, true);
          setTimestampWarning('時間戳可能有誤');
        } else {
          player.seekTo(currentTrack.timestamp, true);
        }
        player.setVolume(volumeRef.current);
        if (isMutedRef.current) { player.mute(); } else { player.unMute(); }
        player.playVideo();
        setIsPlaying(true);
        startTimeUpdateInterval();
        return;
      } else {
        // Different VOD — load new video without destroying the iframe
        loadedVideoIdRef.current = currentTrack.videoId;
        player.loadVideoById({
          videoId: currentTrack.videoId,
          startSeconds: currentTrack.timestamp,
        });
        player.setVolume(volumeRef.current);
        if (isMutedRef.current) { player.mute(); } else { player.unMute(); }
        setIsPlaying(true);
        startTimeUpdateInterval();
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
    playerRef.current = new window.YT.Player(playerDivId, {
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
        onReady: (event: any) => {
          const videoDuration = event.target.getDuration();
          setDuration(videoDuration);

          // Check if timestamp exceeds video length
          if (currentTrack.timestamp > 0 && videoDuration > 0 && currentTrack.timestamp >= videoDuration) {
            event.target.seekTo(0, true);
            setTimestampWarning('時間戳可能有誤');
          } else {
            event.target.seekTo(currentTrack.timestamp, true);
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
          startTimeUpdateInterval();
        },
        onStateChange: (event: any) => {
          // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0
          if (event.data === 1) {
            setIsPlaying(true);
            // Update duration (needed after loadVideoById since onReady doesn't re-fire)
            const d = event.target.getDuration?.();
            if (d > 0) setDuration(d);
          } else if (event.data === 2) {
            setIsPlaying(false);
          } else if (event.data === 0) {
            // Video ended — repeat-one: seek back and replay
            if (repeatModeRef.current === 'one' && currentTrackRef.current) {
              playerRef.current.seekTo(currentTrackRef.current.timestamp, true);
              playerRef.current.playVideo();
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
        onError: (event: any) => {
          // YouTube error codes:
          // 2: Invalid parameter
          // 5: HTML5 player error
          // 100: Video not found / removed
          // 101: Video not allowed in embedded players
          // 150: Same as 101 (owner restricted embedding)
          const errorVideoId = loadedVideoIdRef.current;
          if ([100, 101, 150].includes(event.data) && errorVideoId) {
            setPlayerError('此影片已無法播放');
            setUnavailableVideoIds(prev => new Set([...prev, errorVideoId]));
          }
        },
      },
    });
  }, [isPlayerReady, currentTrack]);

  const toggleRepeat = () => {
    setRepeatMode(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
  };

  const toggleShuffle = () => {
    setShuffleOn(prev => !prev);
  };

  const addToAllTracks = (track: Track) => {
    setAllTracks(prev => prev.some(t => t.id === track.id) ? prev : [...prev, track]);
  };

  const playTrack = (track: Track) => {
    // Add current track to history before switching
    if (currentTrack && currentTrack.id !== track.id) {
      setPlayHistory((prev) => [...prev, currentTrack]);
    }
    setCurrentTrack(track);
    setCurrentTime(track.timestamp);
    addToAllTracks(track);
  };

  const togglePlayPause = () => {
    if (!playerRef.current) return;

    if (isPlaying) {
      playerRef.current.pauseVideo();
      setIsPlaying(false);
    } else {
      playerRef.current.playVideo();
      setIsPlaying(true);
    }
  };

  const seekTo = (seconds: number) => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(seconds, true);
    setCurrentTime(seconds);
  };

  const previous = () => {
    if (!currentTrack) return;

    const timePlayed = currentTime - currentTrack.timestamp;

    if (timePlayed > 3) {
      // Restart current song
      seekTo(currentTrack.timestamp);
    } else {
      // Go to previous song in history
      if (playHistory.length > 0) {
        const prevTrack = playHistory[playHistory.length - 1];
        setPlayHistory((prev) => prev.slice(0, -1));
        setCurrentTrack(prevTrack);
        setCurrentTime(prevTrack.timestamp);
      }
    }
  };

  const next = () => {
    // User pressed next — always advance (ignore repeat-one)
    if (queue.length > 0 || repeatMode === 'all') {
      advanceSkippingDeleted(queue, currentTrack);
    } else {
      // No queue, stop playback
      if (playerRef.current) {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      }
    }
  };

  const addToQueue = (track: Track) => {
    setQueue(prev => [...prev, track]);
    addToAllTracks(track);
  };

  const removeFromQueue = (index: number) => {
    setQueue(prev => prev.filter((_, i) => i !== index));
  };

  const reorderQueue = (fromIndex: number, toIndex: number) => {
    setQueue(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
  };

  return (
    <PlayerContext.Provider
      value={{
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
        currentTime,
        duration,
        trackCurrentTime,
        trackDuration,
        playTrack,
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
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

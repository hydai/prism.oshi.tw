'use client';
/* Preview harness for /design-sync. Wraps every preview card (cfg.provider) in
   the app's REAL context providers, seeded with realistic mock data so the
   player/playlist/liked/recently-played components render populated instead of
   empty. Not part of the app — committed as a sync input, merged into the
   bundle via cfg.extraEntries so PreviewProvider shares the same context module
   instances the components consume. */
import { useEffect, useState, type ReactNode } from 'react';
import { StreamerProvider } from '../app/contexts/StreamerContext';
import { PlayerProvider, usePlayer, type Track } from '../app/contexts/PlayerContext';
import { PlaylistProvider } from '../app/contexts/PlaylistContext';
import { LikedSongsProvider } from '../app/contexts/LikedSongsContext';
import { RecentlyPlayedProvider } from '../app/contexts/RecentlyPlayedContext';

const SLUG = 'demo';

// A small realistic karaoke repertoire (title / original artist / length sec).
const SONGS = [
  { title: '夜に駆ける', artist: 'YOASOBI', videoId: 'prevVIDaa01', len: 261 },
  { title: '廻廻奇譚', artist: 'Eve', videoId: 'prevVIDaa02', len: 213 },
  { title: '命に嫌われている。', artist: 'カンザキイオリ', videoId: 'prevVIDaa03', len: 315 },
  { title: 'KING', artist: 'Kanaria', videoId: 'prevVIDaa04', len: 198 },
  { title: '白日', artist: 'King Gnu', videoId: 'prevVIDaa05', len: 286 },
  { title: '花に亡霊', artist: 'ヨルシカ', videoId: 'prevVIDaa06', len: 242 },
];

const trackFor = (i: number, ts: number): Track => ({
  id: `perf-${i}`,
  songId: `song-${i}`,
  title: SONGS[i].title,
  originalArtist: SONGS[i].artist,
  videoId: SONGS[i].videoId,
  timestamp: ts,
  endTimestamp: ts + SONGS[i].len,
  streamerSlug: SLUG,
});

const MOCK_TRACK = trackFor(0, 372);
const MOCK_QUEUE: Track[] = [1, 2, 3, 4, 5].map((i) => trackFor(i, 100 * i));

const versionFor = (i: number) => ({
  performanceId: `perf-${i}`,
  songTitle: SONGS[i].title,
  originalArtist: SONGS[i].artist,
  videoId: SONGS[i].videoId,
  timestamp: 100 * (i + 1),
  endTimestamp: 100 * (i + 1) + SONGS[i].len,
  streamerSlug: SLUG,
});

const MOCK_PLAYLISTS = [
  { id: 'pl-1', name: 'お気に入り', versions: [versionFor(0), versionFor(2), versionFor(4)], createdAt: 1000, updatedAt: 2000 },
  { id: 'pl-2', name: '作業用BGM', versions: [versionFor(1), versionFor(3), versionFor(5), versionFor(0)], createdAt: 1000, updatedAt: 2000 },
];

const MOCK_LIKED = [0, 2, 4, 5].map((i, n) => ({
  performanceId: `perf-${i}`,
  songTitle: SONGS[i].title,
  originalArtist: SONGS[i].artist,
  videoId: SONGS[i].videoId,
  timestamp: 100 * (i + 1),
  endTimestamp: 100 * (i + 1) + SONGS[i].len,
  // Relative to render-time now (component reads the same clock) → stable,
  // realistic "N hours ago" labels across syncs.
  likedAt: Date.now() - (n + 1) * 3_600_000,
}));

const MOCK_RECENT = [1, 3, 0, 5].map((i, n) => ({
  performanceId: `perf-${i}`,
  songTitle: SONGS[i].title,
  originalArtist: SONGS[i].artist,
  videoId: SONGS[i].videoId,
  timestamp: 100 * (i + 1),
  endTimestamp: 100 * (i + 1) + SONGS[i].len,
  // 30-min steps from render-time now → "30 分鐘前 / 1 小時前 / …".
  playedAt: Date.now() - (n + 1) * 1_800_000,
}));

const AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F472B6"/><stop offset="1" stop-color="#60A5FA"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(#g)"/></svg>',
  );

const MOCK_STREAMER = {
  slug: SLUG,
  displayName: 'Prism Demo',
  description: 'カラオケアーカイブ · demo streamer for the design system',
  avatarUrl: AVATAR,
  brandName: 'Prism',
  subscriberCount: '128K',
  group: 'Prism',
  socialLinks: { youtube: 'https://youtube.com/@prism', twitter: 'https://x.com/prism' },
  theme: {
    accentPrimary: '#EC4899',
    accentPrimaryDark: '#DB2777',
    accentPrimaryLight: '#F472B6',
    accentSecondary: '#3B82F6',
    accentSecondaryLight: '#60A5FA',
    bgPageStart: '#FFF0F5',
    bgPageMid: '#F0F8FF',
    bgPageEnd: '#E6E6FA',
    bgAccentPrimary: '#FDF2F8',
    bgAccentPrimaryMuted: '#FCE7F3',
    borderAccentPrimary: '#FBCFE8',
    borderAccentSecondary: '#BFDBFE',
  },
  enabled: true,
};

// Seed localStorage BEFORE the child providers' mount effects read it.
function seedStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem('prism_volume', '70');
    localStorage.setItem('prism_muted', 'false');
    localStorage.setItem(`prism_${SLUG}_playlists`, JSON.stringify(MOCK_PLAYLISTS));
    localStorage.setItem(`prism_${SLUG}_liked_songs`, JSON.stringify(MOCK_LIKED));
    localStorage.setItem(`prism_${SLUG}_recently_played`, JSON.stringify(MOCK_RECENT));
  } catch {
    /* storage unavailable — providers fall back to empty */
  }
}

// Deterministic no-op YouTube player: presence of window.YT makes PlayerProvider
// skip injecting the real iframe API script, and the no-op player means seeding
// a track never throws or performs real playback.
function installYouTubeStub() {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
  if (!w || w.YT) return;
  const noop = () => {};
  function Player() {
    return {
      playVideo: noop,
      pauseVideo: noop,
      seekTo: noop,
      setVolume: noop,
      getVolume: () => 70,
      mute: noop,
      unMute: noop,
      isMuted: () => false,
      getDuration: () => 0,
      getCurrentTime: () => 0,
      loadVideoById: noop,
      cueVideoById: noop,
      destroy: noop,
      getPlayerState: () => -1,
    };
  }
  w.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
}

// Populates PlayerContext (in-memory, not localStorage) once mounted.
function Seeder({ children }: { children: ReactNode }) {
  const player = usePlayer();
  useEffect(() => {
    try {
      player.playTrackWithQueue(MOCK_TRACK, MOCK_QUEUE);
      player.setShowQueue(true);
      player.setShowModal(true);
    } catch {
      /* a component that doesn't need the player still renders */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

export function PreviewProvider({ children }: { children: ReactNode }) {
  // useState initializer runs during THIS render, before child providers mount,
  // so storage + YT stub are ready when their mount effects fire.
  useState(() => {
    installYouTubeStub();
    seedStorage();
    return null;
  });
  return (
    <StreamerProvider config={MOCK_STREAMER as never}>
      <PlayerProvider>
        <PlaylistProvider streamerSlug={SLUG}>
          <LikedSongsProvider streamerSlug={SLUG}>
            <RecentlyPlayedProvider streamerSlug={SLUG}>
              <Seeder>{children}</Seeder>
            </RecentlyPlayedProvider>
          </LikedSongsProvider>
        </PlaylistProvider>
      </PlayerProvider>
    </StreamerProvider>
  );
}

'use client';

import { PlayerProvider } from '../contexts/PlayerContext';
import { PlaylistProvider } from '../contexts/PlaylistContext';
import { LikedSongsProvider } from '../contexts/LikedSongsContext';
import { RecentlyPlayedProvider } from '../contexts/RecentlyPlayedContext';
import { FanAuthProvider } from '../contexts/FanAuthContext';
import MiniPlayer from './MiniPlayer';
import NowPlayingModal from './NowPlayingModal';
import YouTubePlayerContainer from './YouTubePlayerContainer';
import QueuePanel from './QueuePanel';
import RecentlyPlayedTracker from './RecentlyPlayedTracker';
import { ReactNode } from 'react';

export default function PlayerWrapper({ streamerSlug, children }: { streamerSlug: string; children: ReactNode }) {
  return (
    <FanAuthProvider>
      <PlayerProvider streamerSlug={streamerSlug}>
        <PlaylistProvider streamerSlug={streamerSlug}>
          <LikedSongsProvider streamerSlug={streamerSlug}>
            <RecentlyPlayedProvider streamerSlug={streamerSlug}>
              {children}
              <MiniPlayer />
              <NowPlayingModal />
              <YouTubePlayerContainer />
              <QueuePanel />
              <RecentlyPlayedTracker />
            </RecentlyPlayedProvider>
          </LikedSongsProvider>
        </PlaylistProvider>
      </PlayerProvider>
    </FanAuthProvider>
  );
}

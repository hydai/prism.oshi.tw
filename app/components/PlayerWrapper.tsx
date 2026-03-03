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

export default function PlayerWrapper({ children }: { children: ReactNode }) {
  return (
    <FanAuthProvider>
      <PlayerProvider>
        <PlaylistProvider>
          <LikedSongsProvider>
            <RecentlyPlayedProvider>
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

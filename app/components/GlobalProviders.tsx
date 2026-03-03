'use client';

import { ReactNode } from 'react';
import { FanAuthProvider } from '../contexts/FanAuthContext';
import { PlayerProvider } from '../contexts/PlayerContext';
import { PlaylistProvider } from '../contexts/PlaylistContext';
import MiniPlayer from './MiniPlayer';
import NowPlayingModal from './NowPlayingModal';
import YouTubePlayerContainer from './YouTubePlayerContainer';
import QueuePanel from './QueuePanel';
import RecentlyPlayedTracker from './RecentlyPlayedTracker';

export default function GlobalProviders({ children }: { children: ReactNode }) {
  return (
    <FanAuthProvider>
      <PlayerProvider>
        <PlaylistProvider>
          {children}
          <MiniPlayer />
          <NowPlayingModal />
          <YouTubePlayerContainer />
          <QueuePanel />
          <RecentlyPlayedTracker />
        </PlaylistProvider>
      </PlayerProvider>
    </FanAuthProvider>
  );
}

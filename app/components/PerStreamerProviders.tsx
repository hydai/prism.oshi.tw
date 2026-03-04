'use client';

import { ReactNode } from 'react';
import { PlaylistProvider } from '../contexts/PlaylistContext';
import { LikedSongsProvider } from '../contexts/LikedSongsContext';
import { RecentlyPlayedProvider } from '../contexts/RecentlyPlayedContext';

export default function PerStreamerProviders({
  streamerSlug,
  children,
}: {
  streamerSlug: string;
  children: ReactNode;
}) {
  return (
    <PlaylistProvider streamerSlug={streamerSlug}>
      <LikedSongsProvider streamerSlug={streamerSlug}>
        <RecentlyPlayedProvider streamerSlug={streamerSlug}>
          {children}
        </RecentlyPlayedProvider>
      </LikedSongsProvider>
    </PlaylistProvider>
  );
}

'use client';

import { ReactNode } from 'react';
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
    <LikedSongsProvider streamerSlug={streamerSlug}>
      <RecentlyPlayedProvider streamerSlug={streamerSlug}>
        {children}
      </RecentlyPlayedProvider>
    </LikedSongsProvider>
  );
}

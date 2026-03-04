export interface Performance {
  id: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
}

export interface Song {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: Performance[];
}

export interface Stream {
  id: string;
  title: string;
  date: string;
  videoId: string;
  youtubeUrl: string;
}

export interface SongMetadata {
  songId: string;
  fetchStatus: 'matched' | 'no_match' | 'error' | 'manual';
  matchConfidence: 'exact' | 'fuzzy' | 'manual' | null;
  albumArtUrl?: string;
  albumArtUrls?: {
    small: string;
    medium: string;
    big: string;
    xl: string;
  };
  albumTitle?: string;
  deezerTrackId?: number;    // Legacy (Deezer matches)
  deezerArtistId?: number;   // Legacy (Deezer matches)
  itunesTrackId?: number;
  itunesCollectionId?: number;
  trackDuration?: number;
  fetchedAt: string;
  lastError?: string;
}

export interface ArtistInfo {
  normalizedArtist: string;
  originalName: string;
  deezerArtistId?: number;   // Legacy (Deezer matches)
  itunesArtistId?: number;
  pictureUrls?: {
    medium: string;
    big: string;
    xl: string;
  };
  fetchedAt: string;
}

// --- Multi-streamer types ---

export interface StreamerTheme {
  accentPrimary: string;
  accentPrimaryDark: string;
  accentPrimaryLight: string;
  accentSecondary: string;
  accentSecondaryLight: string;
  bgPageStart: string;
  bgPageMid: string;
  bgPageEnd: string;
  bgAccentPrimary: string;
  bgAccentPrimaryMuted: string;
  borderAccentPrimary: string;
  borderAccentSecondary: string;
}

export interface StreamerConfig {
  slug: string;
  displayName: string;
  description: string;
  avatarUrl: string;
  brandName: string;
  subscriberCount: string;
  group: string;
  socialLinks: Record<string, string>;
  externalUrl?: string;
  theme: StreamerTheme;
  enabled: boolean;
}

export interface Registry {
  version: number;
  streamers: StreamerConfig[];
}

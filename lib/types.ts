import type { SocialProvider } from './social-providers';

// Stored (exported) performance — `date` and `streamTitle` are intentionally
// absent: the fan site derives both from the stream record (join by streamId)
// at load time. See app/lib/archive-loader.ts hydrateSongs().
export interface Performance {
  id: string;
  streamId: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  /** Present only when non-empty */
  note?: string;
}

export interface Song {
  id: string;
  /** Cross-streamer composition identity. Older static exports may omit it. */
  workId?: string;
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

/** The fan site's name for a social provider; the list itself lives in ./social-providers. */
export type SocialLinkKey = SocialProvider;
export type SocialLinks = Partial<Record<SocialLinkKey, string>>;

export interface StreamerConfig {
  slug: string;
  displayName: string;
  description: string;
  avatarUrl: string;
  brandName: string;
  subscriberCount: string;
  group: string;
  socialLinks: SocialLinks;
  externalUrl?: string;
  theme: StreamerTheme;
  enabled: boolean;
}

export interface Registry {
  version: number;
  streamers: StreamerConfig[];
}

export const VOD_EXPORT_SCHEMA_VERSION = '1.0.0' as const;
export const VOD_EXPORT_MAJOR = 1 as const;

export const VOD_EXPORT_PUBLIC_ORIGIN = 'https://data.oshi.tw' as const;
export const VOD_EXPORT_MANIFEST_KEY = 'vod/v1/manifest.json' as const;
export const VOD_EXPORT_SNAPSHOT_PREFIX = 'vod/v1/snapshots/' as const;

export const VOD_EXPORT_CONTENT_TYPE = 'application/json; charset=utf-8' as const;
export const VOD_EXPORT_SNAPSHOT_CACHE_CONTROL = 'public, max-age=31536000, immutable' as const;
export const VOD_EXPORT_MANIFEST_CACHE_CONTROL = 'public, max-age=60, stale-if-error=86400' as const;

export const VOD_EXPORT_LIMITS = {
  sourceRows: 150_000,
  streamers: 500,
  vods: 10_000,
  performances: 50_000,
  snapshotBytes: 10_485_760,
  sourceTextBytes: 16_777_216,
  findings: 5_000,
  findingsBytes: 4_194_304,
} as const;

export const VOD_EXPORT_CAPACITY_WARNING_RATIO = 0.8;

export const SOCIAL_PROVIDERS = [
  'youtube',
  'twitter',
  'facebook',
  'instagram',
  'twitch',
] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

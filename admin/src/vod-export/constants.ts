export const VOD_EXPORT_SCHEMA_VERSION = '1.0.0' as const;
export const VOD_EXPORT_MAJOR = 1 as const;

export const VOD_EXPORT_PUBLIC_ORIGIN = 'https://data.oshi.tw' as const;
export const VOD_EXPORT_MANIFEST_KEY = 'vod/v1/manifest.json' as const;
export const VOD_EXPORT_SNAPSHOT_PREFIX = 'vod/v1/snapshots/' as const;

export const VOD_EXPORT_CONTENT_TYPE = 'application/json; charset=utf-8' as const;
export const VOD_EXPORT_SNAPSHOT_CACHE_CONTROL = 'public, max-age=31536000, immutable' as const;
export const VOD_EXPORT_MANIFEST_CACHE_CONTROL = 'public, max-age=60, stale-if-error=86400' as const;

/**
 * D1 rejects an individual bound value above 2,000,000 bytes. Every multi-value
 * query binds one JSON array consumed by `json_each`, so its serialized length —
 * JSON escaping included — must stay under this margin. Bounded inputs (at most
 * 500 streamer slugs, 5,000 finding-derived IDs) keep ordinary payloads far
 * below it; anything larger is refused, never split.
 */
export const D1_JSON_BINDING_MAX_BYTES = 1_900_000;

export const VOD_EXPORT_LIMITS = {
  sourceRows: 150_000,
  streamers: 500,
  vods: 10_000,
  performances: 50_000,
  snapshotBytes: 10_485_760,
  sourceTextBytes: 16_777_216,
  findings: 5_000,
  findingsBytes: 4_194_304,
  d1JsonBindingBytes: D1_JSON_BINDING_MAX_BYTES,
} as const;

export const VOD_EXPORT_CAPACITY_WARNING_RATIO = 0.8;

// The export's social providers ARE the site's social providers — re-exported
// under the names this module's importers already use. The canonical JSON emits
// socialLinks in this array's order, so the list must never fork from lib/.
export { SOCIAL_PROVIDERS } from '../../../lib/social-providers';
export type { SocialProvider } from '../../../lib/social-providers';

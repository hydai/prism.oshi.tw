/**
 * The VOD export shapes that cross the wire: the worker builds and serializes
 * them, the Admin UI reads and renders them. They are declared once, here, so
 * the UI can never quietly loosen a guarantee the worker makes — a finding's
 * code, its entity type and its details are exactly what validation produced.
 */

export type FindingSeverity = 'error' | 'warning';

export type FindingEntityType = 'streamer' | 'vod' | 'song' | 'performance';

export type FindingCode =
  | 'MISSING_STREAMER_SLUG'
  | 'INVALID_STREAMER_SLUG'
  | 'DUPLICATE_STREAMER_SLUG'
  | 'MISSING_DISPLAY_NAME'
  | 'MISSING_YOUTUBE_CHANNEL_ID'
  | 'UNVERIFIED_YOUTUBE_CHANNEL_ID'
  | 'DUPLICATE_YOUTUBE_CHANNEL_ID'
  | 'MISSING_VOD_RELATION'
  | 'MISSING_SONG_RELATION'
  | 'VOD_STREAMER_MISMATCH'
  | 'SONG_STREAMER_MISMATCH'
  | 'MISSING_VIDEO_ID'
  | 'INVALID_VIDEO_ID'
  | 'DUPLICATE_VOD_VIDEO_ID'
  | 'MISSING_VOD_TITLE'
  | 'MISSING_VOD_DATE'
  | 'INVALID_VOD_DATE'
  | 'MISSING_SONG_ID'
  | 'MISSING_SONG_TITLE'
  | 'MISSING_PERFORMANCE_ID'
  | 'INVALID_UNICODE_TEXT'
  | 'MISSING_START_SECONDS'
  | 'INVALID_START_SECONDS'
  | 'MISSING_END_SECONDS'
  | 'INVALID_END_SECONDS'
  | 'INVALID_END_RANGE'
  | 'UNSAFE_AVATAR_URL'
  | 'UNSAFE_SOCIAL_LINK'
  | 'MISSING_ORIGINAL_ARTIST';

/** Public field names a finding may point at — never a private column name. */
export type PublicFindingField =
  | 'slug'
  | 'displayName'
  | 'youtubeChannelId'
  | 'avatarUrl'
  | 'group'
  | 'socialLinks'
  | 'videoId'
  | 'title'
  | 'date'
  | 'songId'
  | 'performanceId'
  | 'originalArtist'
  | 'startSeconds'
  | 'endSeconds';

export interface FindingDetails {
  submissionId?: string;
  streamId?: string;
  rowId?: number;
  duplicateCount?: number;
  startSeconds?: number;
  endSeconds?: number;
  affectedPerformanceCount?: number;
  youtube?: boolean;
  twitter?: boolean;
  facebook?: boolean;
  instagram?: boolean;
  twitch?: boolean;
}

/** One validation finding, exactly as the export core produces it. */
export interface VodExportFinding {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  streamerSlug?: string;
  entityType: FindingEntityType;
  entityId?: string;
  field?: PublicFindingField;
  details?: FindingDetails;
}

/**
 * What the Admin API serves: a finding plus the server-resolved Admin path for
 * the offending row (D-013.10). The page accepts only a relative in-app path
 * and never builds a destination out of finding values.
 */
export interface VodExportFindingApi extends VodExportFinding {
  repairPath?: string;
}

export type CapacityResource =
  | 'sourceRows'
  | 'sourceTextBytes'
  | 'streamers'
  | 'vods'
  | 'performances'
  | 'snapshotBytes'
  | 'findings'
  | 'findingsBytes'
  | 'd1JsonBindingBytes';

export type CapacityState = 'ok' | 'warning' | 'exceeded';

export interface CapacityDiagnostic {
  resource: CapacityResource;
  actual: number;
  limit: number;
  ratio: number;
  state: CapacityState;
}

export interface VodExportCounts {
  streamers: number;
  vods: number;
  performances: number;
}

import type { SocialProvider } from './constants';

export type SourceApprovalStatus = 'pending' | 'approved' | 'rejected' | 'excluded' | 'extracted' | string;

/**
 * A SQLite value queried together with typeof(value) and a lossless decimal
 * text representation. The source adapter must not coerce it to a number.
 */
export interface SqliteIntegerSource {
  storageClass: string;
  decimalText: string | null;
}

export interface ExportSourceStreamer {
  /** Private, bounded NOVA locator. It is never copied to public artifacts. */
  submissionId: string;
  slug: string | null;
  displayName: string | null;
  youtubeChannelId: string | null;
  /** The exact ID stored by the successful YouTube verification workflow. */
  verifiedYoutubeChannelId: string | null;
  /** Required companion timestamp from the successful verification workflow. */
  youtubeChannelVerifiedAt: string | null;
  avatarUrl: string | null;
  group: string | null;
  socialLinks: Readonly<Partial<Record<SocialProvider, string | null>>>;
  enabled: boolean;
  status: SourceApprovalStatus;
}

export interface ExportSourceVod {
  /** Private Admin stream ID and relationship key. */
  streamId: string;
  streamerId: string;
  title: string | null;
  date: string | null;
  videoId: string | null;
  status: SourceApprovalStatus;
}

export interface ExportSourceSong {
  /** Private SQLite rowid used only when the public song ID is unavailable. */
  rowId: number;
  songId: string | null;
  streamerId: string;
  title: string | null;
  originalArtist: string | null;
  status: SourceApprovalStatus;
}

export interface ExportSourcePerformance {
  /** Private SQLite rowid used only when the public performance ID is unavailable. */
  rowId: number;
  performanceId: string | null;
  streamerId: string;
  songId: string;
  streamId: string;
  startSeconds: SqliteIntegerSource;
  endSeconds: SqliteIntegerSource;
  status: SourceApprovalStatus;
}

/**
 * Complete bounded input for one logical generation attempt.
 *
 * Adapter invariants:
 * - streamers includes every approved+enabled NOVA row (the core still gates it defensively);
 * - performances includes every approved performance for those raw streamer keys;
 * - vods/songs include approved rows plus every parent referenced by those performances;
 * - private stream IDs and SQLite rowids are unique, non-empty source locators;
 * - each DB row appears once and non-empty song/performance primary IDs retain
 *   the database's uniqueness guarantee (there is no v1 duplicate-ID finding);
 * - no query-layer number coercion has occurred for timestamp fields.
 */
export interface VodExportSourceData {
  streamers: readonly ExportSourceStreamer[];
  vods: readonly ExportSourceVod[];
  songs: readonly ExportSourceSong[];
  performances: readonly ExportSourcePerformance[];
}

export type VodExportSocialLinks = Partial<Record<SocialProvider, string>>;

export interface VodExportPerformance {
  performanceId: string;
  songId: string;
  title: string;
  originalArtist: string | null;
  startSeconds: number;
  endSeconds: number;
}

export interface VodExportVod {
  title: string;
  date: string;
  videoId: string;
  performances: VodExportPerformance[];
}

export interface VodExportStreamer {
  slug: string;
  displayName: string;
  youtubeChannelId: string;
  avatarUrl: string | null;
  group: string | null;
  socialLinks: VodExportSocialLinks;
  vods: VodExportVod[];
}

export interface VodExportSnapshot {
  schemaVersion: '1.0.0';
  streamers: VodExportStreamer[];
}

export interface VodExportCounts {
  streamers: number;
  vods: number;
  performances: number;
}

export interface VodExportManifest {
  schemaVersion: '1.0.0';
  snapshotUrl: string;
  sha256: string;
  publishedAt: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
}

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

export interface VodExportValidationResult {
  canPublish: boolean;
  findings: VodExportFinding[];
}

export type CapacityResource =
  | 'sourceRows'
  | 'sourceTextBytes'
  | 'streamers'
  | 'vods'
  | 'performances'
  | 'snapshotBytes'
  | 'findings'
  | 'findingsBytes';

export type CapacityState = 'ok' | 'warning' | 'exceeded';

export interface CapacityDiagnostic {
  resource: CapacityResource;
  actual: number;
  limit: number;
  ratio: number;
  state: CapacityState;
}

export interface VodExportBuildResult extends VodExportValidationResult {
  snapshot: VodExportSnapshot | null;
  counts: VodExportCounts;
  capacity: CapacityDiagnostic[];
}

export interface VodExportSnapshotArtifact {
  snapshot: VodExportSnapshot;
  bytes: Uint8Array;
  sha256: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
  objectKey: string;
  snapshotUrl: string;
  downloadFilename: string;
  capacity: CapacityDiagnostic[];
}

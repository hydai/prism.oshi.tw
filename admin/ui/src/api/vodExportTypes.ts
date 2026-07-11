export interface VodExportCounts {
  streamers: number;
  vods: number;
  performances: number;
}

export interface VodExportPublication {
  schemaVersion: string;
  snapshotUrl: string;
  sha256: string;
  publishedAt: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
}

export type VodExportFindingSeverity = 'error' | 'warning';
export type VodExportFindingEntity = 'streamer' | 'vod' | 'song' | 'performance';

export interface VodExportFinding {
  code: string;
  severity: VodExportFindingSeverity;
  message: string;
  streamerSlug?: string;
  entityType?: VodExportFindingEntity;
  entityId?: string;
  field?: string;
  details?: Record<string, string | number | boolean>;
  /**
   * Optional server-resolved Admin path for D-013.10. The page accepts only a
   * relative in-app path and never builds a destination from finding values.
   */
  repairPath?: string;
}

export type VodExportCapacityState = 'ok' | 'warning' | 'exceeded';

export interface VodExportCapacityDiagnostic {
  resource: string;
  actual: number;
  limit: number;
  ratio: number;
  state: VodExportCapacityState;
}

export type VodExportCandidateState = 'ready' | 'stale' | 'expired' | 'already_published';

export interface VodExportCandidate {
  candidateId: string;
  schemaVersion: string;
  sha256: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
  generatedAt: string;
  expiresAt: string;
  state?: VodExportCandidateState;
}

export interface VodExportStatusResponse {
  currentPublication: VodExportPublication | null;
  changesNotPublished: boolean;
  publicationInProgress: boolean;
  generationInProgress: boolean;
  recoveryAvailable: boolean;
  controlWarning?: string;
}

export interface VodExportPreviewResponse {
  canPublish: boolean;
  findings: VodExportFinding[];
  candidate: VodExportCandidate | null;
  capacity: VodExportCapacityDiagnostic[];
}

export type VodExportCandidateResponse = VodExportPreviewResponse;

export interface VodExportPublishResponse {
  outcome: 'published' | 'already_published';
  currentPublication: VodExportPublication;
  warnings: string[];
}

export interface VodExportReconcileResponse {
  outcome: 'idle' | 'recovered' | 'already_published' | 'released_not_committed';
  currentPublication: VodExportPublication | null;
}

export interface VodExportDownload {
  blob: Blob;
  filename: string;
}

export interface VodExportRepairParent {
  id: string | null;
  streamerId: string | null;
  title: string | null;
  status: string | null;
}

export type VodExportRepairRecord = {
  entity: 'performance';
  rowId: number;
  id: string | null;
  streamerId: string | null;
  songId: string | null;
  streamId: string | null;
  startSeconds: string | null;
  startStorageClass: string;
  endSeconds: string | null;
  endStorageClass: string;
  status: string | null;
  referencedSong: VodExportRepairParent | null;
  referencedVod: VodExportRepairParent | null;
} | {
  entity: 'song';
  rowId: number;
  id: string | null;
  streamerId: string | null;
  title: string | null;
  originalArtist: string | null;
  status: string | null;
  performanceCount: number;
} | {
  entity: 'vod';
  rowId: number;
  id: string | null;
  streamerId: string | null;
  title: string | null;
  date: string | null;
  videoId: string | null;
  status: string | null;
} | {
  entity: 'streamer';
  rowId: number;
  id: string | null;
  slug: string | null;
  displayName: string | null;
  youtubeChannelId: string | null;
  enabled: boolean;
  status: string | null;
};

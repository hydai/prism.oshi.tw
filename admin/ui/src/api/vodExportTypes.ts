/**
 * Everything the worker sends is described once in `admin/shared/vod-export-types`;
 * this file only names those shapes for the UI and adds the response envelopes the
 * pages read. A finding always arrives in its API form — validation output plus the
 * server-resolved repair path — so that is the only finding type the pages see.
 */
export type {
  CapacityDiagnostic as VodExportCapacityDiagnostic,
  CapacityResource as VodExportCapacityResource,
  FindingSeverity as VodExportFindingSeverity,
  VodExportCounts,
  VodExportFindingApi,
} from '../../../shared/vod-export-types';

import type {
  CapacityDiagnostic,
  VodExportCounts,
  VodExportFindingApi,
} from '../../../shared/vod-export-types';

export interface VodExportPublication {
  schemaVersion: string;
  snapshotUrl: string;
  sha256: string;
  publishedAt: string;
  uncompressedBytes: number;
  counts: VodExportCounts;
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
  findings: VodExportFindingApi[];
  candidate: VodExportCandidate | null;
  capacity: CapacityDiagnostic[];
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

// Shared types between Workers API and Admin UI
// Derived from lib/types.ts (fan site) with admin-specific additions

export type Status = 'pending' | 'approved' | 'rejected' | 'excluded' | 'extracted';

// --- Database row types (match D1 schema) ---

export interface SongRow {
  id: string;
  title: string;
  original_artist: string;
  tags: string;       // JSON array string
  status: Status;
  submitted_by: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PerformanceRow {
  id: string;
  song_id: string;
  stream_id: string;
  date: string;
  stream_title: string;
  video_id: string;
  timestamp: number;
  end_timestamp: number | null;
  note: string;
  status: Status;
  submitted_by: string | null;
  created_at: string;
}

export interface StreamRow {
  id: string;
  title: string;
  date: string;
  video_id: string;
  youtube_url: string;
  credit: string;     // JSON object string
  status: Status;
  submitted_by: string | null;
  reviewed_by: string | null;
  created_at: string;
}

// --- API response types (parsed JSON fields) ---

export interface Song {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  status: Status;
  submittedBy: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  performances?: Performance[];
}

export interface Performance {
  id: string;
  songId: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
  status: Status;
  submittedBy: string | null;
  createdAt: string;
}

export interface StreamCredit {
  author?: string;
  authorUrl?: string;
  commentUrl?: string;
}

export interface Stream {
  id: string;
  title: string;
  date: string;
  videoId: string;
  youtubeUrl: string;
  credit: StreamCredit;
  status: Status;
  submittedBy: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

// --- Request body types ---

export interface CreateSongBody {
  title: string;
  originalArtist: string;
  tags?: string[];
  performances?: CreatePerformanceBody[];
}

export interface UpdateSongBody {
  title?: string;
  originalArtist?: string;
  tags?: string[];
}

export interface CreatePerformanceBody {
  songId: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number | null;
  note?: string;
}

export interface CreateStreamBody {
  title: string;
  date: string;
  videoId: string;
  youtubeUrl: string;
  credit?: StreamCredit;
}

export interface StatusUpdateBody {
  status: Status;
}

// --- Auth types ---

export type Role = 'curator' | 'contributor';

export interface AuthUser {
  email: string;
  role: Role;
}

// --- API list response ---

export interface ListResponse<T> {
  data: T[];
  total: number;
}

// --- Stamp editor types ---

export interface StampPerformance {
  id: string;
  songId: string;
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
  status: Status;
}

export interface CreateStampPerformanceBody {
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp?: number | null;
  note?: string;
}

export interface UpdateTimestampsBody {
  timestamp?: number;
  endTimestamp?: number | null;
}

export interface UpdateSongDetailsBody {
  title?: string;
  originalArtist?: string;
}

// --- Stamp editor extended types ---

export interface StreamWithPending extends Stream {
  pendingCount: number;
}

export interface StampStats {
  total: number;
  filled: number;
  remaining: number;
}

export interface FetchDurationResponse {
  ok: boolean;
  durationSec: number | null;
  endTimestamp: number | null;
  matchConfidence: string | null;
}

// --- Stream detail response ---

export interface StreamDetail extends Stream {
  performances: StampPerformance[];
}

// --- Paste import types ---

export interface PasteImportBody {
  text: string;
  replace?: boolean;
}

export interface PasteImportParsedSong {
  songName: string;
  artist: string;
  startSeconds: number;
  endSeconds: number | null;
  startTimestamp: string;
  endTimestamp: string | null;
}

export interface PasteImportResponse {
  ok: boolean;
  parsed: number;
  created: number;
  replaced: boolean;
  errors: string[];
}

// --- Dashboard stats ---

export interface StatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  excluded: number;
  extracted: number;
}

export interface DashboardStats {
  songs: StatusCounts;
  streams: StatusCounts;
  performances: StatusCounts;
  recentSubmissions: (Song | Stream)[];
}

// --- Pipeline types (YouTube fetch & extract) ---

export interface DiscoveredStream {
  videoId: string;
  title: string;
  date: string;
  isNew: boolean;
  existingStreamId?: string;
  existingStatus?: Status;
}

export interface DiscoverStreamsResponse {
  streams: DiscoveredStream[];
  total: number;
}

export interface ImportStreamsBody {
  videoIds: string[];
}

export interface ImportStreamsResponse {
  created: number;
  streamIds: string[];
}

export interface CandidateComment {
  commentId: string;
  text: string;
  author: string;
  likes: number;
  timestampCount: number;
  isPinned: boolean;
}

export interface ExtractResponse {
  source: 'comment' | 'description' | null;
  candidateComment: CandidateComment | null;
  allCandidates: CandidateComment[];
  parsedSongs: PasteImportParsedSong[];
  credit: StreamCredit | null;
}

export interface ExtractImportBody {
  streamId: string;
  songs: Array<{
    songName: string;
    artist: string;
    startSeconds: number;
    endSeconds: number | null;
  }>;
  credit?: StreamCredit;
  replace?: boolean;
}

export interface ExtractImportResponse {
  ok: boolean;
  created: number;
}

// --- Nova submission types ---

export type NovaStatus = 'pending' | 'approved' | 'rejected';

export interface NovaSubmission {
  id: string;
  youtube_channel_url: string;
  youtube_channel_id: string;
  slug: string;
  brand_name: string;
  display_name: string;
  description: string;
  avatar_url: string;
  subscriber_count: string;
  link_youtube: string;
  link_twitter: string;
  link_facebook: string;
  link_instagram: string;
  link_twitch: string;
  group: string;
  enabled: number;
  display_order: number;
  theme_json: string;
  status: NovaStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string;
}

export interface StreamerInfo {
  slug: string;
  displayName: string;
}

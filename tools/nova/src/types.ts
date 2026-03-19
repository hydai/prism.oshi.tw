export type Bindings = {
  DB: D1Database;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
};

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface SubmissionRow {
  id: string;
  youtube_channel_url: string;
  youtube_channel_url_normalized: string;
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
  external_url: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string;
}

export interface SubmitBody {
  youtube_channel_url: string;
  display_name: string;
  group?: string;
  description?: string;
  avatar_url?: string;
  subscriber_count?: string;
  link_youtube?: string;
  link_twitter?: string;
  link_facebook?: string;
  link_instagram?: string;
  link_twitch?: string;
  turnstile_token: string;
}

// --- VOD Submission types ---

export interface VodSubmissionRow {
  id: string;
  streamer_slug: string;
  video_id: string;
  video_url: string;
  stream_title: string;
  stream_date: string;
  thumbnail_url: string;
  submitter_note: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string;
}

export interface VodSongRow {
  id: string;
  vod_submission_id: string;
  song_title: string;
  original_artist: string;
  start_timestamp: number;
  end_timestamp: number | null;
  sort_order: number;
}

export interface VodSongInput {
  song_title: string;
  original_artist?: string;
  start_timestamp: string | number; // accepts "H:MM:SS" or seconds
  end_timestamp?: string | number | null;
}

export interface VodSubmitBody {
  streamer_slug: string;
  video_url: string;
  stream_title?: string;
  stream_date?: string;
  submitter_note?: string;
  songs?: VodSongInput[];
  turnstile_token: string;
}

export interface ApprovedStreamer {
  slug: string;
  display_name: string;
  avatar_url: string;
}

export interface SubmissionSummary {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface VodSubmissionSummary {
  id: string;
  streamer_slug: string;
  video_id: string;
  stream_title: string;
  stream_date: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  song_count: number;
}

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
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string;
}

export interface SubmitBody {
  youtube_channel_url: string;
  slug: string;
  display_name: string;
  brand_name?: string;
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

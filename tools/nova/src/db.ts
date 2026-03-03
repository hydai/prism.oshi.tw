import type { SubmissionRow } from './types';

/**
 * Generate a submission ID: sub-XXXXXXXX (8 random hex chars).
 */
export function generateId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sub-${hex}`;
}

/**
 * Find an existing submission by normalized YouTube channel URL.
 */
export async function findByChannelUrl(
  db: D1Database,
  channelUrl: string,
): Promise<Pick<SubmissionRow, 'id' | 'status' | 'submitted_at'> | null> {
  const row = await db
    .prepare('SELECT id, status, submitted_at FROM submissions WHERE youtube_channel_url_normalized = ?')
    .bind(channelUrl)
    .first<Pick<SubmissionRow, 'id' | 'status' | 'submitted_at'>>();
  return row ?? null;
}

/**
 * Reset a rejected submission back to pending with updated data.
 * Clears reviewer fields so it goes through a fresh review cycle.
 */
export async function resetRejectedSubmission(
  db: D1Database,
  id: string,
  data: {
    youtube_channel_url: string;
    display_name: string;
    group: string;
    description: string;
    avatar_url: string;
    subscriber_count: string;
    link_youtube: string;
    link_twitter: string;
    link_facebook: string;
    link_instagram: string;
    link_twitch: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE submissions SET
        youtube_channel_url = ?,
        display_name = ?, "group" = ?, description = ?,
        avatar_url = ?, subscriber_count = ?,
        link_youtube = ?, link_twitter = ?, link_facebook = ?,
        link_instagram = ?, link_twitch = ?,
        status = 'pending',
        submitted_at = datetime('now'),
        reviewed_at = NULL,
        reviewer_note = NULL
      WHERE id = ? AND status = 'rejected'`,
    )
    .bind(
      data.youtube_channel_url,
      data.display_name,
      data.group,
      data.description,
      data.avatar_url,
      data.subscriber_count,
      data.link_youtube,
      data.link_twitter,
      data.link_facebook,
      data.link_instagram,
      data.link_twitch,
      id,
    )
    .run();
}

/**
 * Insert a new submission into D1.
 */
export async function insertSubmission(
  db: D1Database,
  id: string,
  data: {
    youtube_channel_url: string;
    youtube_channel_url_normalized: string;
    slug: string;
    display_name: string;
    brand_name: string;
    group: string;
    description: string;
    avatar_url: string;
    subscriber_count: string;
    link_youtube: string;
    link_twitter: string;
    link_facebook: string;
    link_instagram: string;
    link_twitch: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO submissions (
        id, youtube_channel_url, youtube_channel_url_normalized, slug, brand_name, "group", display_name,
        description, avatar_url, subscriber_count,
        link_youtube, link_twitter, link_facebook, link_instagram, link_twitch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.youtube_channel_url,
      data.youtube_channel_url_normalized,
      data.slug,
      data.brand_name,
      data.group,
      data.display_name,
      data.description,
      data.avatar_url,
      data.subscriber_count,
      data.link_youtube,
      data.link_twitter,
      data.link_facebook,
      data.link_instagram,
      data.link_twitch,
    )
    .run();
}

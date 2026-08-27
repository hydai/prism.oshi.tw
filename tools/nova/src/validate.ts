/**
 * Normalize a YouTube channel URL for dedup while preserving the original.
 * Accepts /@handle, /channel/UCxxx, /c/custom patterns.
 * Returns { canonical, normalized } or null if invalid.
 *   - canonical: clean URL with original casing (for display/linking)
 *   - normalized: lowercased URL (for dedup lookups)
 */
export function normalizeYoutubeChannelUrl(raw: string): { canonical: string; normalized: string } | null {
  let url: URL;
  try {
    // Handle bare handles like @MizukiPrism
    if (raw.startsWith('@')) {
      url = new URL(`https://www.youtube.com/${raw}`);
    } else {
      url = new URL(raw);
    }
  } catch {
    return null;
  }

  if (!url.hostname.includes('youtube.com')) {
    return null;
  }

  // Remove trailing slashes, keep original case
  const pathOriginal = url.pathname.replace(/\/+$/, '');
  const pathLower = pathOriginal.toLowerCase();

  // Match valid channel path patterns (on lowered for validation)
  const match = pathLower.match(/^\/(channel\/[^/]+|c\/[^/]+|@[^/]+)$/);
  if (!match) {
    return null;
  }

  // Extract same segment from original-case path
  const matchOriginal = pathOriginal.match(/^\/(channel\/[^/]+|c\/[^/]+|@[^/]+)$/i);

  return {
    canonical: `https://www.youtube.com/${matchOriginal![1]}`,
    normalized: `https://www.youtube.com/${match[1]}`,
  };
}

/**
 * Validate a slug: lowercase alphanumeric + hyphens, 1-50 chars.
 */
export function validateSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(slug) || /^[a-z0-9]{1,2}$/.test(slug);
}

/**
 * Validate required string fields are non-empty after trimming.
 */
export function validateRequired(fields: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!value || !value.trim()) {
      errors.push(`${name} is required`);
    }
  }
  return errors;
}

/**
 * Parse a YouTube video URL (watch?v=, youtu.be/, /live/) into { videoId, canonical }.
 * Returns null if invalid.
 */
export function parseYoutubeVideoUrl(raw: string): { videoId: string; canonical: string } | null {
  const trimmed = raw.trim();

  // youtube.com/watch?v=VIDEO_ID
  const watchMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]+)/);
  if (watchMatch) {
    return { videoId: watchMatch[1], canonical: `https://www.youtube.com/watch?v=${watchMatch[1]}` };
  }

  // youtube.com/live/VIDEO_ID
  const liveMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]+)/);
  if (liveMatch) {
    return { videoId: liveMatch[1], canonical: `https://www.youtube.com/watch?v=${liveMatch[1]}` };
  }

  // youtu.be/VIDEO_ID
  const shortMatch = trimmed.match(/(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortMatch) {
    return { videoId: shortMatch[1], canonical: `https://www.youtube.com/watch?v=${shortMatch[1]}` };
  }

  return null;
}

/**
 * Parse a timestamp string (H:MM:SS or MM:SS) to seconds.
 * Also accepts raw integer seconds. Returns null if invalid.
 */
export function parseTimestamp(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return raw >= 0 ? Math.floor(raw) : null;
  }

  const trimmed = raw.trim();

  // Try plain integer
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // H:MM:SS or MM:SS
  const match = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);

  if (minutes >= 60 || seconds >= 60) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

// --- Server-side length caps (single source of truth; the forms derive maxlength from these) ---

export const LINK_URL_LIMIT = 500;

/** Streamer submission (`POST /api/submit`) — trimmed UTF-16 length, same unit as HTML maxlength. */
export const SUBMISSION_FIELD_LIMITS = {
  youtube_channel_url: LINK_URL_LIMIT,
  display_name: 100,
  group: 100,
  description: 2000,
  avatar_url: LINK_URL_LIMIT,
  subscriber_count: 50,
  link_youtube: LINK_URL_LIMIT,
  link_twitter: LINK_URL_LIMIT,
  link_facebook: LINK_URL_LIMIT,
  link_instagram: LINK_URL_LIMIT,
  link_twitch: LINK_URL_LIMIT,
} as const;

/** VOD submission (`POST /vod/api/submit`). stream_date is stored verbatim, so it gets a cap too. */
export const VOD_FIELD_LIMITS = {
  video_url: LINK_URL_LIMIT,
  stream_title: 300,
  stream_date: 32,
  submitter_note: 500,
  thumbnail_url: LINK_URL_LIMIT,
} as const;

export const VOD_SONG_FIELD_LIMITS = {
  song_title: 200,
  original_artist: 200,
} as const;

/** A multi-hour karaoke stream lands around 100 songs; 200 leaves headroom. */
export const MAX_VOD_SONGS = 200;

/**
 * Length check on the trimmed value (= what gets stored). Missing (undefined/null)
 * fields pass — required-ness is validateRequired's job. Non-string values are
 * rejected so a JSON number never reaches .trim().
 */
export function validateFieldLengths(values: object, limits: Readonly<Record<string, number>>): string[] {
  const record = values as Record<string, unknown>;
  const errors: string[] = [];
  for (const [field, limit] of Object.entries(limits)) {
    const raw = record[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') {
      errors.push(`${field} 必須是文字`);
      continue;
    }
    if (raw.trim().length > limit) {
      errors.push(`${field} 長度上限為 ${limit} 字`);
    }
  }
  return errors;
}

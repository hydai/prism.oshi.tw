// YouTube Data API v3 client for stream discovery and comment extraction.
// Uses playlistItems.list (1 unit) instead of search.list (100 units) to save quota.

const YT_API = 'https://www.googleapis.com/youtube/v3';

// Karaoke stream detection keywords (from MizukiLens config.py)
const KARAOKE_KEYWORDS = ['歌回', '歌枠', '唱歌', 'singing', 'karaoke'];

// Minimum timestamps required for a comment to be a candidate
const MIN_TIMESTAMPS_REQUIRED = 3;

// Timestamp pattern: H:MM:SS or M:SS
const TIMESTAMP_RE = /(?:\d{1,2}:)?\d{1,2}:\d{2}/g;

// --- YouTube API response types ---

interface PlaylistItemSnippet {
  resourceId: { videoId: string };
  title: string;
  publishedAt: string;
}

interface PlaylistItemsResponse {
  items: Array<{ snippet: PlaylistItemSnippet }>;
  nextPageToken?: string;
}

interface VideoDetails {
  id: string;
  snippet: {
    title: string;
    publishedAt: string;
    description: string;
    liveBroadcastContent: string;
  };
  contentDetails: {
    duration: string;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
  };
}

interface VideosResponse {
  items: VideoDetails[];
}

interface CommentThread {
  id: string;
  snippet: {
    topLevelComment: {
      id: string;
      snippet: {
        textOriginal: string;
        authorDisplayName: string;
        likeCount: number;
        publishedAt: string;
      };
    };
    isHeldForReview?: boolean;
  };
}

interface CommentThreadsResponse {
  items: CommentThread[];
  nextPageToken?: string;
}

// --- Exported types ---

export interface DiscoveredVideo {
  videoId: string;
  title: string;
  date: string; // YYYY-MM-DD
  description: string;
}

export interface CandidateComment {
  commentId: string;
  text: string;
  author: string;
  likes: number;
  timestampCount: number;
  isPinned: boolean;
}

// --- Helpers ---

/** Wrap fetch with Referer header to satisfy API key HTTP referrer restrictions. */
function ytFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Referer: 'https://mizukiprism-admin.mizuki.tw/' },
  });
}

// --- Core functions ---

function matchesKaraoke(title: string): boolean {
  const lower = title.toLowerCase();
  return KARAOKE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

export function countTimestamps(text: string): number {
  const matches = text.match(TIMESTAMP_RE);
  return matches ? matches.length : 0;
}

/** Convert channel ID (UC...) to uploads playlist ID (UU...) */
function uploadsPlaylistId(channelId: string): string {
  if (channelId.startsWith('UC')) {
    return 'UU' + channelId.slice(2);
  }
  return channelId;
}

/** Extract YYYY-MM-DD from an ISO date string */
function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Discover recent karaoke streams from the channel.
 * Uses playlistItems.list (1 unit) + videos.list (1 unit per 50) = ~2 units.
 */
export async function discoverStreams(
  apiKey: string,
  channelId: string,
  opts?: { maxResults?: number },
): Promise<DiscoveredVideo[]> {
  const playlistId = uploadsPlaylistId(channelId);
  const maxResults = opts?.maxResults ?? 50;

  // Fetch recent uploads (1 quota unit)
  const url = new URL(`${YT_API}/playlistItems`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('key', apiKey);

  const res = await ytFetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube playlistItems.list failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as PlaylistItemsResponse;
  const videoIds = data.items
    .filter((item) => matchesKaraoke(item.snippet.title))
    .map((item) => item.snippet.resourceId.videoId);

  if (videoIds.length === 0) return [];

  // Fetch video details for duration/live info (1 unit per 50 IDs)
  return getVideoDetails(apiKey, videoIds);
}

/**
 * Batch fetch video details. 1 quota unit per call (up to 50 IDs).
 */
export async function getVideoDetails(
  apiKey: string,
  videoIds: string[],
): Promise<DiscoveredVideo[]> {
  const results: DiscoveredVideo[] = [];

  // Process in chunks of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const url = new URL(`${YT_API}/videos`);
    url.searchParams.set('part', 'snippet,contentDetails,liveStreamingDetails');
    url.searchParams.set('id', chunk.join(','));
    url.searchParams.set('key', apiKey);

    const res = await ytFetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube videos.list failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as VideosResponse;
    for (const item of data.items) {
      // Use actual stream start time if available, else publishedAt
      const dateSource =
        item.liveStreamingDetails?.actualStartTime ?? item.snippet.publishedAt;
      results.push({
        videoId: item.id,
        title: item.snippet.title,
        date: toDateStr(dateSource),
        description: item.snippet.description,
      });
    }
  }

  return results;
}

/**
 * Fetch top-level comments for a video. 1 quota unit per page.
 */
export async function fetchComments(
  apiKey: string,
  videoId: string,
  opts?: { maxResults?: number },
): Promise<CandidateComment[]> {
  const maxResults = opts?.maxResults ?? 100;

  const url = new URL(`${YT_API}/commentThreads`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('key', apiKey);

  const res = await ytFetch(url.toString());
  if (!res.ok) {
    // Comments disabled returns 403
    if (res.status === 403) {
      const body = await res.text();
      if (body.includes('commentsDisabled')) return [];
      throw new Error(`YouTube API quota exceeded or forbidden: ${body}`);
    }
    const body = await res.text();
    throw new Error(`YouTube commentThreads.list failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as CommentThreadsResponse;

  return data.items.map((thread, index) => {
    const c = thread.snippet.topLevelComment.snippet;
    return {
      commentId: thread.snippet.topLevelComment.id,
      text: c.textOriginal,
      author: c.authorDisplayName,
      likes: c.likeCount,
      timestampCount: countTimestamps(c.textOriginal),
      // YouTube API v3: first comment in relevance-sorted results is pinned if one exists
      isPinned: index === 0 && c.likeCount > 0,
    };
  });
}

/**
 * Find the best candidate comment for timestamp extraction.
 * Port of Python's find_candidate_comment: require >= 3 timestamps,
 * prioritize pinned > likes > timestamp count.
 */
export function findCandidateComment(
  comments: CandidateComment[],
): CandidateComment | null {
  const candidates = comments.filter(
    (c) => c.timestampCount >= MIN_TIMESTAMPS_REQUIRED,
  );
  if (candidates.length === 0) return null;

  // Sort by priority: pinned (desc) > likes (desc) > timestampCount (desc)
  candidates.sort((a, b) => {
    const pinnedDiff = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
    if (pinnedDiff !== 0) return pinnedDiff;
    const likesDiff = b.likes - a.likes;
    if (likesDiff !== 0) return likesDiff;
    return b.timestampCount - a.timestampCount;
  });

  return candidates[0]!;
}

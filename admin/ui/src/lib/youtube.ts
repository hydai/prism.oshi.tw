/**
 * The `hqdefault` thumbnail of a YouTube video. The id is percent-encoded, so whatever a page holds
 * for it (it may come from a pasted URL) stays inside its path segment. Unlike `YouTubeEmbed`, which
 * trims its id, this encodes the id exactly as given: pass it trimmed.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

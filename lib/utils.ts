export function validateYoutubeUrl(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|live\/)|youtu\.be\/)[a-zA-Z0-9_-]+/.test(url);
}

export function extractVideoId(youtubeUrl: string): string | null {
  // Match youtube.com/watch?v=VIDEO_ID
  const watchMatch = youtubeUrl.match(/youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]+)/);
  if (watchMatch) return watchMatch[1];

  // Match youtube.com/live/VIDEO_ID
  const liveMatch = youtubeUrl.match(/youtube\.com\/live\/([a-zA-Z0-9_-]+)/);
  if (liveMatch) return liveMatch[1];

  // Match youtu.be/VIDEO_ID
  const shortMatch = youtubeUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortMatch) return shortMatch[1];

  return null;
}

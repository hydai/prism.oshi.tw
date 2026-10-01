/**
 * The `hqdefault` thumbnail of a YouTube video. The id is percent-encoded, so whatever a page holds
 * for it (it may come from a pasted URL) stays inside its path segment. Unlike `YouTubeEmbed`, which
 * trims its id, this encodes the id exactly as given: pass it trimmed.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/** youtube.com and any subdomain of it (www, m, music), and the cookieless embed domain. */
const YOUTUBE_HOST = /(^|\.)youtube(-nocookie)?\.com$/;

/** The links whose first path segment is their kind and whose second is the video id: `/live/<id>` and so on. */
const KINDS_WITH_THE_ID_IN_THE_PATH = ['live', 'shorts', 'embed'];

/**
 * What stands where a video id would in the embed link of a playlist (`/embed/videoseries?list=…`) or of a
 * channel's live stream (`/embed/live_stream?channel=…`): both are eleven characters, like an id, and name no video.
 * Only in an `/embed/` link: in `youtu.be/…`, `/live/…`, `/shorts/…` and `?v=` the same word is an id like any other.
 */
const NAMES_THAT_ARE_NOT_VIDEO_IDS = ['videoseries', 'live_stream'];

/**
 * The video id a path segment holds, or `''` when there is none. The segment is percent-decoded, as a `?v=`
 * value is when the query is read, so `a%20b` is `a b`. A malformed escape (`%`, `%E0%A4%A`) is a link nobody
 * could follow, so it holds none. Whatever the decoding leaves, a space in front included, is as it reads: the
 * page that takes the id trims it.
 */
function videoIdOf(segment: string | undefined): string {
  if (segment === undefined) return '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

/**
 * The id of the video a pasted link names, or an empty string. It reads `youtu.be/<id>`, `?v=<id>` and
 * `/live/<id>`, `/shorts/<id>` and `/embed/<id>` on YouTube's own hosts, over http or https, whatever else
 * the link carries (a time, a share tag, a playlist, a trailing slash, more path); a link on any other host
 * or scheme, or one that names no video, has none: an `/embed/` link of a playlist or a channel's live stream
 * (`/embed/videoseries`, `/embed/live_stream`) is one. A page reads it on every keystroke of a URL field, so
 * text that is not a link yet is simply `''`, not an error.
 */
export function extractVideoId(url: string): string {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return '';
  }
  if (link.protocol !== 'http:' && link.protocol !== 'https:') return '';
  const segments = link.pathname.split('/').filter((segment) => segment !== '');
  if (link.hostname === 'youtu.be') return videoIdOf(segments[0]);
  if (!YOUTUBE_HOST.test(link.hostname)) return '';
  const [kind, id] = segments;
  if (kind !== undefined && id !== undefined && KINDS_WITH_THE_ID_IN_THE_PATH.includes(kind)) {
    const named = videoIdOf(id);
    return kind === 'embed' && NAMES_THAT_ARE_NOT_VIDEO_IDS.includes(named) ? '' : named;
  }
  return link.searchParams.get('v') ?? '';
}

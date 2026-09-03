import type { SocialProvider } from '../../lib/social-providers';

// Every social provider a streamer profile links to, plus the two image kinds
// Nova validates that are not profile links.
export type NovaUrlProvider = SocialProvider | 'image' | 'thumbnail';

const allowedHosts: Record<NovaUrlProvider, ReadonlySet<string>> = {
  youtube: new Set(['youtube.com', 'm.youtube.com', 'youtu.be']),
  twitter: new Set(['twitter.com', 'mobile.twitter.com', 'x.com']),
  facebook: new Set(['facebook.com', 'm.facebook.com', 'fb.com']),
  instagram: new Set(['instagram.com']),
  twitch: new Set(['twitch.tv']),
  image: new Set(['yt3.ggpht.com', 'yt4.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com']),
  // Video thumbnails (YouTube oEmbed / Data API): submitter-supplied, so only YouTube's image CDNs may load.
  thumbnail: new Set(['i.ytimg.com', 'i1.ytimg.com', 'i2.ytimg.com', 'i3.ytimg.com', 'i4.ytimg.com', 'i9.ytimg.com', 'img.youtube.com']),
};

/**
 * Every host an `<img>` on a Nova page may load from: the avatar CDNs plus the
 * video-thumbnail CDNs, which is exactly what `sanitizeNovaUrl()` admits for those
 * two providers — matched exactly (no `www.` alias, no explicit port), so every
 * stored image URL is one these host sources match: a CSP host source covers only
 * that host on its default port. Derived from `allowedHosts` rather than restated,
 * so the workers' Content-Security-Policy `img-src` and this sanitizer cannot drift
 * apart — widening one widens the other.
 */
export const NOVA_IMAGE_HOSTS: readonly string[] = [
  ...allowedHosts.image,
  ...allowedHosts.thumbnail,
];

const youtubeRedirectHosts = new Set(['youtube.com', 'm.youtube.com']);

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function parseHttpsUrl(rawUrl: string | null | undefined): URL | null {
  if (typeof rawUrl !== 'string') return null;

  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) return null;

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (parsedUrl.protocol !== 'https:') return null;
    if (parsedUrl.username !== '' || parsedUrl.password !== '') return null;
    return parsedUrl;
  } catch {
    return null;
  }
}

function getEffectiveSocialUrl(url: URL): URL | null {
  const host = normalizeHostname(url.hostname);
  if (!youtubeRedirectHosts.has(host) || url.pathname !== '/redirect') {
    return url;
  }

  return parseHttpsUrl(url.searchParams.get('q'));
}

export function sanitizeNovaUrl(rawUrl: string | null | undefined, provider: NovaUrlProvider): string | null {
  const parsedUrl = parseHttpsUrl(rawUrl);
  if (!parsedUrl) return null;

  const effectiveUrl = provider === 'image' ? parsedUrl : getEffectiveSocialUrl(parsedUrl);
  if (!effectiveUrl) return null;

  // Image kinds are matched exactly — no `www.` alias, no explicit port — because the
  // workers' `img-src` is derived from the same sets and a CSP host source admits
  // only that host on its default port; a stored variant would render as a broken image.
  const isImageKind = provider === 'image' || provider === 'thumbnail';
  const host = isImageKind ? effectiveUrl.hostname : normalizeHostname(effectiveUrl.hostname);
  if (!allowedHosts[provider].has(host)) return null;
  if (isImageKind && effectiveUrl.port !== '') return null;

  return effectiveUrl.href;
}


export type NovaUrlProvider = 'youtube' | 'twitter' | 'facebook' | 'instagram' | 'twitch' | 'image';

const allowedHosts: Record<NovaUrlProvider, ReadonlySet<string>> = {
  youtube: new Set(['youtube.com', 'm.youtube.com', 'youtu.be']),
  twitter: new Set(['twitter.com', 'mobile.twitter.com', 'x.com']),
  facebook: new Set(['facebook.com', 'm.facebook.com', 'fb.com']),
  instagram: new Set(['instagram.com']),
  twitch: new Set(['twitch.tv']),
  image: new Set(['yt3.ggpht.com', 'yt4.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com']),
};

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

  const host = normalizeHostname(effectiveUrl.hostname);
  if (!allowedHosts[provider].has(host)) return null;

  return effectiveUrl.href;
}


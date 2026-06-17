import type { Registry, SocialLinkKey, SocialLinks, StreamerConfig } from './types';

const socialLinkKeys = ['youtube', 'twitter', 'facebook', 'instagram', 'twitch'] as const satisfies readonly SocialLinkKey[];

const allowedSocialHosts: Record<SocialLinkKey, ReadonlySet<string>> = {
  youtube: new Set(['youtube.com', 'youtu.be', 'm.youtube.com']),
  twitter: new Set(['twitter.com', 'x.com']),
  facebook: new Set(['facebook.com', 'm.facebook.com']),
  instagram: new Set(['instagram.com']),
  twitch: new Set(['twitch.tv']),
};

// Hosts whose `/redirect?q=` endpoint must be unwrapped and re-validated
// against the platform allowlist (covers both the desktop and mobile host).
const youtubeRedirectHosts = new Set(['youtube.com', 'm.youtube.com']);

const socialLinkKeySet = new Set<string>(socialLinkKeys);

function parseHttpUrl(
  rawUrl: string | undefined,
  options: { requireHttps?: boolean } = {},
): URL | undefined {
  if (typeof rawUrl !== 'string') return undefined;

  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) return undefined;

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (options.requireHttps) {
      if (parsedUrl.protocol !== 'https:') return undefined;
    } else if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined;
    }
    if (parsedUrl.username !== '' || parsedUrl.password !== '') return undefined;
    return parsedUrl;
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isSocialLinkKey(key: string): key is SocialLinkKey {
  return socialLinkKeySet.has(key);
}

function isYouTubeRedirect(url: URL): boolean {
  return youtubeRedirectHosts.has(normalizeHostname(url.hostname)) && url.pathname === '/redirect';
}

function getEffectiveSocialUrl(url: URL): URL | undefined {
  if (!isYouTubeRedirect(url)) return url;
  return parseHttpUrl(url.searchParams.get('q') ?? undefined, { requireHttps: true });
}

function sanitizeSocialLink(platform: SocialLinkKey, rawUrl: string | undefined): string | undefined {
  const parsedUrl = parseHttpUrl(rawUrl, { requireHttps: true });
  if (!parsedUrl) return undefined;

  const effectiveUrl = getEffectiveSocialUrl(parsedUrl);
  if (!effectiveUrl) return undefined;

  const hostname = normalizeHostname(effectiveUrl.hostname);
  if (!allowedSocialHosts[platform].has(hostname)) return undefined;

  return effectiveUrl.href;
}

export function sanitizeExternalUrl(rawUrl: string | undefined): string | undefined {
  return parseHttpUrl(rawUrl)?.href;
}

export function sanitizeSocialLinks(socialLinks: Partial<Record<string, string>> | undefined): SocialLinks {
  const sanitizedLinks: SocialLinks = {};

  for (const [platform, rawUrl] of Object.entries(socialLinks ?? {})) {
    if (!isSocialLinkKey(platform)) continue;

    const sanitizedUrl = sanitizeSocialLink(platform, rawUrl);
    if (sanitizedUrl) {
      sanitizedLinks[platform] = sanitizedUrl;
    }
  }

  return sanitizedLinks;
}

export function sanitizeStreamerConfig(streamer: StreamerConfig): StreamerConfig {
  const sanitizedStreamer: StreamerConfig = {
    ...streamer,
    socialLinks: sanitizeSocialLinks(streamer.socialLinks),
  };

  const externalUrl = sanitizeExternalUrl(streamer.externalUrl);
  if (externalUrl) {
    sanitizedStreamer.externalUrl = externalUrl;
  } else {
    delete sanitizedStreamer.externalUrl;
  }

  return sanitizedStreamer;
}

export function sanitizeRegistry(registry: Registry): Registry {
  return {
    ...registry,
    streamers: registry.streamers.map(sanitizeStreamerConfig),
  };
}

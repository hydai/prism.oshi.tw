/**
 * Normalize a YouTube channel URL to a canonical form for dedup.
 * Accepts /@handle, /channel/UCxxx, /c/custom patterns.
 * Returns normalized URL or null if invalid.
 */
export function normalizeYoutubeChannelUrl(raw: string): string | null {
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

  // Remove trailing slashes and lowercase the path
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();

  // Match valid channel path patterns
  const match = path.match(/^\/(channel\/[^/]+|c\/[^/]+|@[^/]+)$/);
  if (!match) {
    return null;
  }

  return `https://www.youtube.com/${match[1]}`;
}

/**
 * Validate a slug: lowercase alphanumeric + hyphens, 2-50 chars.
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

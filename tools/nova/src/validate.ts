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

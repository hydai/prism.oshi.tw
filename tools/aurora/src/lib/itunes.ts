// Client-side iTunes duration fetching — ported from admin/src/itunes.ts
// Uses 4-strategy fallback: artist+title → cleaned_artist+title → title only → cleaned_title
// Rate-limited to 1 request per 3 seconds to avoid API throttling

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

// feat./ft. pattern (with optional parentheses)
const FEAT_RE = /\s*[（(]?\s*(?:feat\.?|ft\.?)\s+.+[）)]?\s*$/i;

// CJK and special punctuation
const CJK_PUNCT_RE = /[？！♪☆★〜~・「」『』【】（）《》〈〉♡♥→←↑↓…‥、。]+/g;

export function stripFeaturing(artist: string): string {
  return artist.replace(FEAT_RE, '').trim();
}

export function cleanTitle(title: string): string {
  return title.replace(CJK_PUNCT_RE, ' ').split(/\s+/).join(' ').trim();
}

interface ItunesResult {
  trackTimeMillis?: number;
  trackName?: string;
  artistName?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesResult[];
}

export interface DurationResult {
  durationSec: number | null;
  matchConfidence: string | null;
}

// Rate limiter: minimum 3 seconds between requests
let lastRequestTime = 0;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const minInterval = 3000;
  if (elapsed < minInterval) {
    await new Promise((resolve) => setTimeout(resolve, minInterval - elapsed));
  }
  lastRequestTime = Date.now();
}

async function itunesSearch(query: string): Promise<ItunesResult[]> {
  await waitForRateLimit();
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'song',
    country: 'JP',
    limit: '10',
  });
  const url = `${ITUNES_SEARCH_URL}?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as ItunesResponse;
  return data.results ?? [];
}

export async function fetchItunesDuration(
  artist: string,
  title: string,
): Promise<DurationResult> {
  const cleanedArtist = stripFeaturing(artist);
  const hasFeat = cleanedArtist !== artist;
  const cleanedT = cleanTitle(title);
  const hasSpecialPunct = cleanedT !== title;

  const strategies: [string, string][] = [
    [`${artist} ${title}`, 'exact'],
  ];
  if (hasFeat) {
    strategies.push([`${cleanedArtist} ${title}`, 'exact']);
  }
  strategies.push([title, 'fuzzy']);
  if (hasSpecialPunct) {
    strategies.push([cleanedT, 'fuzzy_cleaned']);
  }

  for (const [query, confidence] of strategies) {
    try {
      const results = await itunesSearch(query);
      if (results.length > 0) {
        const track = results[0];
        const ms = track.trackTimeMillis ?? 0;
        return {
          durationSec: ms > 0 ? Math.round(ms / 1000) : null,
          matchConfidence: confidence,
        };
      }
    } catch {
      continue;
    }
  }

  return { durationSec: null, matchConfidence: null };
}

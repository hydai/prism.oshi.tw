// Pure iTunes search-strategy and outcome logic shared by the worker and the admin UI.
// 4-strategy fallback ported from the original Python metadata.py:
// artist+title → cleaned_artist+title → title only → cleaned_title

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

export type MatchConfidence = 'exact' | 'fuzzy' | 'fuzzy_cleaned';

export interface SearchStrategy {
  query: string;
  confidence: MatchConfidence;
}

export function buildSearchStrategies(artist: string, title: string): SearchStrategy[] {
  const cleanedArtist = stripFeaturing(artist);
  const cleanedTitle = cleanTitle(title);

  const strategies: SearchStrategy[] = [{ query: `${artist} ${title}`, confidence: 'exact' }];
  if (cleanedArtist !== artist) {
    strategies.push({ query: `${cleanedArtist} ${title}`, confidence: 'exact' });
  }
  strategies.push({ query: title, confidence: 'fuzzy' });
  if (cleanedTitle !== title) {
    strategies.push({ query: cleanedTitle, confidence: 'fuzzy_cleaned' });
  }
  return strategies;
}

export interface ItunesTrack {
  trackTimeMillis?: number;
  trackName?: string;
  artistName?: string;
}

export function trackToDurationSec(track: ItunesTrack): number | null {
  const ms = track.trackTimeMillis ?? 0;
  return ms > 0 ? Math.round(ms / 1000) : null;
}

export function formatTrackLabel(track: ItunesTrack): string {
  if (track.artistName && track.trackName) {
    return `${track.artistName} — ${track.trackName}`;
  }
  return track.trackName ?? 'unknown track';
}

export type DurationFetchOutcome =
  | {
      status: 'found';
      durationSec: number;
      matchConfidence: MatchConfidence;
      matchedTrack: string;
      query: string;
      queriesTried: string[];
    }
  | { status: 'no-match'; queriesTried: string[] }
  | { status: 'rate-limited'; retryAfterSec: number | null; queriesTried: string[] }
  | {
      status: 'error';
      message: string;
      httpStatus: number | null;
      query: string;
      queriesTried: string[];
    };

export type OutcomeTone = 'success' | 'warning' | 'error';

export interface OutcomeSummary {
  tone: OutcomeTone;
  text: string;
}

export function summarizeDurationOutcome(outcome: DurationFetchOutcome): OutcomeSummary {
  switch (outcome.status) {
    case 'found':
      return {
        tone: 'success',
        text: `Found ${outcome.durationSec}s — ${outcome.matchConfidence} match (${outcome.matchedTrack}) via "${outcome.query}"`,
      };
    case 'no-match': {
      const count = outcome.queriesTried.length;
      const queries = outcome.queriesTried.map((q) => `"${q}"`).join(' / ');
      return {
        tone: 'warning',
        text: `No iTunes match after ${count} ${count === 1 ? 'query' : 'queries'}: ${queries}`,
      };
    }
    case 'rate-limited':
      return {
        tone: 'error',
        text: `iTunes rate limit (HTTP 429) — Apple allows ~20 searches/min per IP. Retry in ${outcome.retryAfterSec ?? '~60'}s.`,
      };
    case 'error':
      return {
        tone: 'error',
        text:
          outcome.httpStatus !== null
            ? `iTunes request failed (HTTP ${outcome.httpStatus}) on "${outcome.query}"`
            : `iTunes request failed on "${outcome.query}": ${outcome.message} — network/CORS problem, or Apple rate limiting this IP.`,
      };
  }
}

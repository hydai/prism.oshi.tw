// Browser-side iTunes duration fetching. This runs in the curator's browser on
// purpose: itunes.apple.com rate-limits per source IP, and Cloudflare Workers share
// a small egress IP pool whose quota is permanently exhausted by platform-wide
// traffic, so the worker-side path (admin/src/itunes.ts) gets HTTP 429 in production.

import {
  buildSearchStrategies,
  trackToDurationSec,
  formatTrackLabel,
  type DurationFetchOutcome,
  type ItunesTrack,
} from '../../../shared/itunes';

export { summarizeDurationOutcome } from '../../../shared/itunes';
export type { DurationFetchOutcome, OutcomeTone } from '../../../shared/itunes';

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

// Apple allows ~20 searches/min per IP; space requests so long batches stay under it.
const MIN_REQUEST_INTERVAL_MS = 3200;

let nextAllowedAt = 0;

async function paceRequest(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextAllowedAt - now);
  nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_REQUEST_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesTrack[];
}

export async function fetchItunesDuration(
  artist: string,
  title: string,
): Promise<DurationFetchOutcome> {
  const queriesTried: string[] = [];

  for (const { query, confidence } of buildSearchStrategies(artist, title)) {
    queriesTried.push(query);
    const params = new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      country: 'JP',
      limit: '10',
    });

    await paceRequest();

    let resp: Response;
    try {
      resp = await fetch(`${ITUNES_SEARCH_URL}?${params}`);
    } catch (err) {
      // Opaque network/CORS failure. Apple's 429 page may lack CORS headers, so a
      // rate-limited response can surface here as a TypeError instead of status 429.
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        httpStatus: null,
        query,
        queriesTried,
      };
    }

    if (resp.status === 429) {
      const retryAfter = Number(resp.headers.get('Retry-After'));
      return {
        status: 'rate-limited',
        retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        queriesTried,
      };
    }
    if (!resp.ok) {
      return {
        status: 'error',
        message: resp.statusText || `HTTP ${resp.status}`,
        httpStatus: resp.status,
        query,
        queriesTried,
      };
    }

    let data: ItunesResponse;
    try {
      data = (await resp.json()) as ItunesResponse;
    } catch {
      return {
        status: 'error',
        message: 'invalid JSON response',
        httpStatus: resp.status,
        query,
        queriesTried,
      };
    }

    const track = data.results?.[0];
    if (track) {
      const durationSec = trackToDurationSec(track);
      if (durationSec !== null) {
        return {
          status: 'found',
          durationSec,
          matchConfidence: confidence,
          matchedTrack: formatTrackLabel(track),
          query,
          queriesTried,
        };
      }
      // Top hit has no duration listed — fall through to the next strategy.
    }
  }

  return { status: 'no-match', queriesTried };
}

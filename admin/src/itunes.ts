// iTunes duration fetching — worker-side IO around shared strategy logic.
// CAUTION: itunes.apple.com rate-limits per source IP and Cloudflare Workers share a
// small egress IP pool whose quota is permanently exhausted by platform-wide traffic,
// so this path gets HTTP 429 in production. The admin UI fetches durations from the
// curator's browser instead (admin/ui/src/lib/itunes.ts); this stays for the legacy
// /api/performances/:id/fetch-duration endpoint.

import {
  buildSearchStrategies,
  trackToDurationSec,
  type ItunesTrack,
  type MatchConfidence,
} from '../shared/itunes';

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

interface ItunesResponse {
  resultCount: number;
  results: ItunesTrack[];
}

export interface DurationResult {
  durationSec: number | null;
  matchConfidence: MatchConfidence | null;
}

async function itunesSearch(query: string): Promise<ItunesTrack[]> {
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'song',
    country: 'JP',
    limit: '10',
  });
  const url = `${ITUNES_SEARCH_URL}?${params}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'MizukiLens/1.0 (MizukiPrism curator tool)' },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as ItunesResponse;
  return data.results ?? [];
}

export async function fetchItunesDuration(
  artist: string,
  title: string,
): Promise<DurationResult> {
  for (const { query, confidence } of buildSearchStrategies(artist, title)) {
    try {
      const results = await itunesSearch(query);
      if (results.length > 0) {
        return {
          durationSec: trackToDurationSec(results[0]),
          matchConfidence: confidence,
        };
      }
    } catch {
      continue;
    }
  }

  return { durationSec: null, matchConfidence: null };
}

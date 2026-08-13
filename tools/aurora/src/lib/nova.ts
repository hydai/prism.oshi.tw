const NOVA_ORIGIN = 'https://nova.oshi.tw';

export interface StreamerOption {
  slug: string;
  display_name: string;
  avatar_url: string;
}

interface VideoInfo {
  date?: unknown;
}

async function requestNovaJson<T>(
  path: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${NOVA_ORIGIN}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`Nova API request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function isStreamerOption(value: unknown): value is StreamerOption {
  if (!value || typeof value !== 'object') return false;
  const streamer = value as Record<string, unknown>;
  return typeof streamer.slug === 'string'
    && typeof streamer.display_name === 'string'
    && typeof streamer.avatar_url === 'string';
}

export async function loadNovaStreamers(
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamerOption[]> {
  const data = await requestNovaJson<unknown>('/vod/api/streamers', signal, fetchImpl);
  if (!Array.isArray(data) || !data.every(isStreamerOption)) {
    throw new Error('Nova streamer response has an invalid shape');
  }
  return data;
}

export async function loadNovaVideoDate(
  videoUrl: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const info = await requestNovaJson<VideoInfo>(
    `/vod/api/video-info?url=${encodeURIComponent(videoUrl)}`,
    signal,
    fetchImpl,
  );
  return typeof info.date === 'string' && info.date.length > 0 ? info.date : null;
}

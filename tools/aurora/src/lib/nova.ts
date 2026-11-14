export const NOVA_ORIGIN = 'https://nova.oshi.tw';

export interface StreamerOption {
  slug: string;
  display_name: string;
  avatar_url: string;
}

interface VideoInfo {
  date?: unknown;
}

interface CurrentList {
  archived: boolean;
  text: string;
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

function isCurrentList(value: unknown): value is CurrentList {
  if (!value || typeof value !== 'object') return false;
  const list = value as Record<string, unknown>;
  return typeof list.archived === 'boolean' && typeof list.text === 'string';
}

/**
 * The public song list of an archived VOD as paste text, which `parseTextToSongs` reads back.
 * Anything that is not archived is a 200 `{ archived: false, text: '' }`, so a non-2xx answer
 * (403 for an untrusted request, 400 for a bad URL) or a malformed body is a failure to load.
 */
export async function loadNovaCurrentList(
  streamerSlug: string,
  videoUrl: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ archived: boolean; text: string }> {
  const data = await requestNovaJson<unknown>(
    `/vod/api/current?streamer_slug=${encodeURIComponent(streamerSlug)}&url=${encodeURIComponent(videoUrl)}`,
    signal,
    fetchImpl,
  );
  if (!isCurrentList(data)) {
    throw new Error('Nova current list response has an invalid shape');
  }
  return { archived: data.archived, text: data.text };
}

/** What Aurora tells the curator after Nova answers a submission (201, 422 `no_changes`, or any error). */
export function submitResultMessage(
  status: number,
  data: unknown,
): { type: 'success' | 'error'; message: string } {
  const answer: { id?: unknown; kind?: unknown; error?: unknown } =
    data !== null && typeof data === 'object' ? data : {};

  if (status === 201) {
    return {
      type: 'success',
      message: answer.kind === 'correction'
        ? `修正已送出！ID: ${answer.id}`
        : `提交成功！ID: ${answer.id}`,
    };
  }
  if (status === 422 && answer.error === 'no_changes') {
    return { type: 'error', message: '與目前歌單相同，沒有需要修正的地方' };
  }
  return {
    type: 'error',
    message: typeof answer.error === 'string' && answer.error !== '' ? answer.error : '提交失敗，請稍後再試',
  };
}

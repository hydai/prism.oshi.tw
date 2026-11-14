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
  revision?: string;
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
  return typeof list.archived === 'boolean'
    && typeof list.text === 'string'
    && (list.revision === undefined || typeof list.revision === 'string');
}

/**
 * The public song list of an archived VOD as paste text, which `parseTextToSongs` reads back, and its
 * revision: a submission sends the revision back as `base_revision`, and Nova refuses it (409
 * `list_changed`) if the list changed since it was loaded. `revision` is null when Nova gave none: for
 * anything not archived, and from a Nova that predates revisions.
 * Anything that is not archived is a 200 `{ archived: false, text: '' }`, so a non-2xx answer
 * (403 for an untrusted request, 400 for a bad URL) or a malformed body is a failure to load.
 */
export async function loadNovaCurrentList(
  streamerSlug: string,
  videoUrl: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ archived: boolean; text: string; revision: string | null }> {
  const data = await requestNovaJson<unknown>(
    `/vod/api/current?streamer_slug=${encodeURIComponent(streamerSlug)}&url=${encodeURIComponent(videoUrl)}`,
    signal,
    fetchImpl,
  );
  if (!isCurrentList(data)) {
    throw new Error('Nova current list response has an invalid shape');
  }
  return { archived: data.archived, text: data.text, revision: data.revision ?? null };
}

/**
 * What Aurora tells the curator after Nova answers a submission (201, 422 `no_changes`, 409 `list_changed`,
 * or any error). `no_changes` is a notice, not an error: the list repeats the archived one, so there is
 * nothing to fix. `list_changed` is an error: the archived list changed after it was loaded, so the
 * correction has to be made again against a reload.
 */
export function submitResultMessage(
  status: number,
  data: unknown,
): { type: 'success' | 'notice' | 'error'; message: string } {
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
    return { type: 'notice', message: '與目前歌單相同，沒有需要修正的地方' };
  }
  if (status === 409 && answer.error === 'list_changed') {
    return {
      type: 'error',
      message: '目前歌單在你載入之後更新過了。請按「載入目前歌單」重新載入（會取代編輯器裡的內容），再修正一次。',
    };
  }
  return {
    type: 'error',
    message: typeof answer.error === 'string' && answer.error !== '' ? answer.error : '提交失敗，請稍後再試',
  };
}

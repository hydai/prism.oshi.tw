export interface YouTubePlayer {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  loadVideoById: (videoIdOrOptions: string | { videoId: string; startSeconds?: number }) => void;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
}

export interface YouTubeReadyEvent {
  target: YouTubePlayer;
}

export interface YouTubePlayerEventWithData<TData = number> {
  target: YouTubePlayer;
  data: TData;
}

export interface YouTubePlayerOptions {
  height: string;
  width: string;
  videoId?: string;
  playerVars?: Record<string, string | number | undefined>;
  events?: {
    onReady?: (event: YouTubeReadyEvent) => void;
    onStateChange?: (event: YouTubePlayerEventWithData<number>) => void;
    onError?: (event: YouTubePlayerEventWithData<number>) => void;
  };
}

export interface YouTubeNamespace {
  Player: new (elementId: string | HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

export interface YouTubeApiHost {
  YT?: YouTubeNamespace;
  onYouTubeIframeAPIReady?: () => void;
}

export interface ScriptDocument {
  createElement(tag: 'script'): HTMLScriptElement;
  getElementsByTagName(tag: 'script'): ArrayLike<{ parentNode: { insertBefore(node: unknown, ref: unknown): unknown } | null }>;
  head: { appendChild(node: unknown): unknown } | null;
}

const apiLoadCache = new WeakMap<YouTubeApiHost, Promise<YouTubeNamespace>>();

// Injects the YouTube IFrame API script on demand. Idempotent per window:
// concurrent callers share one in-flight load, a successful load is cached,
// and a failed load clears the cache so the next call can retry.
export function loadYouTubeIframeApi(
  win: YouTubeApiHost,
  doc: ScriptDocument,
  timeoutMs = 10000,
): Promise<YouTubeNamespace> {
  if (win.YT?.Player) return Promise.resolve(win.YT);

  const cached = apiLoadCache.get(win);
  if (cached) return cached;

  const pending = new Promise<YouTubeNamespace>((resolve, reject) => {
    const fail = (error: Error) => {
      clearTimeout(timer);
      apiLoadCache.delete(win);
      reject(error);
    };
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => fail(new Error('YouTube IFrame API load timed out')),
      timeoutMs,
    );

    win.onYouTubeIframeAPIReady = () => {
      if (win.YT?.Player) {
        clearTimeout(timer);
        resolve(win.YT);
      } else {
        fail(new Error('YouTube IFrame API missing after ready callback'));
      }
    };

    const tag = doc.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => fail(new Error('YouTube IFrame API script failed to load'));

    const firstScript = doc.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(tag, firstScript);
    } else {
      doc.head?.appendChild(tag);
    }
  });

  apiLoadCache.set(win, pending);
  return pending;
}

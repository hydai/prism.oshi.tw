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

export interface YouTubePlayerEvent<TData = number> {
  target: YouTubePlayer;
  data: TData;
}

export interface YouTubePlayerOptions {
  height: string;
  width: string;
  videoId?: string;
  playerVars?: Record<string, string | number | undefined>;
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubePlayerEvent<number>) => void;
    onError?: (event: YouTubePlayerEvent<number>) => void;
  };
}

export interface YouTubeNamespace {
  Player: new (elementId: string | HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

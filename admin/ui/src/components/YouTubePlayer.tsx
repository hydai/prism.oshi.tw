import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';

// Minimal YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (
        el: string | HTMLElement,
        opts: {
          height?: string;
          width?: string;
          videoId?: string;
          playerVars?: Record<string, number>;
          events?: {
            onReady?: () => void;
          };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  loadVideoById(videoId: string): void;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

export interface YouTubePlayerHandle {
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
  loadVideo: (videoId: string) => void;
}

interface Props {
  videoId?: string;
  onReady?: () => void;
}

let apiLoaded = false;
let apiLoading = false;
const readyCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  if (apiLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    if (apiLoading) {
      readyCallbacks.push(resolve);
      return;
    }
    apiLoading = true;
    readyCallbacks.push(resolve);

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);

    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true;
      apiLoading = false;
      for (const cb of readyCallbacks) cb();
      readyCallbacks.length = 0;
    };
  });
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(
  function YouTubePlayer({ videoId, onReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YTPlayer | null>(null);
    const readyRef = useRef(false);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    const initPlayer = useCallback((vid: string) => {
      if (!containerRef.current) return;
      // Destroy existing player
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
        readyRef.current = false;
      }
      // Clear container safely (remove all child nodes)
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
      // Create a fresh div for the player
      const el = document.createElement('div');
      containerRef.current.appendChild(el);

      playerRef.current = new window.YT.Player(el, {
        height: '100%',
        width: '100%',
        videoId: vid,
        playerVars: { autoplay: 0, rel: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            onReadyRef.current?.();
          },
        },
      });
    }, []);

    useEffect(() => {
      if (!videoId) return;
      loadYouTubeAPI().then(() => {
        if (playerRef.current && readyRef.current) {
          playerRef.current.loadVideoById(videoId);
        } else {
          initPlayer(videoId);
        }
      });
    }, [videoId, initPlayer]);

    useEffect(() => {
      return () => {
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
      };
    }, []);

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => {
        if (playerRef.current && readyRef.current) {
          return playerRef.current.getCurrentTime();
        }
        return 0;
      },
      seekTo: (seconds: number) => {
        if (playerRef.current && readyRef.current) {
          playerRef.current.seekTo(seconds, true);
        }
      },
      loadVideo: (vid: string) => {
        if (playerRef.current && readyRef.current) {
          playerRef.current.loadVideoById(vid);
        } else {
          loadYouTubeAPI().then(() => initPlayer(vid));
        }
      },
    }));

    return (
      <div
        ref={containerRef}
        className="aspect-video w-full overflow-hidden rounded-lg bg-black"
      />
    );
  },
);

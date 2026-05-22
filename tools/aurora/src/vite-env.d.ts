/// <reference types="vite/client" />

import type { YouTubeNamespace } from "../../../lib/youtube-iframe";

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export {};

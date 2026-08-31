import type { Page } from '@playwright/test';

// Deterministic stand-in for https://www.youtube.com/iframe_api — no spec may
// load the real player: CI has no business talking to YouTube, and local runs
// must not depend on the network. Fires onReady on a macrotask like the real API.
export const FAKE_IFRAME_API = `
window.YT = {
  Player: class FakeYtPlayer {
    constructor(elementId, config) {
      this.config = config;
      this.videoId = config.videoId;
      this.currentTime = (config.playerVars && config.playerVars.start) || 0;
      this.duration = 36000;
      this.volume = 100;
      this.muted = false;
      this.destroyed = false;
      this.calls = [];
      window.__ytPlayers = window.__ytPlayers || [];
      window.__ytPlayers.push(this);
      window.__ytLast = this;
      setTimeout(() => {
        if (this.config.events && this.config.events.onReady) {
          this.config.events.onReady({ target: this });
        }
      }, 0);
    }
    log(name, args) { this.calls.push({ name, args: args || [] }); }
    getDuration() { return this.duration; }
    getCurrentTime() { return this.currentTime; }
    getPlayerState() { return 1; }
    getVideoData() { return { video_id: this.videoId }; }
    playVideo() { this.log('playVideo'); this.fire(1); }
    pauseVideo() { this.log('pauseVideo'); this.fire(2); }
    seekTo(seconds) { this.log('seekTo', [seconds]); this.currentTime = seconds; }
    loadVideoById(opts) {
      this.log('loadVideoById', [opts]);
      this.videoId = opts.videoId;
      this.currentTime = opts.startSeconds || 0;
      setTimeout(() => this.fire(1), 0);
    }
    setVolume(v) { this.log('setVolume', [v]); this.volume = v; }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    destroy() { this.destroyed = true; }
    fire(data) {
      const events = this.config.events;
      if (events && events.onStateChange) events.onStateChange({ target: this, data });
    }
    fireError(code) {
      const events = this.config.events;
      if (events && events.onError) events.onError({ target: this, data: code });
    }
  },
};
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

export async function stubYouTubeIframeApi(page: Page): Promise<void> {
  await page.route('**/iframe_api*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: FAKE_IFRAME_API }),
  );
}

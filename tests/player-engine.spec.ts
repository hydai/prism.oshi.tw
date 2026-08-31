import { test, expect, type Page } from '@playwright/test';

// Characterization suite for the playback engine. The YouTube IFrame API is
// stubbed at the network layer so every player event is deterministic and no
// real video ever loads. Written against the pre-store PlayerContext; the
// createPlayerStore rewrite must keep every test green.

const FAKE_IFRAME_API = `
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

interface FakePlayerView {
  videoId: string;
  currentTime: number;
  calls: { name: string; args: unknown[] }[];
  playerCount: number;
}

async function readLastPlayer(page: Page): Promise<FakePlayerView> {
  return page.evaluate(() => {
    type Fake = {
      videoId: string;
      currentTime: number;
      calls: { name: string; args: unknown[] }[];
    };
    const w = window as unknown as { __ytPlayers?: Fake[]; __ytLast?: Fake };
    const last = w.__ytLast!;
    return {
      videoId: last.videoId,
      currentTime: last.currentTime,
      calls: last.calls,
      playerCount: (w.__ytPlayers ?? []).length,
    };
  });
}

async function startPlayAll(page: Page) {
  await page.route('**/iframe_api*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: FAKE_IFRAME_API }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/mizuki');
  await expect(page.getByTestId('total-performance-count')).not.toHaveText('0');
  await page.getByTestId('desktop-play-all-button').click();
  await expect(page.getByTestId('mini-player')).toBeVisible();
  // Wait for the fake player to exist and finish its async onReady.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __ytLast?: unknown }).__ytLast !== undefined))
    .toBe(true);
  await expect(page.getByTestId('mini-player-play-button')).toHaveAttribute('aria-label', 'Pause');
}

// The "開啟正在播放" (open now-playing) control is rendered twice — once in the
// mobile mini-player, once in the desktop one — both mounted at once and
// switched by CSS (`lg:hidden` / `hidden lg:block`), not JS. At the 1280x900
// viewport used here only the desktop <button> is visible, so scope to that
// one to avoid a Playwright strict-mode violation on two matches.
function nowPlayingTitle(page: Page) {
  return page
    .getByTestId('mini-player')
    .locator('button[aria-label^="開啟正在播放"]:visible');
}

test('play-all creates a player for the first track and starts playback', async ({ page }) => {
  await startPlayAll(page);
  const player = await readLastPlayer(page);
  expect(player.playerCount).toBe(1);
  expect(player.videoId).not.toBe('');
  // onReady seeks to the track timestamp and starts playback.
  const callNames = player.calls.map((c) => c.name);
  expect(callNames).toContain('seekTo');
  expect(callNames).toContain('playVideo');
});

test('mini-player toggles pause and play against the iframe', async ({ page }) => {
  await startPlayAll(page);
  const button = page.getByTestId('mini-player-play-button');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Play');
  let player = await readLastPlayer(page);
  expect(player.calls.map((c) => c.name)).toContain('pauseVideo');

  const playCallsBefore = player.calls.filter((c) => c.name === 'playVideo').length;
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Pause');
  player = await readLastPlayer(page);
  expect(player.calls.filter((c) => c.name === 'playVideo').length).toBeGreaterThan(playCallsBefore);
});

test('next advances within the queue; previous returns through history', async ({ page }) => {
  await startPlayAll(page);
  const first = await readLastPlayer(page);
  const firstTitle = await nowPlayingTitle(page).getAttribute('aria-label');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect
    .poll(async () => {
      const now = await readLastPlayer(page);
      return now.videoId !== first.videoId || now.currentTime !== first.currentTime;
    })
    .toBe(true);
  await expect(page.getByTestId('mini-player-play-button')).toHaveAttribute('aria-label', 'Pause');

  // Just advanced, so <3s played: previous pops history back to the first track.
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect
    .poll(async () => {
      const now = await readLastPlayer(page);
      return now.videoId === first.videoId && now.currentTime === first.currentTime;
    })
    .toBe(true);
  const restoredTitle = await nowPlayingTitle(page).getAttribute('aria-label');
  expect(restoredTitle).toBe(firstTitle);
});

test('previous after 3 seconds restarts the current track', async ({ page }) => {
  await startPlayAll(page);
  const first = await readLastPlayer(page);
  const startSeconds = first.currentTime;
  // Advance the fake clock; the 500ms poll copies it into the time store.
  await page.evaluate((seconds) => {
    (window as unknown as { __ytLast: { currentTime: number } }).__ytLast.currentTime = seconds;
  }, startSeconds + 10);
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect
    .poll(async () => {
      const now = await readLastPlayer(page);
      const seeks = now.calls.filter((c) => c.name === 'seekTo');
      return seeks.some((c) => c.args[0] === startSeconds) && now.videoId === first.videoId;
    })
    .toBe(true);
});

test('an ENDED event auto-advances to the next queue entry', async ({ page }) => {
  await startPlayAll(page);
  const first = await readLastPlayer(page);
  await page.evaluate(() => {
    (window as unknown as { __ytLast: { fire: (d: number) => void } }).__ytLast.fire(0);
  });
  await expect
    .poll(async () => {
      const now = await readLastPlayer(page);
      return now.videoId !== first.videoId || now.currentTime !== first.currentTime;
    })
    .toBe(true);
  await expect(page.getByTestId('mini-player-play-button')).toHaveAttribute('aria-label', 'Pause');
});

test('repeat-one replays the same track on ENDED', async ({ page }) => {
  await startPlayAll(page);
  const first = await readLastPlayer(page);
  const repeat = page.getByTestId('desktop-repeat-button');
  await repeat.click(); // off -> all
  await repeat.click(); // all -> one
  await page.evaluate(() => {
    (window as unknown as { __ytLast: { fire: (d: number) => void } }).__ytLast.fire(0);
  });
  await expect
    .poll(async () => {
      const now = await readLastPlayer(page);
      const seeks = now.calls.filter((c) => c.name === 'seekTo');
      return now.videoId === first.videoId && seeks.some((c) => c.args[0] === first.currentTime);
    })
    .toBe(true);
});

test('reaching endTimestamp advances via the playback poll', async ({ page }) => {
  await startPlayAll(page);
  const first = await readLastPlayer(page);
  // Look up the playing performance in the archive data to learn its endTimestamp.
  const response = await page.request.get('/api/mizuki/songs');
  const songs = (await response.json()) as {
    performances: { videoId: string; timestamp: number; endTimestamp: number | null }[];
  }[];
  const performance = songs
    .flatMap((song) => song.performances)
    .find((p) => p.videoId === first.videoId && p.timestamp === first.currentTime);
  test.skip(!performance || performance.endTimestamp == null, 'first play-all track has no endTimestamp');

  await page.evaluate((seconds) => {
    (window as unknown as { __ytLast: { currentTime: number } }).__ytLast.currentTime = seconds;
  }, performance!.endTimestamp! + 1);
  await expect
    .poll(
      async () => {
        const now = await readLastPlayer(page);
        return now.videoId !== first.videoId || now.currentTime !== first.currentTime;
      },
      { timeout: 3000 },
    )
    .toBe(true);
});

test('an embed-restricted error surfaces the player error message', async ({ page }) => {
  await startPlayAll(page);
  await page.evaluate(() => {
    (window as unknown as { __ytLast: { fireError: (c: number) => void } }).__ytLast.fireError(150);
  });
  await expect(page.getByTestId('player-error-message')).toHaveText('此影片已無法播放');
});

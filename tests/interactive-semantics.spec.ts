import { test, expect } from '@playwright/test';

test.describe('interactive semantics', () => {
  test('opens and closes the create-playlist dialog from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    const createButton = page.getByTestId('create-playlist-button');
    await createButton.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('create-playlist-dialog')).toBeVisible();

    const backdrop = page.getByTestId('create-playlist-backdrop');
    await expect(backdrop).toHaveRole('button');
    await backdrop.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('create-playlist-dialog')).toBeHidden();
  });

  test('plays a timeline row from its semantic title control', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    const titleButton = page.getByTestId('performance-row').first().getByTestId('song-title-button');

    await titleButton.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('mini-player')).toBeVisible();
    await expect(page.getByRole('slider', { name: '播放進度' }).filter({ visible: true })).toBeVisible();
  });

  test('lets focused Aurora controls handle Space', async ({ page }) => {
    await page.goto('/mizuki/aurora');

    await page.getByTestId('vod-url-input').fill('https://www.youtube.com/watch?v=qgMiX4lw2TQ');
    await page.getByTestId('load-video-button').click();

    await page.getByTitle('鍵盤快捷鍵').click();
    const shortcutBackdrop = page.getByRole('button', { name: '關閉鍵盤快捷鍵' });
    await shortcutBackdrop.focus();
    await page.keyboard.press('Space');
    await expect(shortcutBackdrop).toBeHidden();

    await page.getByTestId('add-song-button').click();
    const titleButton = page.getByTestId('song-list-editor').getByRole('button', { name: '歌名' });
    await titleButton.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('song-list-editor').getByRole('textbox')).toBeVisible();
  });

  test('disables seeking when a performance has no known duration', async ({ page }) => {
    await page.route('**/api/mizuki/songs', async (route) => {
      await route.fulfill({
        json: [{
          id: 'song-unknown-duration',
          title: '未知時長',
          originalArtist: 'QA Artist',
          tags: [],
          performances: [{
            id: 'performance-unknown-duration',
            streamId: 'stream-unknown-duration',
            videoId: 'qgMiX4lw2TQ',
            timestamp: 0,
            endTimestamp: null,
          }],
        }],
      });
    });
    await page.route('**/api/mizuki/streams', async (route) => {
      await route.fulfill({
        json: [{
          id: 'stream-unknown-duration',
          title: 'QA Stream',
          date: '2026-08-13',
          videoId: 'qgMiX4lw2TQ',
        }],
      });
    });

    await page.goto('/mizuki');
    await page.getByTestId('performance-row').first().getByTestId('song-title-button').click();

    const progressSlider = page.getByRole('slider', { name: '播放進度' }).filter({ visible: true });
    await expect(progressSlider).toHaveAttribute('aria-disabled', 'true');
    await expect(progressSlider).toHaveAttribute('tabindex', '-1');
    await expect(progressSlider).toHaveAttribute('aria-valuetext', '歌曲時長不明，無法調整進度');
  });

  test('exposes player errors outside the labeled track button', async ({ page }) => {
    await page.addInitScript(() => {
      class MockPlayer {
        currentTime = 0;

        constructor(
          _elementId: string | HTMLElement,
          options: { events?: { onError?: (event: { target: MockPlayer; data: number }) => void } },
        ) {
          window.setTimeout(() => options.events?.onError?.({ target: this, data: 100 }), 0);
        }

        destroy() {}
        getCurrentTime() { return this.currentTime; }
        getDuration() { return 200; }
        getPlayerState() { return 1; }
        loadVideoById() {}
        mute() {}
        pauseVideo() {}
        playVideo() {}
        seekTo(seconds: number) { this.currentTime = seconds; }
        setVolume() {}
        unMute() {}
      }

      Object.defineProperty(window, 'YT', {
        configurable: true,
        value: { Player: MockPlayer },
      });
    });

    await page.goto('/mizuki');
    await page.getByTestId('performance-row').first().getByTestId('song-title-button').click();

    await expect(page.getByRole('status')).toHaveText('此影片已無法播放');
    await expect(page.getByRole('button', { name: /開啟正在播放/ }))
      .toHaveAccessibleDescription('此影片已無法播放');
  });
});

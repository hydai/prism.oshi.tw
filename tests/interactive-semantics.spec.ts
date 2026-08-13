import { test, expect } from '@playwright/test';

test.describe('interactive semantics', () => {
  test('exposes names for public search, navigation, filter, and playback controls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    await expect(page.getByRole('textbox', { name: '搜尋 VTuber' }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '回報 / 建議' }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Discord 伺服器' }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '新增 VOD' }).filter({ visible: true })).toBeVisible();

    await page.goto('/mizuki');

    await expect(page.getByRole('textbox', { name: '搜尋歌曲' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '依歌手篩選' })).toBeVisible();
    await expect(
      page.getByTestId('performance-row').first().getByRole('button', { name: /^播放 / }),
    ).toHaveAccessibleName(/^播放 .+/);
  });

  test('opens and closes the create-playlist dialog from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    const createButton = page.getByTestId('create-playlist-button');
    await createButton.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('create-playlist-dialog')).toBeVisible();
    const nameInput = page.getByTestId('playlist-name-input');
    await expect(nameInput).toBeFocused();
    await nameInput.fill('暫存播放清單');

    const backdrop = page.getByTestId('create-playlist-backdrop');
    await expect(backdrop).toHaveRole('button');
    await backdrop.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('create-playlist-dialog')).toBeHidden();

    await createButton.focus();
    await page.keyboard.press('Enter');
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toHaveValue('');
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

    await page.getByRole('textbox', { name: 'YouTube 歌枠網址' }).fill('https://www.youtube.com/watch?v=qgMiX4lw2TQ');
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
    const titleInput = page.getByTestId('song-list-editor').getByRole('textbox');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('測試歌曲');
    await page.keyboard.press('Enter');

    const updatedTitleButton = page
      .getByTestId('song-list-editor')
      .getByRole('button', { name: '測試歌曲', exact: true });
    await updatedTitleButton.focus();
    await page.keyboard.press('F2');
    await expect(titleInput).toHaveValue('測試歌曲');
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

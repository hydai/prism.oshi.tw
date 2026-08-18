import { test, expect } from '@playwright/test';

test('keeps a new Aurora bulk-fill status when the previous dismissal timer expires', async ({ page }) => {
  let searchRequests = 0;
  let signalSecondRequest = () => {};
  let releaseSecondResponse = () => {};
  const secondRequestStarted = new Promise<void>((resolve) => {
    signalSecondRequest = () => resolve();
  });
  const secondResponseGate = new Promise<void>((resolve) => {
    releaseSecondResponse = () => resolve();
  });

  await page.clock.install();
  await page.route('https://itunes.apple.com/search?**', async (route) => {
    searchRequests++;
    if (searchRequests === 2) {
      signalSecondRequest();
      await secondResponseGate;
    }
    await route.fulfill({
      json: {
        resultCount: 1,
        results: [{ trackTimeMillis: 180000, trackName: '測試歌曲', artistName: '測試歌手' }],
      },
    });
  });

  await page.goto('/mizuki/aurora');
  await page.getByRole('textbox', { name: 'YouTube 歌枠網址' }).fill(
    'https://www.youtube.com/watch?v=qgMiX4lw2TQ',
  );
  await page.getByTestId('load-video-button').click();

  await page.getByTestId('add-song-button').click();
  await page.getByRole('button', { name: '歌名' }).click();
  const nameInput = page.getByRole('textbox', { name: '第 1 首歌曲名稱' });
  await nameInput.fill('測試歌曲');
  await nameInput.press('Enter');

  const fillAllButton = page.getByTestId('fill-all-durations-button');
  await fillAllButton.click();
  await expect(fillAllButton).toContainText('完成：1 首填入，0 首未找到');
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));

  const songRow = page.getByTestId('song-row');
  await songRow.getByText('0:03:00', { exact: true }).dblclick();
  const endInput = songRow.getByRole('textbox', { name: '第 1 首結束時間' });
  await endInput.fill('');
  await endInput.press('Enter');

  await fillAllButton.click();
  await expect(fillAllButton).toContainText('填入中 1/1...');
  await page.clock.runFor(3000);
  await secondRequestStarted;
  await page.clock.runFor(2500);
  await expect(fillAllButton).toContainText('填入中 1/1...');
  releaseSecondResponse();
  await expect(fillAllButton).toContainText('完成：1 首填入，0 首未找到');
  expect(searchRequests).toBe(2);
});

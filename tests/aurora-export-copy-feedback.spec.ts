import { test, expect } from '@playwright/test';

test('scopes Aurora export copy feedback to the latest open dialog', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {} },
    });
  });

  await page.goto('/mizuki/aurora');
  await page.getByRole('textbox', { name: 'YouTube 歌枠網址' }).fill(
    'https://www.youtube.com/watch?v=qgMiX4lw2TQ',
  );
  await page.getByTestId('load-video-button').click();
  await page.getByTestId('add-song-button').click();
  await page.getByTestId('export-button').click();

  const copyButton = page.getByTestId('copy-export-button');
  await copyButton.click();
  await expect(copyButton).toContainText('已複製');
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));

  await page.clock.runFor(1500);
  await copyButton.click();
  await page.clock.runFor(600);
  await expect(copyButton).toContainText('已複製');

  await page.clock.runFor(1500);
  await expect(copyButton).toContainText('複製到剪貼簿');

  await copyButton.click();
  await expect(copyButton).toContainText('已複製');
  await page.getByRole('button', { name: '關閉匯出時間戳對話框' }).click();
  await page.getByTestId('export-button').click();
  await expect(copyButton).toContainText('複製到剪貼簿');

  await page.getByRole('button', { name: '關閉匯出視窗背景' }).click({
    position: { x: 10, y: 10 },
  });
  await expect(page.getByRole('dialog', { name: '匯出時間戳' })).toBeHidden();
});

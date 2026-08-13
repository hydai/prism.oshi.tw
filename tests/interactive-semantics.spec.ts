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
});

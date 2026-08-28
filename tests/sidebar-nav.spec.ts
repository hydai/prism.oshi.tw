import { test, expect } from '@playwright/test';

// The 瀏覽/熱門 entries were scaffold placeholders with no onClick since 2026-03-03.
test('desktop sidebar has no placeholder 瀏覽/熱門 entries', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/mizuki');

  await expect(page.getByRole('button', { name: '首頁' })).toBeVisible();
  await expect(page.getByRole('button', { name: '瀏覽' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '熱門' })).toHaveCount(0);
});

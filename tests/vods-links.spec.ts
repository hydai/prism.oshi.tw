import { test, expect } from '@playwright/test';
import registry from '../data/registry.json';

const streamer = registry.streamers.find((s) => s.enabled && !s.externalUrl)!;
const VODS_HOME = 'https://vods.oshi.tw';

test.describe('landing page vods links', () => {
  test('desktop sidebar has vods link', async ({ page }) => {
    await page.goto('/');
    const link = page.locator(`aside a[href="${VODS_HOME}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toContainText('歌回 VOD 資料庫');
  });

  test('mobile header has vods icon link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const link = page.locator(`header a[href="${VODS_HOME}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('aria-label', '歌回 VOD 資料庫');
  });
});

test.describe('streamer page vods links', () => {
  const vodsStreamerUrl = `https://vods.oshi.tw/?streamer=${streamer.slug}`;

  test('desktop sidebar has contextual vods link', async ({ page }) => {
    await page.goto(`/${streamer.slug}`);
    const link = page.locator(`aside a[href="${vodsStreamerUrl}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toContainText('歌回 VOD 資料庫');
  });

  test('mobile topbar has contextual vods icon link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${streamer.slug}`);
    const link = page
      .getByTestId('mobile-topbar')
      .locator(`a[href="${vodsStreamerUrl}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('aria-label', '歌回 VOD 資料庫');
  });
});

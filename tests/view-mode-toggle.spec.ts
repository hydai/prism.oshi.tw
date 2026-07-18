import { test, expect } from '@playwright/test';
import registry from '../data/registry.json';

const streamer = registry.streamers.find((entry) => entry.enabled && !entry.externalUrl)!;
const STREAMER_PATH = `/${streamer.slug}`;

test.describe('archive view mode toggle', () => {
  test('keeps the existing desktop controls', async ({ page }) => {
    await page.goto(STREAMER_PATH);

    const timeline = page.getByTestId('view-toggle-timeline');
    const grouped = page.getByTestId('view-toggle-grouped');

    await expect(timeline).toBeVisible();
    await expect(grouped).toBeVisible();
    await expect(timeline).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mobile-view-mode-bar')).toBeHidden();
  });

  test('lets mobile users switch views and keeps the choice after reload', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(STREAMER_PATH);

    const viewModeBar = page.getByTestId('mobile-view-mode-bar');
    const timeline = page.getByTestId('mobile-view-toggle-timeline');
    const grouped = page.getByTestId('mobile-view-toggle-grouped');

    await expect(viewModeBar).toBeVisible();
    await expect(timeline).toHaveAttribute('aria-pressed', 'true');
    await expect(grouped).toHaveAttribute('aria-pressed', 'false');
    expect(await timeline.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    await grouped.click();

    await expect(grouped).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('song-card').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('mizukiprism-view-mode'))).toBe('grouped');

    await page.reload();

    await expect(viewModeBar).toBeVisible();
    await expect(grouped).toHaveAttribute('aria-pressed', 'true');
    await timeline.click();
    await expect(timeline).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('performance-row').first()).toBeVisible();

    await page.getByTestId('bottom-nav-search').click();
    await expect(viewModeBar).toBeHidden();
  });

  test('uses the mobile controls below lg and desktop controls at lg', async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 844 });
    await page.goto(STREAMER_PATH);

    await expect(page.getByTestId('mobile-view-mode-bar')).toBeVisible();
    await expect(page.getByTestId('view-toggle-timeline')).toBeHidden();

    await page.setViewportSize({ width: 1024, height: 844 });

    await expect(page.getByTestId('mobile-view-mode-bar')).toBeHidden();
    await expect(page.getByTestId('view-toggle-timeline')).toBeVisible();
  });
});

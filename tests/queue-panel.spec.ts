import { test, expect } from '@playwright/test';
import { stubYouTubeIframeApi } from './helpers/fake-youtube';

// mizuki "play all" queues every performance (~5.4k). The panel must virtualize:
// only a viewport's worth of rows may exist in the DOM, and only ONE sheet variant.
test('queue panel virtualizes a full-catalog queue', async ({ page }) => {
  await stubYouTubeIframeApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/mizuki');

  const countEl = page.getByTestId('total-performance-count');
  await expect(countEl).not.toHaveText('0');
  const total = Number(await countEl.textContent());

  await page.getByTestId('desktop-play-all-button').click();
  await page.getByTestId('queue-button').click();

  const panel = page.getByTestId('queue-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`播放佇列 · ${total - 1} 首`)).toBeVisible();
  await expect(page.getByTestId('queue-panel-mobile')).toHaveCount(0);

  const rendered = await page.getByTestId('queue-item').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(60);
});

test('queue panel resets scroll position when reopened', async ({ page }) => {
  await stubYouTubeIframeApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/mizuki');

  const countEl = page.getByTestId('total-performance-count');
  await expect(countEl).not.toHaveText('0');

  await page.getByTestId('desktop-play-all-button').click();
  await page.getByTestId('queue-button').click();

  const panel = page.getByTestId('queue-panel');
  await expect(panel).toBeVisible();

  const content = panel.locator('.overflow-y-auto');
  await content.evaluate((element) => { element.scrollTop = 20000; });

  // Wait for the virtualizer to render rows far down the list before closing.
  await expect.poll(async () => {
    const indices = await panel.locator('[data-index]').evaluateAll(
      (nodes) => nodes.map((node) => Number(node.getAttribute('data-index'))),
    );
    return indices.length > 0 ? Math.max(...indices) : 0;
  }).toBeGreaterThan(100);

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await page.getByTestId('queue-button').click();
  await expect(panel).toBeVisible();

  await expect(panel.locator('[data-index="0"]').getByTestId('queue-item')).toBeVisible();
  const scrollTop = await panel.locator('.overflow-y-auto').evaluate((element) => element.scrollTop);
  expect(scrollTop).toBe(0);
});

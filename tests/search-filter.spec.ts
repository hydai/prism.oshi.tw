import { test, expect } from '@playwright/test';

// Characterization tests for archive search — guards the SearchBox extraction
test.describe('archive search', () => {
  test('desktop search narrows the timeline and clearing restores it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    const countEl = page.getByTestId('total-performance-count');
    await expect(countEl).not.toHaveText('0');
    const fullCount = Number(await countEl.textContent());

    const input = page.getByPlaceholder('搜尋歌曲...');
    await input.fill('Way Back Into Love');

    await expect
      .poll(async () => Number(await countEl.textContent()))
      .toBeLessThan(fullCount);
    await expect
      .poll(async () => Number(await countEl.textContent()))
      .toBeGreaterThan(0);

    await input.fill('');
    await expect
      .poll(async () => Number(await countEl.textContent()))
      .toBe(fullCount);
  });

  test('mobile search tab narrows results too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mizuki');

    const countEl = page.getByTestId('total-performance-count');
    await expect(countEl).not.toHaveText('0');
    const fullCount = Number(await countEl.textContent());

    await page.getByTestId('bottom-nav-search').click();
    await page.getByTestId('mobile-search-input').fill('Way Back');

    await expect
      .poll(async () => Number(await countEl.textContent()))
      .toBeLessThan(fullCount);
  });
});

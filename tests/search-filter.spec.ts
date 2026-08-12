import { test, expect } from '@playwright/test';

const taggedSongs = [
  {
    id: 'song-zh-rock',
    workId: 'work-zh-rock',
    title: '中文搖滾',
    originalArtist: 'Artist A',
    tags: ['language:zh', 'genre:rock'],
    performances: [{ id: 'perf-zh-rock', streamId: 'stream-a', videoId: 'video-a', timestamp: 10, endTimestamp: 20 }],
  },
  {
    id: 'song-en-rock',
    workId: 'work-en-rock',
    title: 'English Rock',
    originalArtist: 'Artist B',
    tags: ['language:en', 'genre:rock'],
    performances: [{ id: 'perf-en-rock', streamId: 'stream-b', videoId: 'video-b', timestamp: 20, endTimestamp: 30 }],
  },
  {
    id: 'song-zh-pop',
    workId: 'work-zh-pop',
    title: '中文流行',
    originalArtist: 'Artist C',
    tags: ['language:zh', 'genre:pop'],
    performances: [{ id: 'perf-zh-pop', streamId: 'stream-c', videoId: 'video-c', timestamp: 30, endTimestamp: 40 }],
  },
];

const taggedStreams = [
  { id: 'stream-a', title: 'Stream A', date: '2026-01-03', videoId: 'video-a' },
  { id: 'stream-b', title: 'Stream B', date: '2026-01-02', videoId: 'video-b' },
  { id: 'stream-c', title: 'Stream C', date: '2026-01-01', videoId: 'video-c' },
];

async function installTaggedArchive(page: import('@playwright/test').Page) {
  await page.route('**/api/mizuki/songs', (route) => route.fulfill({ json: taggedSongs }));
  await page.route('**/api/mizuki/streams', (route) => route.fulfill({ json: taggedStreams }));
}

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

test.describe('archive tag filters', () => {
  test('desktop uses OR within a category and AND across categories', async ({ page }) => {
    await installTaggedArchive(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    const countEl = page.getByTestId('total-performance-count');
    await expect(countEl).toHaveText('3');

    await page.locator('[data-tag-id="language:zh"]').first().click();
    await expect(countEl).toHaveText('2');

    await page.locator('[data-tag-id="language:en"]').first().click();
    await expect(countEl).toHaveText('3');

    await page.locator('[data-tag-id="genre:rock"]').first().click();
    await expect(countEl).toHaveText('2');

    await page.getByTestId('clear-all-filters').click();
    await expect(countEl).toHaveText('3');
  });

  test('mobile opens the tag sheet and filters results', async ({ page }) => {
    await installTaggedArchive(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mizuki');

    await page.getByTestId('bottom-nav-search').click();
    await page.getByTestId('mobile-tag-filter-button').click();
    const sheet = page.getByTestId('mobile-tag-filter-sheet-mobile');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-tag-id="language:zh"]').click();
    await sheet.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByTestId('total-performance-count')).toHaveText('2');
    await expect(page.getByTestId('mobile-tag-filter-button')).toContainText('已選 1');
  });
});

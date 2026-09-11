import { test, expect, type Page } from '@playwright/test';

const streams = [{ id: 'stream-2025', title: 'Stream 2025', date: '2025-03-01', videoId: 'qgMiX4lw2TQ' }];
const perf = (id: string) => ({ id, streamId: 'stream-2025', videoId: 'qgMiX4lw2TQ', timestamp: 0, endTimestamp: null });
const songs = [
  { id: 'song-ja', title: '夜に駆ける', originalArtist: 'YOASOBI', tags: ['language:ja'], performances: [perf('perf-ja')] },
  { id: 'song-ja-voc', title: '千本桜', originalArtist: '黒うさP', tags: ['language:ja', 'source:vocaloid'], performances: [perf('perf-ja-voc')] },
  { id: 'song-zh', title: '晴天', originalArtist: '周杰倫', tags: ['language:zh'], performances: [perf('perf-zh')] },
  { id: 'song-none', title: 'Untagged', originalArtist: 'Nobody', tags: [], performances: [perf('perf-none')] },
];

async function serveFixture(page: Page, fixtureSongs: unknown[]): Promise<void> {
  await page.route('**/api/mizuki/songs', (route) => route.fulfill({ json: fixtureSongs }));
  await page.route('**/api/mizuki/streams', (route) => route.fulfill({ json: streams }));
}

test.describe('tag filter', () => {
  test('desktop chips narrow the timeline: OR inside a category, AND across', async ({ page }) => {
    await serveFixture(page, songs);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    const count = page.getByTestId('total-performance-count');
    await expect(count).toHaveText('4');
    const chip = (id: string) => page.getByTestId('tag-filter-sidebar').locator(`[data-tag-id="${id}"]`);

    await chip('language:ja').click();
    await expect(chip('language:ja')).toHaveAttribute('aria-pressed', 'true');
    await expect(count).toHaveText('2');

    await chip('language:zh').click();
    await expect(count).toHaveText('3');

    await chip('source:vocaloid').click();
    await expect(count).toHaveText('1');

    await page.getByRole('button', { name: '清除全部' }).click();
    await expect(count).toHaveText('4');
    await expect(chip('language:ja')).toHaveAttribute('aria-pressed', 'false');
  });

  test('song cards show tag labels in the grouped view', async ({ page }) => {
    await serveFixture(page, songs);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    await page.getByTestId('view-toggle-grouped').click();
    const vocaloidCard = page.getByTestId('song-card').filter({ hasText: '千本桜' });
    await expect(vocaloidCard.getByTestId('song-card-tag')).toHaveText(['日文歌', 'Vocaloid']);
  });

  test('the chip row stays hidden while no song carries a tag', async ({ page }) => {
    await serveFixture(page, songs.map((song) => ({ ...song, tags: [] })));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mizuki');

    await expect(page.getByTestId('total-performance-count')).toHaveText('4');
    await expect(page.getByTestId('tag-filter-sidebar')).toHaveCount(0);
  });

  test('the mobile search tab offers the same chips', async ({ page }) => {
    await serveFixture(page, songs);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mizuki');

    await page.getByTestId('bottom-nav-search').click();
    const chips = page.getByTestId('tag-filter-mobile');
    await expect(chips).toBeVisible();
    await chips.locator('[data-tag-id="language:zh"]').click();
    await expect(page.getByTestId('total-performance-count')).toHaveText('1');
  });
});

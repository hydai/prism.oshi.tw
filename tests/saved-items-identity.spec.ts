import { test, expect, type Page } from '@playwright/test';
import { stubYouTubeIframeApi } from './helpers/fake-youtube';

// A tiny catalog served in place of /api/mizuki/{songs,streams}. The saved
// entries below point at it with stale titles/videos; one points nowhere.
const songs = [
  {
    id: 'song-live',
    workId: 'work-live',
    title: '目錄標題',
    originalArtist: '目錄歌手',
    tags: [],
    performances: [
      { id: 'perf-live', streamId: 'stream-1', videoId: 'aaaaaaaaaaa', timestamp: 10, endTimestamp: 40 },
      { id: 'perf-live-2', streamId: 'stream-1', videoId: 'aaaaaaaaaaa', timestamp: 100, endTimestamp: 130 },
    ],
  },
  {
    id: 'song-other',
    title: '另一首',
    originalArtist: '歌手 B',
    tags: [],
    performances: [{ id: 'perf-other', streamId: 'stream-1', videoId: 'bbbbbbbbbbb', timestamp: 0, endTimestamp: null }],
  },
];
const streams = [{ id: 'stream-1', title: '歌回 1', date: '2026-09-01', videoId: 'aaaaaaaaaaa' }];

// Legacy-shaped liked entry: no songId, no streamerSlug, no endTimestamp.
const legacyLiked = {
  performanceId: 'perf-live',
  songTitle: '舊標題',
  originalArtist: '舊歌手',
  videoId: 'zzzzzzzzzzz',
  timestamp: 1,
  likedAt: 1700000000000,
};
const legacyLikedGone = {
  performanceId: 'perf-gone',
  songTitle: '已刪除的版本',
  originalArtist: '舊歌手',
  videoId: 'yyyyyyyyyyy',
  timestamp: 5,
  likedAt: 1690000000000,
};
const playlist = {
  id: 'playlist-e2e',
  name: 'E2E 清單',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  versions: [
    { performanceId: 'perf-live', songId: 'song-live', songTitle: '舊標題', originalArtist: '舊歌手', videoId: 'zzzzzzzzzzz', timestamp: 1, endTimestamp: null, streamerSlug: 'mizuki' },
    { performanceId: 'perf-gone', songId: 'song-gone', songTitle: '已刪除的版本', originalArtist: '舊歌手', videoId: 'yyyyyyyyyyy', timestamp: 5, endTimestamp: null, streamerSlug: 'mizuki' },
  ],
};

async function seedLibrary(page: Page): Promise<void> {
  await page.addInitScript(({ liked, playlists }) => {
    window.localStorage.setItem('prism_mizuki_liked_songs', JSON.stringify(liked));
    window.localStorage.setItem('prism_mizuki_playlists', JSON.stringify(playlists));
  }, { liked: [legacyLiked, legacyLikedGone], playlists: [playlist] });
}

async function serveCatalog(page: Page, status: 200 | 500): Promise<void> {
  await page.route('**/api/mizuki/songs', (route) =>
    status === 200 ? route.fulfill({ json: songs }) : route.fulfill({ status }),
  );
  await page.route('**/api/mizuki/streams', (route) =>
    status === 200 ? route.fulfill({ json: streams }) : route.fulfill({ status }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubYouTubeIframeApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedLibrary(page);
});

test('saved items show catalog metadata and only truly missing performances are marked', async ({ page }) => {
  await serveCatalog(page, 200);
  await page.goto('/mizuki');
  await expect(page.getByTestId('total-performance-count')).toHaveText('3');

  // Liked: the legacy entry resolves to the catalog title, no marker.
  await page.getByTestId('view-liked-songs-button').click();
  const likedPanel = page.getByTestId('liked-songs-panel');
  await expect(likedPanel).toBeVisible();
  const likedItems = likedPanel.getByTestId('liked-song-item');
  await expect(likedItems).toHaveCount(2);
  const likedLive = likedItems.nth(0);
  await expect(likedLive).toContainText('目錄標題');
  await expect(likedLive).not.toContainText('舊標題');
  await expect(likedLive.getByTestId('deleted-version-marker')).toHaveCount(0);
  await expect(likedLive.getByTitle('播放', { exact: true })).toBeEnabled();
  // The missing entry keeps its snapshot, is marked, and cannot be played or queued.
  const likedGone = likedItems.nth(1);
  await expect(likedGone).toContainText('已刪除的版本');
  await expect(likedGone.getByTestId('deleted-version-marker')).toHaveText('此版本已無法播放');
  await expect(likedGone.getByTitle('播放', { exact: true })).toBeDisabled();
  await expect(likedGone.getByTitle('加入待播清單', { exact: true })).toBeDisabled();
  await expect(likedPanel.getByTestId('deleted-version-marker')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(likedPanel).toHaveCount(0);

  // Playlist: live entry re-titled, the bogus one marked — and only it.
  await page.getByTestId('view-playlists-button').click();
  const playlistPanel = page.getByTestId('playlist-panel');
  await expect(playlistPanel).toBeVisible();
  await playlistPanel.getByRole('button', { name: 'E2E 清單', exact: true }).click();
  const items = playlistPanel.getByTestId('playlist-version-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('目錄標題');
  await expect(items.nth(0).getByTestId('deleted-version-marker')).toHaveCount(0);
  await expect(items.nth(1)).toContainText('已刪除的版本');
  await expect(items.nth(1).getByTestId('deleted-version-marker')).toHaveText('此版本已無法播放');

  // Play all: the live entry plays with its catalog title; the missing one
  // sits in the queue, marked.
  await playlistPanel.getByTestId('play-all-button').click();
  await page.keyboard.press('Escape');
  await expect(playlistPanel).toHaveCount(0);
  await expect(page.getByTestId('mini-player')).toContainText('目錄標題');
  // D1: playback fields come from the catalog too — the stored videoId was 'zzzzzzzzzzz'.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ytLast?: { videoId?: string } }).__ytLast?.videoId)).toBe('aaaaaaaaaaa');
  await page.getByTestId('queue-button').click();
  const queuePanel = page.getByTestId('queue-panel');
  await expect(queuePanel).toBeVisible();
  const queueItem = queuePanel.getByTestId('queue-item');
  await expect(queueItem).toHaveCount(1);
  await expect(queueItem).toContainText('已刪除的版本');
  await expect(queueItem.getByTestId('deleted-version-marker')).toHaveText('此版本已無法播放');
});

test('nothing is marked while the catalog is unavailable', async ({ page }) => {
  await serveCatalog(page, 500);
  await page.goto('/mizuki');

  await page.getByTestId('view-liked-songs-button').click();
  const likedPanel = page.getByTestId('liked-songs-panel');
  const likedItems = likedPanel.getByTestId('liked-song-item');
  await expect(likedItems).toHaveCount(2);
  await expect(likedItems.nth(0)).toContainText('舊標題');
  await expect(likedPanel.getByTestId('deleted-version-marker')).toHaveCount(0);
  await expect(likedItems.nth(1).getByTitle('播放', { exact: true })).toBeEnabled();
  await likedItems.nth(0).getByTitle('播放', { exact: true }).click();
  await expect(page.getByTestId('mini-player')).toContainText('舊標題');
  await page.keyboard.press('Escape');

  await page.getByTestId('view-playlists-button').click();
  const playlistPanel = page.getByTestId('playlist-panel');
  await playlistPanel.getByRole('button', { name: 'E2E 清單', exact: true }).click();
  await expect(playlistPanel.getByTestId('playlist-version-item')).toHaveCount(2);
  await expect(playlistPanel.getByTestId('deleted-version-marker')).toHaveCount(0);
});

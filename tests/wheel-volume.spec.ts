import { test, expect, Page } from '@playwright/test';

const seedStorage = async (page: Page, vol = 50, muted = false) => {
  await page.addInitScript(([v, m]) => {
    localStorage.setItem('prism_volume', String(v));
    localStorage.setItem('prism_muted', String(m));
  }, [vol, muted] as const);
};

const startTrack = async (page: Page) => {
  await page.goto('/mizuki');
  // play-button is `opacity-0 group-hover:opacity-100` (TimelineRow.tsx) —
  // it's in the DOM but invisible until hover. force:true skips that
  // actionability check and dispatches the click directly.
  const playButton = page.locator('[data-testid="play-button"]').first();
  await playButton.waitFor({ state: 'attached' });
  await playButton.click({ force: true });
  await page.waitForSelector('[data-testid="mini-player"]');
};

const readVol = (page: Page) =>
  page.evaluate(() => Number(localStorage.getItem('prism_volume')));
const readMuted = (page: Page) =>
  page.evaluate(() => localStorage.getItem('prism_muted'));

test.describe('Mouse wheel volume control', () => {
  test('scroll up increases volume by 5%', async ({ page }) => {
    await seedStorage(page, 50);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    await ctrl.hover();
    await page.mouse.wheel(0, -100);

    await expect.poll(() => readVol(page)).toBe(55);
  });

  test('scroll down decreases volume by 5%', async ({ page }) => {
    await seedStorage(page, 50);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    await ctrl.hover();
    await page.mouse.wheel(0, 100);

    await expect.poll(() => readVol(page)).toBe(45);
  });

  test('clamps at 100', async ({ page }) => {
    await seedStorage(page, 98);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    await ctrl.hover();
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(150); // span the 100 ms throttle gate between events
    }

    await expect.poll(() => readVol(page)).toBe(100);
  });

  test('clamps at 0', async ({ page }) => {
    await seedStorage(page, 3);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    await ctrl.hover();
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(150); // span the 100 ms throttle gate between events
    }

    await expect.poll(() => readVol(page)).toBe(0);
  });

  test('auto-unmutes when scrolling up while muted', async ({ page }) => {
    await seedStorage(page, 50, true);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    await ctrl.hover();
    await page.mouse.wheel(0, -100);

    await expect.poll(() => readVol(page)).toBe(55);
    expect(await readMuted(page)).toBe('false');
  });

  test('100ms throttle bounds rapid wheel bursts', async ({ page }) => {
    await seedStorage(page, 50);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    // Fire 10 wheel events synchronously in a single microtask so the throttle
    // sees them all within sub-millisecond intervals — the touchpad-inertia
    // worst case. Only the first should land.
    await ctrl.evaluate((node) => {
      for (let i = 0; i < 10; i++) {
        node.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -10,
          bubbles: true,
          cancelable: true,
        }));
      }
    });

    await expect.poll(() => readVol(page)).toBe(55);
  });

  test('horizontal-only wheel passes through unprevented', async ({ page }) => {
    await seedStorage(page, 50);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    const wasPrevented = await ctrl.evaluate((node) => {
      const e = new WheelEvent('wheel', {
        deltaX: 100,
        deltaY: 0,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(e);
      return e.defaultPrevented;
    });

    expect(wasPrevented).toBe(false);
    expect(await readVol(page)).toBe(50);
  });

  test('Ctrl+wheel passes through unprevented for browser zoom', async ({ page }) => {
    await seedStorage(page, 50);
    await startTrack(page);

    const ctrl = page.getByTestId('volume-control').first();
    const wasPrevented = await ctrl.evaluate((node) => {
      const e = new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(e);
      return e.defaultPrevented;
    });

    expect(wasPrevented).toBe(false);
    expect(await readVol(page)).toBe(50);
  });
});

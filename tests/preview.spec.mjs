import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

function changedPixels(first, second) {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  return pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
}

async function ready(page, side) {
  const frame = page.frameLocator(`iframe[data-side="${side}"]`);
  await expect(frame.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  return frame.locator('canvas');
}

test('renders both Git revisions and keeps their interactions separate', async ({ page }) => {
  await page.goto('/');
  const before = await ready(page, 'before');
  const after = await ready(page, 'after');
  const beforeInitial = await before.screenshot();
  const afterInitial = await after.screenshot();
  await test.info().attach('before-initial', { body: beforeInitial, contentType: 'image/png' });
  await before.click({ position: { x: 115, y: 68 } });
  await expect.poll(async () => changedPixels(await before.screenshot(), beforeInitial)).toBeGreaterThan(100);
  expect(changedPixels(await after.screenshot(), afterInitial)).toBeLessThan(50);
  await page.getByRole('button', { name: 'Reset example' }).click();
  const reset = await ready(page, 'before');
  await test.info().attach('before-reset', { body: await reset.screenshot(), contentType: 'image/png' });
  await expect.poll(async () => changedPixels(await reset.screenshot(), beforeInitial)).toBeLessThan(50);
  await page.screenshot({ path: 'test-results/comparison.png', fullPage: true });
});

test('opens the after-only and component-only views', async ({ page }) => {
  await page.goto('/?view=after');
  await ready(page, 'after');
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('link', { name: 'Open component only' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('nav')).toHaveCount(0);
});

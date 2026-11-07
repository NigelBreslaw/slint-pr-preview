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

test('renders configured revisions and keeps their interactions separate', async ({ page }) => {
  const compare = (await (await page.request.get('/manifest.json')).json()).examples[0].mode === 'compare';
  await page.goto('/');
  const before = await ready(page, compare ? 'before' : 'after');
  const after = compare ? await ready(page, 'after') : null;
  await expect(page.locator('iframe')).toHaveCount(compare ? 2 : 1);
  if (!compare) await expect(page.getByRole('button', { name: 'Before and after' })).toBeDisabled();
  const beforeInitial = await before.screenshot();
  const afterInitial = after ? await after.screenshot() : null;
  await test.info().attach('before-initial', { body: beforeInitial, contentType: 'image/png' });
  await before.click({ position: { x: 115, y: 68 } });
  await expect.poll(async () => changedPixels(await before.screenshot(), beforeInitial)).toBeGreaterThan(100);
  if (after) expect(changedPixels(await after.screenshot(), afterInitial)).toBeLessThan(50);
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.getByRole('button', { name: 'Reset example' })).toBeEnabled();
  const reset = await ready(page, compare ? 'before' : 'after');
  await test.info().attach('before-reset', { body: await reset.screenshot(), contentType: 'image/png' });
  await expect.poll(async () => changedPixels(await reset.screenshot(), beforeInitial)).toBeLessThan(50);
  await page.screenshot({ path: 'test-results/comparison.png', fullPage: true });
});

test('reset and view changes retain players without fetching assets again', async ({ page }) => {
  const compare = (await (await page.request.get('/manifest.json')).json()).examples[0].mode === 'compare';
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  if (compare) await ready(page, 'before');
  await ready(page, 'after');
  const playerIds = await page.locator('iframe').evaluateAll(frames => frames.map(frame => {
    frame.contentWindow.retainedPlayerId = crypto.randomUUID();
    return frame.contentWindow.retainedPlayerId;
  }));
  const start = requests.length;
  if (compare) {
    await page.getByRole('button', { name: 'After only' }).click();
    await expect(page.locator('iframe[data-side="before"]')).toBeHidden();
    await page.getByRole('button', { name: 'Before and after' }).click();
    await expect(page.locator('iframe[data-side="before"]')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.getByRole('button', { name: 'Reset example' })).toBeEnabled();
  expect(await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.contentWindow.retainedPlayerId))).toEqual(playerIds);
  expect(requests.slice(start)).toEqual([]);
});

test('loads source bundles and one shared font without manifest or import requests', async ({ page }) => {
  const compare = (await (await page.request.get('/manifest.json')).json()).examples[0].mode === 'compare';
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  if (compare) await ready(page, 'before');
  await ready(page, 'after');
  expect(requests.filter(url => url.includes('/manifest.json') || url.endsWith('.slint') || url.includes('/player.html'))).toEqual([]);
  const fontUrls = [...new Set(requests.filter(url => url.endsWith('.ttf')))];
  expect(fontUrls).toHaveLength(1);
  const response = await page.request.get(fontUrls[0]);
  expect(response.headers()['cache-control']).toContain('immutable');
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

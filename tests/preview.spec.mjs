import { test, expect } from '@playwright/test';

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
  await before.click({ position: { x: 115, y: 68 } });
  await expect.poll(async () => (await before.screenshot()).equals(beforeInitial)).toBe(false);
  expect((await after.screenshot()).equals(afterInitial)).toBe(true);
  await page.getByRole('button', { name: 'Reset example' }).click();
  const reset = await ready(page, 'before');
  await expect.poll(async () => (await reset.screenshot()).equals(beforeInitial)).toBe(true);
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

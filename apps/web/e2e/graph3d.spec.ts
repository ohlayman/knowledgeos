import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('desktop defaults to 3d and persists plane view', async ({ page }) => {
  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  test.skip(!webgl, '本机 Playwright 无 WebGL');

  await page.goto('/graph');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('graph3d-view')).toBeVisible();

  await page.getByRole('button', { name: '平面', exact: true }).click();
  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();
});

test('mobile defaults to list view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 812 });
  await page.goto('/graph');
  await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('graph3d-view')).toHaveCount(0);
});

test('camera zoom changes position and reset restores it', async ({ page }) => {
  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  test.skip(!webgl, '本机 Playwright 无 WebGL');

  await page.goto('/graph');
  const view = page.getByTestId('graph3d-view');
  await expect(view).toBeVisible();
  const root = page.locator('[data-view-mode]');
  const canvas = page.locator('.graph-3d canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => root.getAttribute('data-camera'), { timeout: 10_000 })
    .not.toBe('0,0,620');
  const before = await root.getAttribute('data-camera');

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.wheel(0, -400);

  await expect
    .poll(async () => root.getAttribute('data-camera'), { timeout: 10_000 })
    .not.toBe(before);

  await page.getByRole('button', { name: '重置视图' }).click();
  await expect
    .poll(async () => root.getAttribute('data-camera'), { timeout: 10_000 })
    .toBe('0,0,620');
});

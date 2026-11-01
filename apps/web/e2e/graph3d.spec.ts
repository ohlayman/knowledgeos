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

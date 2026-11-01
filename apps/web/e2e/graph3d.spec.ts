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
    .not.toBe('0,0,450');
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
    .toBe('0,0,450');
});

test('hidden node list expands a node once', async ({ page }) => {
  let neighborRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/neighbors')) {
      neighborRequests += 1;
    }
  });

  await page.goto('/graph');
  const list = page.getByRole('list', { name: '图谱节点列表' });
  const first = list.getByRole('button').first();
  await expect(first).toBeAttached({ timeout: 15_000 });

  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '关闭' })).toBeVisible();
  const afterFirst = neighborRequests;

  await page.waitForTimeout(500);
  await first.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  expect(neighborRequests).toBe(afterFirst);
});

test('falls back to plane view when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto('/graph');
  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();
  await expect(page.getByText('当前设备不支持 3D')).toBeVisible();
});

test('falls back when the WebGL context is lost', async ({ page }) => {
  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  test.skip(!webgl, '本机 Playwright 无 WebGL');

  await page.goto('/graph');
  const canvas = page.locator('.graph-3d canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element) => {
    element.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });

  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();
  await expect(page.getByText('3D 上下文已丢失')).toBeVisible();
});

test('search focuses an existing node without clearing the view', async ({ page }) => {
  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  test.skip(!webgl, '本机 Playwright 无 WebGL');

  await page.goto('/graph');
  const first = page.getByRole('list', { name: '图谱节点列表' }).getByRole('button').first();
  await expect(first).toBeAttached({ timeout: 15_000 });
  const name = (await first.textContent())?.replace(/^节点\s*/, '') ?? '';
  test.skip(!name, '开发库没有可用的图谱节点');

  const root = page.locator('[data-view-mode]');
  const before = await root.getAttribute('data-camera');
  await page.getByLabel('搜索实体').fill(name);
  await page.getByRole('button', { name, exact: true }).first().click();

  await expect(page.getByRole('button', { name: '关闭' })).toBeVisible();
  await expect
    .poll(async () => root.getAttribute('data-camera'), { timeout: 10_000 })
    .not.toBe(before);
});

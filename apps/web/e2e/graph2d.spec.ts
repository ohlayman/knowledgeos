import { expect, test } from '@playwright/test';

const nodeA = {
  id: '2d-a',
  name: '2D Alpha',
  type: 'concept',
  aliases: [],
  mentionCount: 2,
  confidence: 0.8,
  mergedIntoId: null,
};
const nodeB = {
  id: '2d-b',
  name: '2D Beta',
  canonicalName: '2D Beta',
  normalizedName: '2d beta',
  status: 'active',
  type: 'technology',
  aliases: [],
  mentionCount: 1,
  confidence: 0.8,
  mergedIntoId: null,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/graph/entry*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { node: nodeA, degree: 1 },
        { node: nodeB, degree: 1 },
      ]),
    }),
  );
  await page.route('**/api/v1/graph/relations*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/v1/graph/entities/*/neighbors*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes: [nodeB], edges: [], truncated: false }),
    }),
  );
  await page.route('**/api/v1/entities**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([nodeB]),
    }),
  );
});

test('2d zooms, pans and resets', async ({ page }) => {
  await page.goto('/graph');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const canvas = page.getByTestId('graph2d-canvas');
  await expect(canvas).toHaveAttribute('data-viewport', '0,0,1');

  await page.getByRole('button', { name: '放大' }).click();
  expect(await canvas.getAttribute('data-viewport')).not.toBe('0,0,1');

  await page.getByRole('button', { name: '重置视图' }).click();
  await expect(canvas).toHaveAttribute('data-viewport', '0,0,1');

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 30, {
    steps: 5,
  });
  await page.mouse.up();
  expect(await canvas.getAttribute('data-viewport')).not.toBe('0,0,1');
});

test('2d search focuses a node and breadcrumb resets on blank double click', async ({ page }) => {
  await page.goto('/graph');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const canvas = page.getByTestId('graph2d-canvas');
  const before = await canvas.getAttribute('data-viewport');

  await page.getByLabel('搜索实体').fill('2D Beta');
  const results = page.getByTestId('entity-search-results');
  await results.getByRole('button', { name: '2D Beta', exact: true }).click();

  await expect
    .poll(async () => canvas.getAttribute('data-viewport'), { timeout: 10_000 })
    .not.toBe(before);
  const path = page.getByRole('navigation', { name: '图谱路径' });
  await expect(path).toBeVisible();
  await path.getByRole('button', { name: '2D Beta' }).click();

  const box = await canvas.boundingBox();
  await page.mouse.dblclick(box!.x + box!.width - 24, box!.y + box!.height - 24);
  await expect(path).toHaveCount(0);
});

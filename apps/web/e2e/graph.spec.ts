import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';
const suffix = Date.now();
const entity = `E2EGraph${suffix}`;
const neighbor = `E2EGraphBeta${suffix}`;
let documentId = '';

test.describe.configure({ mode: 'serial' });

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('等待超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

test.beforeAll(async ({ request }) => {
  const created = await request.post(`${API}/documents/text`, {
    data: {
      title: `E2E Graph ${suffix}`,
      content: `${entity} 使用 ${neighbor} 的向量能力。`,
    },
  });
  expect(created.ok()).toBeTruthy();
  documentId = ((await created.json()) as { item: { documentId: string } }).item.documentId;

  await waitFor(async () => {
    const detail = await request.get(`${API}/documents/${documentId}`);
    const body = (await detail.json()) as { currentVersion?: { status?: string } };
    return body.currentVersion?.status === 'ready' ? true : null;
  });

  await waitFor(async () => {
    const response = await request.get(`${API}/graph/relations?status=pending&limit=200`);
    const edges = (await response.json()) as Array<{
      id: string;
      from: string;
      to: string;
      type: string;
    }>;
    const edge = edges.find(
      (item) =>
        (item.from === entity && item.to === neighbor) ||
        (item.from === neighbor && item.to === entity),
    );
    if (!edge) {
      return null;
    }
    await request.post(`${API}/graph/relations/${edge.id}/confirm`);
    return edge;
  });
});

test.afterAll(async ({ request }) => {
  if (documentId) {
    await request.delete(`${API}/documents/${documentId}`);
  }
});

test('expand a node once and jump to entity highlight', async ({ page }) => {
  const neighborRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/neighbors')) {
      neighborRequests.push(request.url());
    }
  });

  await page.goto('/graph');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await page.getByLabel('搜索实体').fill(entity);
  const result = page.getByRole('button', { name: entity }).first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();

  const node = page.getByRole('button', { name: `节点 ${entity}` });
  await expect(node).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `节点 ${neighbor}` })).toBeVisible({
    timeout: 15_000,
  });
  expect(neighborRequests.length).toBe(1);

  await node.click();
  await page.waitForTimeout(700);
  expect(neighborRequests.length).toBe(1);

  await page.getByRole('button', { name: '来源' }).click();
  const locate = page.getByRole('link', { name: /定位：/ }).first();
  await expect(locate).toBeVisible({ timeout: 15_000 });
  await locate.click();

  await expect(page).toHaveURL(/entity=/);
  await expect(page.locator('[data-entity-highlight="true"]').first()).toBeVisible({
    timeout: 15_000,
  });
});

test('mobile graph defaults to list view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 812 });
  await page.goto('/graph');
  await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

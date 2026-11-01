import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';
const name = `E2E MCP ${Date.now()}`;

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ request }) => {
  const list = await request.get(`${API}/mcp-tokens`);
  if (!list.ok()) {
    return;
  }
  const tokens = (await list.json()) as Array<{ id: string; name: string }>;
  const created = tokens.find((token) => token.name === name);
  if (created) {
    await request.delete(`${API}/mcp-tokens/${created.id}`);
  }
});

test('creates a token with a one-time secret and lists it', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'MCP 接入' }).click();
  await expect(page.getByRole('tab', { name: '接入令牌' })).toBeVisible();

  await page.getByRole('button', { name: '创建令牌', exact: true }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: '创建接入令牌' })).toBeVisible();

  await drawer.getByLabel('名称').fill(name);
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect(drawer.getByText('允许调用的工具')).toBeVisible();
  await drawer.getByRole('button', { name: '下一步' }).click();
  await drawer.getByRole('button', { name: '创建令牌' }).click();

  await expect(page.getByRole('heading', { name: '令牌已创建' })).toBeVisible();
  const secret = page.locator('code').first();
  await expect(secret).toContainText('kos_');

  const done = page.getByRole('button', { name: '完成' });
  await expect(done).toBeDisabled();
  await page.getByLabel('我已保存到安全位置，知道关闭后无法再次查看').check();
  await expect(done).toBeEnabled();
  await page.getByRole('button', { name: '复制接入片段' }).click();
  await done.click();

  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('全部文档 · 5 个工具').first()).toBeVisible();
});

test('shows audit metrics and empty logs', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'MCP 接入' }).click();
  await page.getByRole('tab', { name: '调用日志' }).click();

  await expect(page.getByText('今日调用')).toBeVisible();
  await expect(page.getByText('平均延迟')).toBeVisible();
  await expect(page.getByLabel('按状态筛选')).toBeVisible();
  await expect(page.getByLabel('按工具筛选')).toBeVisible();
});

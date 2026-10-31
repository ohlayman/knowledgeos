import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';
const title = `E2E 笔记 ${Date.now()}`;
const content = `E2E 测试文档 ${title} 讲述向量召回的用法，向量召回负责语义相近的查询。`;

let documentId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${API}/documents/text`, {
    data: { title, content, tags: ['e2e'] },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { item: { documentId: string } };
  documentId = body.item.documentId;
});

test.afterAll(async ({ request }) => {
  if (documentId) {
    await request.delete(`${API}/documents/${documentId}`);
  }
});

test('dashboard, import status, reading, citation and theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('最近文档')).toBeVisible();

  await page.goto('/library');
  const row = page.getByRole('link', { name: new RegExp(title) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText('就绪')).toBeVisible({ timeout: 30_000 });

  await row.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('块 1 ·', { exact: false })).toBeVisible();
  await expect(page.getByText(content)).toBeVisible();

  await page.goto('/research');
  await page.getByLabel('问题输入').fill('向量召回负责什么？');
  await page.getByRole('button', { name: '发送' }).click();

  await expect(page.getByText('已验证')).toBeVisible({ timeout: 30_000 });
  const evidenceLink = page.getByRole('link', { name: '打开原文段落' }).first();
  await evidenceLink.click();

  await expect(page).toHaveURL(/\/documents\/.+\?chunk=/);
  await expect(page.locator('[data-chunk-id]').first()).toBeVisible();
  await expect(page.locator('[data-highlight="true"]')).toHaveCount(1, { timeout: 5_000 });

  await page.goto('/jobs');
  await expect(
    page.locator('.list-row .badge').filter({ hasText: '已完成' }).first(),
  ).toBeVisible();

  const modeBefore = await page.locator('html').getAttribute('data-theme-mode');
  await page.getByRole('button', { name: /^主题：/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-mode', modeBefore ?? 'system');

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByText('当前模型：fake-chat')).toBeVisible();
});

test('mobile layout keeps navigation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('link', { name: '问答' })).toBeVisible();
});

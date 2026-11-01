import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';
const title = `E2E Wiki ${Date.now()}`;
const paragraph = '这是通过界面创建并人工编辑的验收段落，用于验证版本生成。';

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ request }) => {
  const pages = await request.get(`${API}/wiki/pages?limit=200`);
  if (!pages.ok()) {
    return;
  }
  const body = (await pages.json()) as Array<{ slug: string; title: string }>;
  const created = body.find((page) => page.title === title);
  if (created) {
    await request.patch(`${API}/wiki/pages/${encodeURIComponent(created.slug)}`, {
      data: { archive: true },
    });
  }
});

test('create, read and edit a wiki page', async ({ page }) => {
  await page.goto('/wiki');
  await expect(page.getByRole('heading', { name: 'Wiki' })).toBeVisible();

  await page.getByLabel('新建页面标题').fill(title);
  await page.getByRole('button', { name: '新建页面' }).click();

  const row = page.getByRole('link', { name: new RegExp(title) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('link', { name: '编辑' }).click();
  await page.getByRole('button', { name: '新增段落' }).click();
  await page.getByLabel('第 1 段正文').fill(paragraph);
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByText(paragraph)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('link', { name: '版本历史' }).click();
  await expect(page.locator('strong').filter({ hasText: 'v2' }).first()).toBeVisible();
});

test('review queue and conflicts pages are reachable', async ({ page }) => {
  await page.goto('/wiki/review');
  await expect(page.getByRole('heading', { name: '审核队列' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '按提案状态筛选' })).toBeVisible();

  await page.goto('/wiki/conflicts');
  await expect(page.getByRole('heading', { name: '冲突裁决' })).toBeVisible();
});

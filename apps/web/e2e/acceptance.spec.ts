import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';
const seededTitle = `AC 阅读 ${Date.now()}`;
const seededContent = `AC 验收文档 ${seededTitle}：混合检索同时使用向量召回与关键词召回。`;
const keyboardTitle = `AC 键盘 ${Date.now()}`;
const keyboardContent = `键盘导入的文档 ${keyboardTitle}：引用需要定位到原文段落。`;

let seededId = '';

async function waitForReady(request: APIRequestContext, id: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request.get(`${API}/documents/${id}`);
    if (response.ok()) {
      const body = (await response.json()) as { currentVersion?: { status?: string } };
      if (body.currentVersion?.status === 'ready') {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`文档 ${id} 未在预期时间内就绪`);
}

function isVisibleOnScreen(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= window.innerWidth + 1;
  });
}

async function tabUntil(page: Page, label: string, max = 80): Promise<void> {
  const visited: string[] = [];
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) {
        return { text: '', tag: '' };
      }
      const text = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();
      return { text, tag: element.tagName };
    });
    visited.push(`${active.tag}:${active.text.slice(0, 30)}`);
    const interactive = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(active.tag);
    if (interactive && active.text.includes(label)) {
      return;
    }
  }
  throw new Error(`Tab 未能到达「${label}」，经过：${visited.join(' | ')}`);
}

async function deleteByTitle(request: APIRequestContext, title: string): Promise<void> {
  const response = await request.get(`${API}/documents?q=${encodeURIComponent(title)}&limit=10`);
  if (!response.ok()) {
    return;
  }
  const body = (await response.json()) as { items: Array<{ id: string }> };
  for (const item of body.items) {
    await request.delete(`${API}/documents/${item.id}`);
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${API}/documents/text`, {
    data: { title: seededTitle, content: seededContent, tags: ['acceptance'] },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { item: { documentId: string } };
  seededId = body.item.documentId;
  await waitForReady(request, seededId);
});

test.afterAll(async ({ request }) => {
  await deleteByTitle(request, seededTitle);
  await deleteByTitle(request, keyboardTitle);
});

test('390/768/1024/1440 四档均无横向滚动', async ({ page }) => {
  const routes = [
    '/',
    '/library',
    `/documents/${seededId}`,
    '/research',
    '/graph',
    '/agents',
    '/wiki',
    '/jobs',
    '/settings',
  ];

  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      expect(await isVisibleOnScreen(page), `${width}px ${route}`).toBe(true);
    }
  }
});

test('空状态可到达并渲染', async ({ page }) => {
  await page.goto(`/library?q=${encodeURIComponent(`不存在-${Date.now()}`)}`);
  await expect(page.getByText('没有符合筛选条件的文档')).toBeVisible();
});

test('加载状态可到达并渲染', async ({ page }) => {
  await page.route('**/api/v1/documents**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto('/library');
  await expect(page.locator('[aria-label="加载中"]')).toBeVisible();
  await expect(page.locator('[aria-label="加载中"]')).toBeHidden({ timeout: 20_000 });
});

test('错误状态可到达并渲染', async ({ page }) => {
  await page.route('**/api/v1/documents**', (route) => route.abort());
  await page.goto('/library');
  await expect(page.getByRole('alert')).toContainText('加载失败', { timeout: 30_000 });
});

test('键盘完成导入、查看、提问与打开引用', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/library');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await tabUntil(page, '导入材料');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '导入材料' })).toBeVisible();

  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Tab');
  }
  await page.keyboard.type(keyboardTitle);
  await page.keyboard.press('Tab');
  await page.keyboard.type(keyboardContent);
  await page.keyboard.press('Tab');
  await page.keyboard.type('keyboard');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });

  const row = page.getByRole('link', { name: new RegExp(keyboardTitle) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText('就绪')).toBeVisible({ timeout: 40_000 });

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabUntil(page, keyboardTitle);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: keyboardTitle })).toBeVisible();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabUntil(page, '问答');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/research/);

  await tabUntil(page, '问题输入');
  await page.keyboard.type('混合检索使用哪两路召回？');
  await page.keyboard.press('Enter');
  await expect(page.getByText('已验证')).toBeVisible({ timeout: 40_000 });

  await tabUntil(page, '打开原文段落');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/documents\/.+\?chunk=/);
  await expect(page.locator('[data-highlight="true"]')).toHaveCount(1, { timeout: 5_000 });
});

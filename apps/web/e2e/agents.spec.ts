import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';
const name = `E2E Agent ${Date.now()}`;
let agentId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const created = await request.post(`${API}/agents`, {
    data: {
      name,
      description: 'E2E 验收 Agent',
      systemPrompt: '你是知识库助手，先检索再回答。',
      maxSteps: 3,
      toolAllowlist: ['search_knowledge'],
    },
  });
  expect(created.ok()).toBeTruthy();
  agentId = ((await created.json()) as { id: string }).id;
});

test.afterAll(async ({ request }) => {
  if (agentId) {
    await request.post(`${API}/agents/${agentId}/archive`);
  }
});

test('create, configure and run an agent with replay', async ({ page }) => {
  await page.goto('/agents');
  const row = page.getByRole('link', { name: new RegExp(name) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText(/当前版本 v1/)).toBeVisible();

  await page.getByLabel('Agent 输入').fill('混合检索是什么？');
  await page.getByRole('button', { name: '开始执行' }).click();

  await expect(page).toHaveURL(/\/agents\/runs\//, { timeout: 20_000 });
  await expect(page.getByText('succeeded')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('search_knowledge', { exact: true })).toBeVisible();
  await expect(page.getByText('参数（已脱敏）')).toBeVisible();
  await expect(page.getByText('正常完成')).toBeVisible();
});

import { chromium } from '../apps/web/node_modules/@playwright/test/index.mjs';

const BASE = process.env.WEB_BASE ?? 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

async function measure(label, nodes) {
  const page = await context.newPage();
  if (nodes) {
    await page.route('**/api/v1/graph/entry', async (route) => {
      const items = Array.from({ length: nodes }, (_, index) => ({
        node: {
          id: `stress-${index}`,
          name: `概念 ${index}`,
          type: index % 5 === 0 ? 'technology' : 'concept',
          aliases: [],
          mentionCount: 1 + (index % 5),
          confidence: 0.8,
          mergedIntoId: null,
        },
        degree: 1,
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(items),
      });
    });
  }

  const startedAt = Date.now();
  await page.goto(`${BASE}/graph`);
  await page.locator('.graph-3d canvas').waitFor({ state: 'visible', timeout: 30_000 });
  const firstFrameMs = Date.now() - startedAt;

  await page
    .locator('[data-engine="stopped"]')
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  const settledMs = Date.now() - startedAt;

  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          const elapsed = performance.now() - start;
          if (elapsed < 4000) {
            requestAnimationFrame(tick);
          } else {
            resolve(Math.round((frames / elapsed) * 1000));
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.close();
  return { label, firstFrameMs, settledMs, fps };
}

async function measureFallback() {
  const page = await context.newPage();
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  const startedAt = Date.now();
  await page.goto(`${BASE}/graph`);
  await page.getByTestId('graph2d-canvas').waitFor({ state: 'visible', timeout: 30_000 });
  const fallbackMs = Date.now() - startedAt;
  await page.close();
  return { fallbackMs };
}

const real = await measure('入口 20 节点（真实开发库）', null);
const stress = await measure('400 节点（路由拦截合成数据）', 400);
const fallback = await measureFallback();

console.log(JSON.stringify({ real, stress, fallback }, null, 2));
await browser.close();

import { randomUUID } from 'node:crypto';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const runId = randomUUID().slice(0, 8);
const created = [];

function percentile(samples, value) {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function timeOnce(path, options) {
  const start = performance.now();
  const response = await fetch(`${API}${path}`, options);
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return performance.now() - start;
}

async function measure(label, path, options, rounds = 50) {
  const samples = [];
  for (let index = 0; index < rounds; index += 1) {
    samples.push(await timeOnce(path, options));
  }
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(`${label.padEnd(22)} n=${rounds}  P50 ${p50.toFixed(0)}ms  P95 ${p95.toFixed(0)}ms`);
  return { label, n: rounds, p50, p95 };
}

async function waitReady(documentId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${API}/documents/${documentId}`);
    const body = await response.json();
    if (body.currentVersion?.status === 'ready') {
      return;
    }
    if (body.currentVersion?.status === 'failed') {
      throw new Error(`文档处理失败：${documentId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`文档未在 ${timeoutMs}ms 内就绪`);
}

async function firstTokenLatency(conversationId, question) {
  const start = performance.now();
  const response = await fetch(`${API}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: question }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`问答请求失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstDelta = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (firstDelta === null && /event: delta/.test(buffer)) {
      firstDelta = performance.now() - start;
    }
  }

  return firstDelta ?? performance.now() - start;
}

async function loadDuringProcessing() {
  const form = new FormData();
  for (let index = 0; index < 10; index += 1) {
    form.append(
      'files',
      new Blob(
        [
          Buffer.from(
            `# 压测文档 ${index}\n\n混合检索与引用定位的压测内容 ${runId}-${index}，用于观察处理期间的接口延迟。`,
            'utf8',
          ),
        ],
        { type: 'text/markdown' },
      ),
      `bench-${runId}-${index}.md`,
    );
  }
  const started = performance.now();
  const response = await fetch(`${API}/documents/files`, { method: 'POST', body: form });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`批量导入失败：${response.status}`);
  }
  const ids = body.items.map((item) => item.documentId);
  created.push(...ids);

  const samples = [];
  const pending = new Set(ids);
  while (pending.size > 0) {
    const sampleStart = performance.now();
    const list = await fetch(`${API}/documents?limit=20`);
    await list.arrayBuffer();
    samples.push(performance.now() - sampleStart);

    for (const id of [...pending]) {
      const detail = await (await fetch(`${API}/documents/${id}`)).json();
      if (detail.currentVersion?.status === 'ready') {
        pending.delete(id);
      } else if (detail.currentVersion?.status === 'failed') {
        throw new Error(`压测文档处理失败：${id}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const elapsed = performance.now() - started;
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(
    `处理中接口延迟       n=${samples.length}  P50 ${p50.toFixed(0)}ms  P95 ${p95.toFixed(0)}ms`,
  );
  console.log(`10 份文档处理耗时    ${(elapsed / 1000).toFixed(1)}s`);
  return { p50, p95, elapsed, samples: samples.length };
}

async function main() {
  console.log(`性能测试 ${runId}，API=${API}\n`);

  const documents = await measure('文档列表', '/documents?limit=20');
  const metrics = await measure('指标概览', '/metrics/overview');
  await measure('任务列表', '/jobs?limit=20');
  const retrieval = await measure(
    '混合检索',
    '/retrieval/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '混合检索 引用定位', topK: 10 }),
    },
    30,
  );

  const conversation = await (
    await fetch(`${API}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '性能测试' }),
    })
  ).json();
  const latencies = [];
  for (let index = 0; index < 10; index += 1) {
    latencies.push(await firstTokenLatency(conversation.id, '混合检索使用哪两路召回？'));
  }
  const firstTokenP95 = percentile(latencies, 0.95);
  console.log(
    `首 token 延迟        n=10  P50 ${percentile(latencies, 0.5).toFixed(0)}ms  P95 ${firstTokenP95.toFixed(0)}ms`,
  );

  const load = await loadDuringProcessing();

  const checks = [
    ['非 LLM 接口 P95 ≤ 300ms（空闲）', Math.max(documents.p95, metrics.p95) <= 300],
    ['检索 P95 ≤ 300ms', retrieval.p95 <= 300],
    ['首 token P95 ≤ 2500ms', firstTokenP95 <= 2500],
    ['处理中普通接口 P95 ≤ 500ms', load.p95 <= 500],
  ];
  console.log('');
  for (const [label, pass] of checks) {
    console.log(`${pass ? '通过' : '失败'}  ${label}`);
  }
  if (checks.some(([, pass]) => !pass)) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  for (const id of created) {
    await fetch(`${API}/documents/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

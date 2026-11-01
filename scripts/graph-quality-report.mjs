import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './lib.mjs';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';

async function api(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json();
}

const relations = await api('/graph/relations?limit=200');
const sample = relations.slice(0, 200);

let resolvable = 0;
for (const relation of sample) {
  const chunkIds = relation.evidenceChunkIds ?? [];
  let ok = chunkIds.length > 0;
  for (const chunkId of chunkIds.slice(0, 3)) {
    const response = await fetch(`${API}/chunks/${chunkId}`);
    if (!response.ok) {
      ok = false;
    }
  }
  if (ok) {
    resolvable += 1;
  }
}

const byType = sample.reduce((acc, relation) => {
  acc[relation.type] = (acc[relation.type] ?? 0) + 1;
  return acc;
}, {});
const byStatus = sample.reduce((acc, relation) => {
  acc[relation.status] = (acc[relation.status] ?? 0) + 1;
  return acc;
}, {});
const humanConfirmed = sample.filter((relation) => relation.origin === 'human').length;

const lines = [
  '# V2 图谱质量报告',
  '',
  `> 生成时间：${new Date().toISOString()}。样本为最近 ${sample.length} 条关系，数据来自当前开发库。`,
  '',
  '## 指标',
  '',
  `- 抽样关系数：${sample.length}`,
  `- 证据可解析率：${sample.length ? ((resolvable / sample.length) * 100).toFixed(1) : '0.0'}%`,
  `- 人工确认占比：${sample.length ? ((humanConfirmed / sample.length) * 100).toFixed(1) : '0.0'}%`,
  `- 关系类型正确率：需要人工标注，当前统计仅覆盖类型分布与证据完整性。`,
  '',
  '## 类型分布',
  '',
  '| 类型 | 数量 |',
  '| --- | --- |',
  ...(Object.keys(byType).length
    ? Object.entries(byType).map(([type, count]) => `| ${type} | ${count} |`)
    : ['| 暂无 | 0 |']),
  '',
  '## 状态分布',
  '',
  '| 状态 | 数量 |',
  '| --- | --- |',
  ...Object.entries(byStatus).map(([status, count]) => `| ${status} | ${count} |`),
  '',
  '## 解读',
  '',
  '- 当前数据由 Fake 抽取器生成，关系类型以 RELATED_TO 为主，不能代表真实模型的类型准确率。',
  '- 证据可解析率是自动化指标；类型正确率与人工推翻率需要真实语料与人工标注。',
  '- 本报告是生成时快照；运行 `pnpm clean:test-data` 后样本会减少。',
  '',
];

const output = resolve(repoRoot, 'docs/GRAPH_QUALITY_REPORT.md');
writeFileSync(output, lines.join('\n'));
console.log(`报告已写入 ${output}`);
console.log(JSON.stringify({ total: sample.length, resolvable, byType, byStatus }, null, 2));

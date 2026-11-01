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

const [proposals, pages, conflicts] = await Promise.all([
  api('/wiki/proposals?limit=200'),
  api('/wiki/pages?limit=200'),
  api('/wiki/conflicts'),
]);

const total = proposals.length;
const byStatus = proposals.reduce((acc, proposal) => {
  acc[proposal.status] = (acc[proposal.status] ?? 0) + 1;
  return acc;
}, {});
const decided = proposals.filter((proposal) =>
  ['accepted', 'rejected', 'invalid'].includes(proposal.status),
);
const accepted = decided.filter((proposal) => proposal.status === 'accepted').length;
const rejectionReasons = proposals
  .filter((proposal) => proposal.status === 'rejected')
  .reduce((acc, proposal) => {
    const key = proposal.rejectReason ?? '未填写';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const reviewDurations = decided
  .filter((proposal) => proposal.reviewedAt)
  .map(
    (proposal) =>
      (new Date(proposal.reviewedAt).getTime() - new Date(proposal.createdAt).getTime()) / 1000,
  );
const averageReviewSeconds = reviewDurations.length
  ? reviewDurations.reduce((sum, value) => sum + value, 0) / reviewDurations.length
  : 0;

const lines = [
  '# V1.5 提案质量报告',
  '',
  `> 生成时间：${new Date().toISOString()}。数据来自当前开发库，模型为本地 Fake 实现。`,
  '',
  '## 样本',
  '',
  `- 提案总数：${total}`,
  `- 页面总数：${pages.length}`,
  `- 未裁决冲突：${conflicts.length}`,
  total < 100 ? `- 注意：样本少于 PRD 要求的 100 条（当前 ${total} 条）。` : '',
  '',
  '## 状态分布',
  '',
  '| 状态 | 数量 |',
  '| --- | --- |',
  ...Object.entries(byStatus).map(([status, count]) => `| ${status} | ${count} |`),
  '',
  '## 接受率',
  '',
  `- 已处理提案：${decided.length}`,
  `- 接受率：${decided.length ? ((accepted / decided.length) * 100).toFixed(1) : '0.0'}%`,
  `- 平均审核耗时：${(averageReviewSeconds / 60).toFixed(1)} 分钟`,
  '',
  '## 拒绝原因分布',
  '',
  '| 原因 | 数量 |',
  '| --- | --- |',
  ...(Object.keys(rejectionReasons).length
    ? Object.entries(rejectionReasons).map(([reason, count]) => `| ${reason} | ${count} |`)
    : ['| 暂无拒绝记录 | 0 |']),
  '',
  '## 解读',
  '',
  '- 当前样本用于验证机制可用性，不代表真实语料下的提案质量。',
  '- Fake 模型只做确定性抽取，冲突与提案类型覆盖有限；接入真实模型后需重新统计。',
  '- 审核耗时统计包含自动化验收产生的记录，人工审核效率需在真实使用中复测。',
  '- 本报告是生成时的快照；运行 `pnpm clean:test-data` 后开发库样本会减少。',
  '',
];

const output = resolve(repoRoot, 'docs/WIKI_QUALITY_REPORT.md');
writeFileSync(output, lines.join('\n'));
console.log(`报告已写入 ${output}`);
console.log(
  JSON.stringify({ total, byStatus, accepted, rejectionReasons, averageReviewSeconds }, null, 2),
);

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = resolve(repoRoot, '.env');
const env = {
  ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}),
  ...process.env,
};

function parseEnv(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index > 0)
      result[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^['"]|['"]$/g, '');
  }
  return result;
}

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL 未配置');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const titlePatterns = [
  /^pipeline-/,
  /^retry-/,
  /^resume-/,
  /^idempotent-/,
  /^pdf-/,
  /^notes-/,
  /^batch-/,
  /^broken-/,
  /^conv-/,
  /^job-service-/,
  /^reconcile/,
  /^maintenance-/,
  /^retention-/,
  /^dbg-/,
  /^e2e 笔记/i,
  /^AC[- ]/i,
  /^AC15/,
  /^ACV2/,
  /^冒烟 Agent/,
  /^DBG/,
  /^冲突[A-D] /,
  /^V15 /,
  /^bench-/,
  /^index-fail-/,
  /^reimport-/,
  /^Test document$/,
  /^Manual /,
  /^Cross /,
  /^List /,
];

const documents = await prisma.document.findMany({
  select: {
    id: true,
    title: true,
    sources: { select: { source: { select: { fingerprint: true } } } },
  },
});

const stale = documents.filter(
  (document) =>
    titlePatterns.some((pattern) => pattern.test(document.title)) ||
    document.sources.some((link) => link.source.fingerprint.startsWith('eval://')),
);

if (stale.length > 0) {
  await prisma.document.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
}

const prefixes = [
  'pipeline-',
  'notes-',
  'batch-',
  'broken-',
  'conv-',
  'eval://',
  'retention-',
  'maintenance-',
  'e2e ',
  'AC-',
  'AC15',
  'acv2',
  '冒烟 agent',
  'dbg',
  '冲突',
  'v15 ',
  'bench-',
  'index-fail-',
  'reimport-',
];
const sources = await prisma.source.deleteMany({
  where: { OR: prefixes.map((prefix) => ({ fingerprint: { startsWith: prefix } })) },
});

const conversationPatterns = [
  /^conv-/,
  /^AC /,
  /^性能测试$/,
  /^新会话$/,
  /^向量召回负责什么/,
  /^混合检索使用哪两路召回/,
  /^引用校验如何工作/,
  /^向量不可用时如何检索/,
];
const conversations = await prisma.conversation.findMany({ select: { id: true, title: true } });
const staleConversations = conversations.filter((conversation) =>
  conversationPatterns.some((pattern) => pattern.test(conversation.title)),
);
if (staleConversations.length > 0) {
  await prisma.conversation.deleteMany({
    where: { id: { in: staleConversations.map((item) => item.id) } },
  });
}

const wikiPages = await prisma.wikiPage.findMany({
  where: {
    OR: [{ title: { startsWith: 'AC' } }, { title: { startsWith: 'E2E Wiki' } }],
  },
  select: { id: true },
});
if (wikiPages.length > 0) {
  const pageIds = wikiPages.map((page) => page.id);
  await prisma.wikiProposal.deleteMany({ where: { targetPageId: { in: pageIds } } });
  await prisma.reviewTask.deleteMany({ where: { targetId: { in: pageIds } } });
  await prisma.wikiPage.deleteMany({ where: { id: { in: pageIds } } });
}
const createProposals = await prisma.wikiProposal.findMany({
  where: { patch: { path: ['newPage', 'title'], string_starts_with: 'AC15' } },
  select: { id: true },
});
if (createProposals.length > 0) {
  const ids = createProposals.map((proposal) => proposal.id);
  await prisma.reviewTask.deleteMany({ where: { proposalId: { in: ids } } });
  await prisma.wikiProposal.deleteMany({ where: { id: { in: ids } } });
}

const remainingChunks = await prisma.chunk.findMany({ select: { id: true } });
const chunkIds = new Set(remainingChunks.map((chunk) => chunk.id));
const allEntities = await prisma.entity.findMany({
  select: { id: true, sourceChunkIds: true },
});
const staleEntities = allEntities.filter(
  (entity) =>
    entity.sourceChunkIds.length === 0 ||
    entity.sourceChunkIds.every((chunkId) => !chunkIds.has(chunkId)),
);
if (staleEntities.length > 0) {
  await prisma.entity.deleteMany({ where: { id: { in: staleEntities.map((item) => item.id) } } });
}

const remainingPages = await prisma.wikiPage.findMany({
  select: { id: true, revisions: { select: { evidenceChunkIds: true } } },
});
const stalePages = remainingPages.filter((page) => {
  const evidence = page.revisions.flatMap((revision) => revision.evidenceChunkIds);
  return evidence.length > 0 && evidence.every((chunkId) => !chunkIds.has(chunkId));
});
if (stalePages.length > 0) {
  const ids = stalePages.map((page) => page.id);
  await prisma.reviewTask.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.wikiPage.deleteMany({ where: { id: { in: ids } } });
}

const testAgents = await prisma.agent.deleteMany({
  where: {
    OR: [{ name: { startsWith: 'ACV2' } }, { name: { startsWith: '冒烟 Agent' } }],
  },
});

const orphanProposals = await prisma.wikiProposal.findMany({
  where: { status: 'pending', documentVersionId: null, modelMeta: { not: null } },
  select: { id: true },
});
if (orphanProposals.length > 0) {
  const ids = orphanProposals.map((proposal) => proposal.id);
  await prisma.reviewTask.deleteMany({ where: { proposalId: { in: ids } } });
  await prisma.wikiProposal.deleteMany({ where: { id: { in: ids } } });
}

console.log(
  `清理完成：${stale.length} 份测试文档、${sources.count} 条来源、${staleConversations.length} 个测试会话、${wikiPages.length} 个 Wiki 页面、${orphanProposals.length} 条孤儿提案、${testAgents.count} 个 Agent`,
);
await prisma.$disconnect();

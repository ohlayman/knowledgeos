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

console.log(
  `清理完成：${stale.length} 份测试文档、${sources.count} 条来源、${staleConversations.length} 个测试会话`,
);
await prisma.$disconnect();

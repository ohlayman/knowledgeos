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
];
const sources = await prisma.source.deleteMany({
  where: { OR: prefixes.map((prefix) => ({ fingerprint: { startsWith: prefix } })) },
});

console.log(`清理完成：${stale.length} 份测试文档、${sources.count} 条来源`);
await prisma.$disconnect();

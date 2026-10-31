import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChunkRepository, DocumentRepository, JobRepository, PrismaClient } from '@kos/database';
import { FakeEmbeddingProvider, type EmbeddingProvider } from '@kos/embeddings';
import { QdrantStore } from '@kos/retrieval';
import { ApiError, contentHash, fileHash } from '@kos/shared';
import { LocalStorageAdapter } from '@kos/storage';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPipeline, type PipelineDeps } from './pipeline.js';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.QDRANT_URL);

const prisma = new PrismaClient();
const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const jobs = new JobRepository(prisma);
const collection = `kos_test_${randomUUID().slice(0, 8)}`;
const qdrant = new QdrantStore({ url: process.env.QDRANT_URL ?? '', collection, vectorSize: 64 });
const fingerprints: string[] = [];
const documentIds: string[] = [];

let root = '';
let storage: LocalStorageAdapter;

function deps(provider: EmbeddingProvider = new FakeEmbeddingProvider(64)): PipelineDeps {
  return {
    prisma,
    documents,
    chunks,
    jobs,
    storage,
    embeddings: provider,
    qdrant,
  };
}

async function createVersion(content: string, name: string) {
  const bytes = Buffer.from(content, 'utf8');
  const hash = fileHash(bytes);
  const storageKey = `test/${hash}`;
  await storage.put(storageKey, bytes, 'text/markdown');
  fingerprints.push(name);

  return documents.createWithVersion({
    title: name,
    source: { type: 'file', fingerprint: name, identifier: name },
    version: {
      contentHash: contentHash(content),
      fileHash: hash,
      storageKey,
      storageSize: bytes.length,
      mimeType: 'text/markdown',
      originalFilename: name,
    },
  });
}

async function createJob(documentId: string, versionId: string) {
  const job = await prisma.processingJob.create({
    data: { id: randomUUID(), documentId, versionId, type: 'ingest', status: 'queued' },
  });
  const steps = ['parse', 'clean', 'metadata', 'dedupe', 'chunk', 'embed', 'index'] as const;
  await prisma.jobStep.createMany({
    data: steps.map((step, index) => ({
      id: randomUUID(),
      jobId: job.id,
      step,
      stepOrder: index,
    })),
  });
  return job.id;
}

describe.skipIf(!enabled)('ingest pipeline', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kos-worker-'));
    storage = new LocalStorageAdapter(root);
  });

  afterAll(async () => {
    await qdrant.deleteCollection().catch(() => undefined);
    if (documentIds.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    }
    await prisma.source.deleteMany({ where: { fingerprint: { in: fingerprints } } });
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  });

  it('runs all steps and makes the version ready', async () => {
    const name = `pipeline-${randomUUID().slice(0, 8)}.md`;
    const created = await createVersion(
      [
        '# 混合检索',
        '',
        '混合检索同时使用向量召回与关键词召回。',
        '',
        '## 融合',
        '',
        '倒数排名融合把两路结果合并。',
        '```ts',
        'const fused = rrf(vectorRanks, keywordRanks, 60);',
        '```',
      ].join('\n'),
      name,
    );
    documentIds.push(created.documentId);

    await runPipeline(deps(), created.jobId);

    const job = await jobs.getById(created.jobId);
    expect(job?.status).toBe('succeeded');
    expect(job?.steps.every((step) => step.status === 'succeeded')).toBe(true);

    const version = await documents.getVersionById(created.versionId);
    expect(version?.status).toBe('ready');
    expect(version?.normalizedText).toContain('混合检索');

    const stored = await chunks.listByVersion(created.versionId);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((chunk) => chunk.vectorStatus === 'ready')).toBe(true);
    expect(stored.some((chunk) => chunk.type === 'code')).toBe(true);
    expect(stored.every((chunk) => chunk.searchText.length > 0)).toBe(true);

    const [vector] = await deps().embeddings.embed([stored[0]!.text]);
    const results = await qdrant.search(vector!, {
      limit: 1,
      filter: { versionIds: [created.versionId] },
    });
    expect(results[0]?.payload?.chunkId).toBe(stored[0]!.id);
    expect(results[0]?.payload?.isCurrent).toBe(true);
  });

  it('re-running the same job is idempotent', async () => {
    const name = `idempotent-${randomUUID().slice(0, 8)}.md`;
    const created = await createVersion('# 幂等\n\n同一版本重复处理不应产生重复块。', name);
    documentIds.push(created.documentId);

    await runPipeline(deps(), created.jobId);
    const first = await chunks.listByVersion(created.versionId);

    await runPipeline(deps(), created.jobId);
    const second = await chunks.listByVersion(created.versionId);

    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
  });

  it('does not mark the version ready when the index write fails', async () => {
    const name = `index-fail-${randomUUID().slice(0, 8)}.md`;
    const created = await createVersion('# 索引失败\n\n索引写入失败时不得标记就绪。', name);
    documentIds.push(created.documentId);

    const failingQdrant = {
      ensureCollection: () => qdrant.ensureCollection(),
      createPayloadIndexes: () => qdrant.createPayloadIndexes(),
      upsert: (points: Parameters<QdrantStore['upsert']>[0]) => qdrant.upsert(points),
      setCurrentVersion: async () => {
        throw new ApiError('PROVIDER_UNAVAILABLE', '模拟索引写入失败');
      },
    } as unknown as QdrantStore;

    await runPipeline({ ...deps(), qdrant: failingQdrant }, created.jobId);

    const job = await jobs.getById(created.jobId);
    const version = await documents.getVersionById(created.versionId);
    expect(job?.status).toBe('failed');
    expect(job?.steps.find((step) => step.step === 'index')?.status).toBe('failed');
    expect(version?.status).not.toBe('ready');
  });

  it('resumes from the first unfinished step', async () => {
    const name = `resume-${randomUUID().slice(0, 8)}.md`;
    const created = await createVersion('# 断点\n\n中断后不应重复解析。', name);
    documentIds.push(created.documentId);

    await runPipeline(deps(), created.jobId);
    const version = await documents.getVersionById(created.versionId);
    const storageKey = version!.storageKey!;
    await storage.delete(storageKey);

    const jobId = await createJob(created.documentId, created.versionId);
    await prisma.jobStep.update({
      where: { jobId_step: { jobId, step: 'parse' } },
      data: { status: 'succeeded' },
    });

    await runPipeline(deps(), jobId);

    const resumed = await jobs.getById(jobId);
    expect(resumed?.status).toBe('succeeded');
    expect(await chunks.listByVersion(created.versionId)).not.toHaveLength(0);
  });

  it('processes a 20-page PDF end to end', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let index = 1; index <= 20; index += 1) {
      const page = pdf.addPage([595, 842]);
      page.drawText(`Chapter ${index}`, { x: 50, y: 740, size: 16, font });
      page.drawText(`Paragraph on page ${index} about retrieval.`, {
        x: 50,
        y: 700,
        size: 12,
        font,
      });
    }
    const bytes = Buffer.from(await pdf.save());
    const hash = fileHash(bytes);
    const storageKey = `test/${hash}`;
    await storage.put(storageKey, bytes, 'application/pdf');

    const name = `pdf-${randomUUID().slice(0, 8)}.pdf`;
    fingerprints.push(name);
    const created = await documents.createWithVersion({
      title: name,
      source: { type: 'file', fingerprint: name, identifier: name },
      version: {
        contentHash: contentHash(`pdf-${name}`),
        fileHash: hash,
        storageKey,
        storageSize: bytes.length,
        mimeType: 'application/pdf',
        originalFilename: name,
      },
    });
    documentIds.push(created.documentId);

    await runPipeline(deps(), created.jobId);

    const version = await documents.getVersionById(created.versionId);
    expect(version?.status).toBe('ready');
    expect(version?.pageCount).toBe(20);

    const stored = await chunks.listByVersion(created.versionId);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((chunk) => chunk.pageStart !== null && chunk.pageEnd !== null)).toBe(true);
    expect(Math.max(...stored.map((chunk) => chunk.pageEnd!))).toBe(20);
  });

  it('fails the job when embedding fails, then succeeds after retry', async () => {
    const name = `retry-${randomUUID().slice(0, 8)}.md`;
    const created = await createVersion('# 重试\n\n失败后单步重试应成功。', name);
    documentIds.push(created.documentId);

    const broken = {
      model: 'broken',
      dim: 64,
      embed: async () => {
        throw new ApiError('PROVIDER_UNAVAILABLE', 'provider down');
      },
    };

    await runPipeline(deps(broken), created.jobId);

    const failed = await jobs.getById(created.jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(failed?.steps.find((step) => step.step === 'embed')?.status).toBe('failed');

    const versionAfterFailure = await documents.getVersionById(created.versionId);
    expect(versionAfterFailure?.status).toBe('failed');

    await prisma.processingJob.update({
      where: { id: created.jobId },
      data: { status: 'queued', errorCode: null, errorMessage: null, finishedAt: null },
    });
    await prisma.jobStep.update({
      where: { jobId_step: { jobId: created.jobId, step: 'embed' } },
      data: { status: 'pending', errorCode: null, errorMessage: null },
    });

    await runPipeline(deps(), created.jobId);

    const recovered = await jobs.getById(created.jobId);
    expect(recovered?.status).toBe('succeeded');
    const version = await documents.getVersionById(created.versionId);
    expect(version?.status).toBe('ready');
  });
});

import { randomUUID } from 'node:crypto';
import {
  ChunkRepository,
  createPrismaClient,
  DocumentRepository,
  type PrismaClient,
} from '@kos/database';
import { FakeEmbeddingProvider, normalizeVector } from '@kos/embeddings';
import { buildSearchText } from '@kos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QdrantStore } from './qdrant.js';
import { RetrievalService } from './service.js';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.QDRANT_URL);

const prisma = createPrismaClient(process.env.DATABASE_URL);
const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const embeddings = new FakeEmbeddingProvider(32);
const collection = `kos_retrieval_${randomUUID().slice(0, 8)}`;
const qdrant = new QdrantStore({ url: process.env.QDRANT_URL ?? '', collection, vectorSize: 32 });
const titles: string[] = [];
const runPrefix = `retrieval-test-${randomUUID().slice(0, 8)}`;
const runIds: string[] = [];

interface SeedResult {
  documentId: string;
  versionId: string;
  chunkIds: string[];
  texts: string[];
}

async function seedDocument(title: string, texts: string[]): Promise<SeedResult> {
  const created = await documents.createWithVersion({
    title,
    source: { type: 'file', fingerprint: title, identifier: title },
    version: {
      contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      normalizedText: texts.join('\n\n'),
      charCount: texts.join('\n\n').length,
    },
  });
  titles.push(title);

  await chunks.replaceForVersion(
    created.documentId,
    created.versionId,
    texts.map((text, index) => ({
      chunkIndex: index,
      text,
      tokenCount: text.length,
      startOffset: 0,
      endOffset: text.length,
      headingPath: ['测试'],
      searchText: buildSearchText(text),
    })),
  );

  const rows = await chunks.listByVersion(created.versionId);
  const vectors = await embeddings.embed(rows.map((row) => row.text));
  await qdrant.upsert(
    rows.map((row, index) => ({
      id: row.id,
      vector: normalizeVector(vectors[index]!),
      payload: {
        chunkId: row.id,
        documentId: created.documentId,
        versionId: created.versionId,
        isCurrent: true,
        tags: [],
        type: 'text',
        createdAt: Date.now(),
      },
    })),
  );
  await chunks.markVectorReady(
    rows.map((row) => row.id),
    embeddings.model,
    embeddings.dim,
  );

  return {
    documentId: created.documentId,
    versionId: created.versionId,
    chunkIds: rows.map((row) => row.id),
    texts: rows.map((row) => row.text),
  };
}

describe.skipIf(!enabled)('RetrievalService', () => {
  let service: RetrievalService;
  let hybrid: SeedResult;
  let sparse: SeedResult;

  beforeAll(async () => {
    await qdrant.ensureCollection();
    await qdrant.createPayloadIndexes();

    service = new RetrievalService({ prisma, embeddings, qdrant });

    hybrid = await seedDocument(`${runPrefix}-hybrid`, [
      '混合检索同时使用向量召回与关键词召回。',
      '倒数排名融合把两路结果合并后排序。',
    ]);
    sparse = await seedDocument(`${runPrefix}-qdrant`, [
      'Qdrant 支持稀疏向量用于混合检索。',
      '向量数据库负责语义相似度搜索。',
    ]);
  });

  afterAll(async () => {
    await qdrant.deleteCollection().catch(() => undefined);
    await prisma.document.deleteMany({
      where: { sources: { some: { source: { fingerprint: { in: titles } } } } },
    });
    await prisma.source.deleteMany({ where: { fingerprint: { in: titles } } });
    if (runIds.length > 0) {
      await prisma.retrievalRun.deleteMany({ where: { id: { in: runIds } } });
    }
    await prisma.$disconnect();
  });

  it('recalls Chinese keywords with bigram tsquery', async () => {
    const result = await service.retrieve(`${runPrefix} 混合检索`, {
      documentIds: [hybrid.documentId],
      rerankEnabled: false,
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.noEvidence).toBe(false);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.documentId === hybrid.documentId)).toBe(true);
    expect(result.evidence[0]?.text).toContain('混合检索');
    expect(result.trace.keywordHits).toBeGreaterThan(0);
  });

  it('returns the exact chunk first for a vector match', async () => {
    const target = sparse.texts[0]!;
    const result = await service.retrieve(target, {
      documentIds: [sparse.documentId],
      vectorScoreThreshold: 0.5,
      rerankEnabled: false,
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.evidence[0]?.chunkId).toBe(sparse.chunkIds[0]);
    expect(result.evidence[0]?.score).toBeGreaterThan(0);
  });

  it('applies document scope filters', async () => {
    const result = await service.retrieve('向量召回与关键词召回', {
      documentIds: [sparse.documentId],
      rerankEnabled: false,
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.evidence.every((item) => item.documentId === sparse.documentId)).toBe(true);
  });

  it('flags no evidence for unrelated questions', async () => {
    const result = await service.retrieve('量子纠缠与超导材料的能隙', {
      documentIds: [hybrid.documentId],
      rerankEnabled: false,
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.noEvidence).toBe(true);
    expect(result.evidence).toEqual([]);
  });

  it('splits comparison questions into entity queries', async () => {
    const result = await service.retrieve('向量 和 关键词 有什么区别', {
      rerankEnabled: false,
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.trace.questionType).toBe('comparison');
    expect(result.trace.entities).toEqual(['向量', '关键词']);
  });

  it('marks rerank as skipped when no provider is configured', async () => {
    const result = await service.retrieve(`${runPrefix} 混合检索`, {
      documentIds: [hybrid.documentId],
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.trace.degraded).toContain('rerank_skipped');
    expect(result.trace.reranked).toBe(false);
  });
  it('falls back to keyword search when the vector store is down', async () => {
    const brokenQdrant = {
      search: async () => {
        throw new Error('qdrant down');
      },
    } as unknown as QdrantStore;
    const degradedService = new RetrievalService({
      prisma,
      embeddings,
      qdrant: brokenQdrant,
    });

    const result = await degradedService.retrieve(`${runPrefix} 混合检索`, {
      documentIds: [hybrid.documentId],
      rerankEnabled: false,
    });

    if (result.runId) runIds.push(result.runId);

    expect(result.trace.degraded).toContain('vector_unavailable');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.documentId === hybrid.documentId)).toBe(true);
  });

  it('degrades to vector search when keyword SQL fails', async () => {
    const brokenPrisma = {
      $queryRaw: async () => {
        throw new Error('db down');
      },
      chunk: { findMany: (args: never) => prisma.chunk.findMany(args) },
      documentVersion: { findMany: (args: never) => prisma.documentVersion.findMany(args) },
      retrievalRun: { create: async () => ({ id: 'stub-run' }) },
    } as unknown as PrismaClient;

    const degradedService = new RetrievalService({
      prisma: brokenPrisma,
      embeddings,
      qdrant,
    });
    const result = await degradedService.retrieve(sparse.texts[0]!, {
      documentIds: [sparse.documentId],
      vectorScoreThreshold: 0.5,
      rerankEnabled: false,
    });

    expect(result.trace.degraded).toContain('keyword_unavailable');
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('reorders candidates with a rerank provider without changing the set', async () => {
    const stubQdrant = {
      search: async () => [
        { id: hybrid.chunkIds[0], score: 0.9, payload: null },
        { id: hybrid.chunkIds[1], score: 0.8, payload: null },
      ],
    } as unknown as QdrantStore;

    const baseline = await new RetrievalService({
      prisma,
      embeddings,
      qdrant: stubQdrant,
    }).retrieve('召回与融合', { documentIds: [hybrid.documentId], rerankEnabled: false });
    if (baseline.runId) runIds.push(baseline.runId);

    const rerankingService = new RetrievalService({
      prisma,
      embeddings,
      qdrant: stubQdrant,
      reranker: {
        rerank: async (_question, candidates) =>
          [...candidates].reverse().map((candidate, index) => ({
            id: candidate.id,
            score: 1 - index * 0.1,
          })),
      },
    });
    const reranked = await rerankingService.retrieve('召回与融合', {
      documentIds: [hybrid.documentId],
    });
    if (reranked.runId) runIds.push(reranked.runId);

    expect(baseline.evidence.length).toBeGreaterThanOrEqual(2);
    expect(reranked.trace.reranked).toBe(true);
    expect(new Set(reranked.evidence.map((item) => item.chunkId))).toEqual(
      new Set(baseline.evidence.map((item) => item.chunkId)),
    );
    expect(reranked.evidence.map((item) => item.chunkId)).not.toEqual(
      baseline.evidence.map((item) => item.chunkId),
    );
  });
});

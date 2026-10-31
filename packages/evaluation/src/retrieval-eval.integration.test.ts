import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@kos/database';
import { FakeEmbeddingProvider } from '@kos/embeddings';
import { QdrantStore, RetrievalService } from '@kos/retrieval';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus, loadDataset, seedCorpus } from './corpus.js';
import { evaluateRetrieval, meetsGate, type EvalCase } from './retrieval-eval.js';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.QDRANT_URL);

const prisma = createPrismaClient(process.env.DATABASE_URL);
const embeddings = new FakeEmbeddingProvider(32);
const runId = randomUUID().slice(0, 8);
const fingerprintPrefix = `eval://${runId}`;
const collection = `kos_eval_${runId}`;
const qdrant = new QdrantStore({ url: process.env.QDRANT_URL ?? '', collection, vectorSize: 32 });
const startedAt = new Date();
const seededDocumentIds: string[] = [];

describe.skipIf(!enabled)('retrieval evaluation', () => {
  let cases: EvalCase[];
  let documentIds: string[];
  let service: RetrievalService;

  beforeAll(async () => {
    await qdrant.ensureCollection();
    await qdrant.createPayloadIndexes();

    const bySlug = await seedCorpus(loadCorpus(), {
      prisma,
      embeddings,
      qdrant,
      fingerprintPrefix,
    });
    documentIds = [...bySlug.values()];
    seededDocumentIds.push(...documentIds);
    cases = loadDataset().flatMap((item) => {
      const documentId = bySlug.get(item.expectedSlug);
      return documentId
        ? [
            {
              id: item.id,
              question: item.question,
              expectedDocumentId: documentId,
              ...(item.type ? { type: item.type } : {}),
            },
          ]
        : [];
    });
    service = new RetrievalService({ prisma, embeddings, qdrant });
  }, 120_000);

  afterAll(async () => {
    await qdrant.deleteCollection().catch(() => undefined);
    if (seededDocumentIds.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: seededDocumentIds } } });
    }
    await prisma.source.deleteMany({ where: { fingerprint: { startsWith: fingerprintPrefix } } });
    await prisma.retrievalRun.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.$disconnect();
  });

  it('meets the Recall@10 and MRR@10 gate on 50 questions', async () => {
    expect(cases).toHaveLength(50);

    const metrics = await evaluateRetrieval(cases, async (question) => {
      const result = await service.retrieve(question, {
        documentIds,
        finalTopK: 10,
        rerankEnabled: false,
      });
      return { documentIds: result.evidence.map((item) => item.documentId) };
    });

    expect(metrics.recallAt10).toBeGreaterThanOrEqual(0.85);
    expect(metrics.mrrAt10).toBeGreaterThanOrEqual(0.6);
    expect(meetsGate(metrics)).toBe(true);
  }, 180_000);
});

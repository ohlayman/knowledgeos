import { randomUUID } from 'node:crypto';
import { ChunkRepository, DocumentRepository, JobRepository, PrismaClient } from '@kos/database';
import { QdrantStore } from '@kos/retrieval';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { reconcileOnce, type ReconcileQueue } from './reconcile.js';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.QDRANT_URL);

const prisma = new PrismaClient();
const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const jobs = new JobRepository(prisma);
const collection = `kos_reconcile_${randomUUID().slice(0, 8)}`;
const qdrant = new QdrantStore({ url: process.env.QDRANT_URL ?? '', collection, vectorSize: 4 });
const names: string[] = [];
const documentIds: string[] = [];

describe.skipIf(!enabled)('reconcileOnce', () => {
  beforeAll(async () => {
    await qdrant.ensureCollection();
  });

  afterAll(async () => {
    await qdrant.deleteCollection().catch(() => undefined);
    if (documentIds.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    }
    await prisma.source.deleteMany({ where: { fingerprint: { in: names } } });
    await prisma.$disconnect();
  });

  it('re-enqueues queued jobs missing from Redis', async () => {
    const name = `reconcile-${randomUUID().slice(0, 8)}.md`;
    names.push(name);
    const created = await documents.createWithVersion({
      title: name,
      source: { type: 'file', fingerprint: name, identifier: name },
      version: { contentHash: randomUUID().replace(/-/g, '').padEnd(64, 'a') },
    });
    documentIds.push(created.documentId);

    const queue: ReconcileQueue = {
      has: vi.fn().mockResolvedValue(false),
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    const result = await reconcileOnce({ prisma, documents, chunks, jobs, qdrant, queue });

    expect(result.requeued).toBeGreaterThanOrEqual(1);
    expect(queue.enqueue).toHaveBeenCalledWith({
      jobId: created.jobId,
      documentId: created.documentId,
      versionId: created.versionId,
    });
  });

  it('skips queued jobs that still exist in Redis', async () => {
    const name = `reconcile-kept-${randomUUID().slice(0, 8)}.md`;
    names.push(name);
    const created = await documents.createWithVersion({
      title: name,
      source: { type: 'file', fingerprint: name, identifier: name },
      version: { contentHash: randomUUID().replace(/-/g, '').padEnd(64, 'b') },
    });
    documentIds.push(created.documentId);

    const queue: ReconcileQueue = {
      has: vi.fn().mockResolvedValue(true),
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    const result = await reconcileOnce({ prisma, documents, chunks, jobs, qdrant, queue });

    expect(result.requeued).toBe(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('deletes orphan vectors and keeps known chunks', async () => {
    const name = `reconcile-vector-${randomUUID().slice(0, 8)}.md`;
    names.push(name);
    const created = await documents.createWithVersion({
      title: name,
      source: { type: 'file', fingerprint: name, identifier: name },
      version: {
        contentHash: randomUUID().replace(/-/g, '').padEnd(64, 'c'),
        normalizedText: '一段用于对账的正文。',
        charCount: 10,
      },
    });
    documentIds.push(created.documentId);

    await chunks.replaceForVersion(created.documentId, created.versionId, [
      {
        chunkIndex: 0,
        text: '一段用于对账的正文。',
        tokenCount: 5,
        startOffset: 0,
        endOffset: 10,
        searchText: '一段 段用',
      },
    ]);
    const [known] = await chunks.listByVersion(created.versionId);

    const orphanId = randomUUID();
    await qdrant.upsert([
      {
        id: known!.id,
        vector: [1, 0, 0, 0],
        payload: {
          chunkId: known!.id,
          documentId: created.documentId,
          versionId: created.versionId,
          isCurrent: true,
          tags: [],
          type: 'text',
          createdAt: Date.now(),
        },
      },
      {
        id: orphanId,
        vector: [0, 1, 0, 0],
        payload: {
          chunkId: orphanId,
          documentId: created.documentId,
          versionId: created.versionId,
          isCurrent: true,
          tags: [],
          type: 'text',
          createdAt: Date.now(),
        },
      },
    ]);

    const queue: ReconcileQueue = {
      has: vi.fn().mockResolvedValue(true),
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    const result = await reconcileOnce({ prisma, documents, chunks, jobs, qdrant, queue });

    expect(result.orphansDeleted).toBe(1);
    expect(await qdrant.scrollIds()).toEqual([known!.id]);
  });
});

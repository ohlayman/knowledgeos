import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChunkRepository, createPrismaClient, DocumentRepository } from '@kos/database';
import { QdrantStore } from '@kos/retrieval';
import { buildSearchText } from '@kos/shared';
import { LocalStorageAdapter } from '@kos/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from './retention.js';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.QDRANT_URL);

const prisma = createPrismaClient(process.env.DATABASE_URL);
const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const collection = `kos_retention_${randomUUID().slice(0, 8)}`;
const qdrant = new QdrantStore({ url: process.env.QDRANT_URL ?? '', collection, vectorSize: 4 });
const title = `retention-${randomUUID().slice(0, 8)}`;

let root = '';
let storage: LocalStorageAdapter;
let documentId = '';
let versionId = '';
let storageKey = '';

describe.skipIf(!enabled)('retention', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kos-retention-'));
    storage = new LocalStorageAdapter(root);
    await qdrant.ensureCollection();

    const text = '保留策略测试文档。';
    storageKey = `ab/cd/${randomUUID().replace(/-/g, '').padEnd(64, '2')}`;
    await storage.put(storageKey, Buffer.from(text, 'utf8'), 'text/plain');

    const created = await documents.createWithVersion({
      title,
      source: { type: 'manual', fingerprint: title, identifier: title },
      version: {
        contentHash: randomUUID().replace(/-/g, '').padEnd(64, '3'),
        storageKey,
        storageSize: text.length,
        mimeType: 'text/plain',
        normalizedText: text,
        charCount: text.length,
      },
    });
    documentId = created.documentId;
    versionId = created.versionId;

    await chunks.replaceForVersion(documentId, versionId, [
      {
        chunkIndex: 0,
        text,
        tokenCount: 6,
        startOffset: 0,
        endOffset: text.length,
        searchText: buildSearchText(text),
      },
    ]);
    const [chunk] = await chunks.listByVersion(versionId);
    await qdrant.upsert([
      {
        id: chunk!.id,
        vector: [1, 0, 0, 0],
        payload: {
          chunkId: chunk!.id,
          documentId,
          versionId,
          isCurrent: true,
          tags: [],
          type: 'text',
          createdAt: Date.now(),
        },
      },
    ]);

    await prisma.document.update({
      where: { id: documentId },
      data: { isDeleted: true, deletedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
    });
  });

  afterAll(async () => {
    await qdrant.deleteCollection().catch(() => undefined);
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.source.deleteMany({ where: { fingerprint: title } });
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  });

  it('hard-deletes expired documents, vectors and objects', async () => {
    const result = await runRetention({ prisma, storage, qdrant });

    expect(result.documents).toBeGreaterThanOrEqual(1);
    expect(await prisma.document.findUnique({ where: { id: documentId } })).toBeNull();
    expect(await prisma.chunk.count({ where: { versionId } })).toBe(0);
    expect(await storage.exists(storageKey)).toBe(false);

    const event = await prisma.systemEvent.findFirst({
      where: { type: 'retention' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).not.toBeNull();
  });

  it('keeps documents deleted within the retention window', async () => {
    const kept = await documents.createWithVersion({
      title: `${title}-kept`,
      source: { type: 'manual', fingerprint: `${title}-kept`, identifier: `${title}-kept` },
      version: { contentHash: randomUUID().replace(/-/g, '').padEnd(64, '4') },
    });
    await prisma.document.update({
      where: { id: kept.documentId },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    await runRetention({ prisma, storage, qdrant });

    expect(await prisma.document.findUnique({ where: { id: kept.documentId } })).not.toBeNull();

    await prisma.document.deleteMany({ where: { id: kept.documentId } });
    await prisma.source.deleteMany({ where: { fingerprint: `${title}-kept` } });
  });
});

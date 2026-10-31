import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ChunkRepository, createPrismaClient, DocumentRepository } from '@kos/database';
import { QdrantStore } from '@kos/retrieval';
import { buildSearchText } from '@kos/shared';
import { LocalStorageAdapter } from '@kos/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from './maintenance-service.js';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.QDRANT_URL);

const destructive = process.env.RUN_DESTRUCTIVE_TESTS === '1';
const prisma = createPrismaClient(process.env.DATABASE_URL);
const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const collection = `kos_maintenance_${randomUUID().slice(0, 8)}`;
const qdrant = new QdrantStore({ url: process.env.QDRANT_URL ?? '', collection, vectorSize: 4 });
const title = `maintenance-${randomUUID().slice(0, 8)}`;

let root = '';
let storage: LocalStorageAdapter;
let service: MaintenanceService;
let documentId = '';
let versionId = '';
let storageKey = '';

describe.skipIf(!enabled)('MaintenanceService', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kos-maintenance-'));
    storage = new LocalStorageAdapter(root);
    service = new MaintenanceService(prisma, storage, qdrant);

    await qdrant.ensureCollection();
    const text = '导出与清理测试文档。';
    storageKey = `ab/cd/${randomUUID().replace(/-/g, '').padEnd(64, '0')}`;
    await storage.put(storageKey, Buffer.from(text, 'utf8'), 'text/plain');

    const created = await documents.createWithVersion({
      title,
      source: { type: 'manual', fingerprint: title, identifier: title },
      version: {
        contentHash: randomUUID().replace(/-/g, '').padEnd(64, '1'),
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
        tokenCount: 8,
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

  it('exports a zip with a manifest and no secrets', async () => {
    const bundle = await service.exportBundle();
    const zip = await JSZip.loadAsync(bundle);

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      format: string;
      counts: { documents: number };
    };
    expect(manifest.format).toBe('knowledgeos-export');
    expect(manifest.counts.documents).toBeGreaterThanOrEqual(1);

    expect(zip.file('documents.json')).toBeTruthy();
    expect(zip.file('chunks.json')).toBeTruthy();

    const providers = await zip.file('providers.json')!.async('string');
    expect(providers).not.toContain('apiKeyEncrypted');
  });

  it('rejects clearing without the confirmation word', async () => {
    await expect(service.clear('delete')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it.skipIf(!destructive)('clears documents, vectors and objects', async () => {
    const result = await service.clear('DELETE');

    expect(result.documents).toBeGreaterThanOrEqual(1);
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.chunk.count()).toBe(0);
    expect(await storage.exists(storageKey)).toBe(false);

    const store = await qdrant.listCollections();
    expect(store).not.toContain(collection);
  });
});

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository, PrismaClient } from '@kos/database';
import { LocalStorageAdapter } from '@kos/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentService } from './document-service.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
const fileName = `notes-${randomUUID()}.md`;
const fingerprint = fileName.toLowerCase();

let root = '';
let documentId = '';

describe.skipIf(!enabled)('DocumentService', () => {
  let service: DocumentService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kos-doc-service-'));
    service = new DocumentService(new DocumentRepository(prisma), new LocalStorageAdapter(root));
  });

  afterAll(async () => {
    if (documentId) {
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
    await prisma.source.deleteMany({ where: { fingerprint } });
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  });

  it('ingests a file, detects duplicates, and appends a new version', async () => {
    const first = await service.ingestFile({
      fileName,
      buffer: Buffer.from('# version one'),
      mimeType: 'text/markdown',
      tags: ['test'],
    });
    expect(first.status).toBe('queued');
    expect(first.documentId).toBeTruthy();
    expect(first.jobId).toBeTruthy();
    documentId = first.documentId;

    const duplicate = await service.ingestFile({
      fileName: `copy-${fileName}`,
      buffer: Buffer.from('# version one'),
      mimeType: 'text/markdown',
      tags: [],
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.documentId).toBe(first.documentId);

    const second = await service.ingestFile({
      fileName,
      buffer: Buffer.from('# version two'),
      mimeType: 'text/markdown',
      tags: [],
    });
    expect(second.status).toBe('queued');
    expect(second.documentId).toBe(first.documentId);

    const detail = await new DocumentRepository(prisma).getById(first.documentId);
    expect(detail?.tags).toEqual(['test']);
    expect(detail?.currentVersion?.versionNo).toBe(2);
  });
});

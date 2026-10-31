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

  it('ingests manual text, dedupes content, and appends versions by title', async () => {
    const title = `Manual ${randomUUID()}`;
    const copyTitle = `${title} copy`;
    const content = `alpha-${randomUUID()}`;
    const nextContent = `beta-${randomUUID()}`;

    const first = await service.ingestText({ title, content, tags: ['manual'] });
    expect(first.status).toBe('queued');

    const duplicate = await service.ingestText({
      title: copyTitle,
      content,
      tags: [],
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.documentId).toBe(first.documentId);

    const second = await service.ingestText({
      title,
      content: nextContent,
      tags: [],
    });
    expect(second.status).toBe('queued');
    expect(second.documentId).toBe(first.documentId);

    const detail = await new DocumentRepository(prisma).getById(first.documentId);
    expect(detail?.currentVersion?.versionNo).toBe(2);
    expect(detail?.sources).toHaveLength(2);

    await prisma.document.deleteMany({ where: { id: first.documentId } });
    await prisma.source.deleteMany({
      where: { fingerprint: { in: [title.toLowerCase(), copyTitle.toLowerCase()] } },
    });
  });

  it('ingests a URL, dedupes content, and appends versions by URL', async () => {
    const url = `https://example.com/notes/${randomUUID()}`;
    const copyUrl = `https://example.com/copy/${randomUUID()}`;
    const alpha = Buffer.from('<html><body>alpha</body></html>');
    const beta = Buffer.from('<html><body>beta</body></html>');

    const first = await service.ingestUrl({
      url,
      finalUrl: url,
      buffer: alpha,
      mimeType: 'text/html',
    });
    expect(first.status).toBe('queued');

    const duplicate = await service.ingestUrl({
      url: copyUrl,
      finalUrl: copyUrl,
      buffer: alpha,
      mimeType: 'text/html',
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.documentId).toBe(first.documentId);

    const second = await service.ingestUrl({
      url,
      finalUrl: url,
      buffer: beta,
      mimeType: 'text/html',
    });
    expect(second.status).toBe('queued');
    expect(second.documentId).toBe(first.documentId);

    const detail = await new DocumentRepository(prisma).getById(first.documentId);
    expect(detail?.currentVersion?.versionNo).toBe(2);
    expect(detail?.sources).toHaveLength(2);

    await prisma.document.deleteMany({ where: { id: first.documentId } });
    await prisma.source.deleteMany({
      where: { fingerprint: { in: [url, copyUrl] } },
    });
  });
});

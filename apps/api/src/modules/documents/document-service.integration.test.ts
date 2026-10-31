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
const runId = randomUUID().slice(0, 8);
const fileName = `notes-${runId}.md`;
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
      buffer: Buffer.from(`# version one ${runId}`),
      mimeType: 'text/markdown',
      tags: ['test'],
    });
    expect(first.status).toBe('queued');
    expect(first.documentId).toBeTruthy();
    expect(first.jobId).toBeTruthy();
    documentId = first.documentId;

    const duplicate = await service.ingestFile({
      fileName: `copy-${fileName}`,
      buffer: Buffer.from(`# version one ${runId}`),
      mimeType: 'text/markdown',
      tags: [],
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.documentId).toBe(first.documentId);

    const second = await service.ingestFile({
      fileName,
      buffer: Buffer.from(`# version two ${runId}`),
      mimeType: 'text/markdown',
      tags: [],
    });
    expect(second.status).toBe('queued');
    expect(second.documentId).toBe(first.documentId);

    const detail = await new DocumentRepository(prisma).getById(first.documentId);
    expect(detail?.tags).toEqual(['test']);
    expect(detail?.currentVersion?.versionNo).toBe(2);
    expect(detail?.currentVersion?.normalizedText).toBe(`version two ${runId}`);

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: first.documentId },
      orderBy: { versionNo: 'asc' },
    });
    expect(versions.map((item) => item.isCurrent)).toEqual([false, true]);
    expect(versions[1]?.charCount).toBe(`version two ${runId}`.length);
  });

  it('同一内容以不同来源导入时归并到同一文档', async () => {
    const title = `Cross ${randomUUID()}`;
    const content = `同一段内容 ${randomUUID()}`;
    const textFileName = `${title}.txt`;

    const first = await service.ingestText({ title, content, tags: [] });
    expect(first.status).toBe('queued');

    const sameContentFile = await service.ingestFile({
      fileName: textFileName,
      buffer: Buffer.from(content, 'utf8'),
      mimeType: 'text/plain',
      tags: [],
    });
    expect(sameContentFile.status).toBe('duplicate');
    expect(sameContentFile.documentId).toBe(first.documentId);

    const detail = await new DocumentRepository(prisma).getById(first.documentId);
    expect(detail?.sources).toHaveLength(2);
    expect(detail?.currentVersion?.versionNo).toBe(1);

    await prisma.document.deleteMany({ where: { id: first.documentId } });
    await prisma.source.deleteMany({
      where: { fingerprint: { in: [title.toLowerCase(), textFileName.toLowerCase()] } },
    });
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

  it('lists, filters, updates and soft deletes a document', async () => {
    const title = `List ${randomUUID()}`;
    const tag = `tag-${randomUUID().slice(0, 8)}`;
    const created = await service.ingestText({
      title,
      content: `列表内容 ${randomUUID()}`,
      tags: [tag],
    });

    const listed = await service.listDocuments({ tag, type: 'manual', limit: 10 });
    expect(listed.items.some((item) => item.id === created.documentId)).toBe(true);

    const detail = await service.getDocument(created.documentId);
    expect(detail.title).toBe(title);
    expect(detail.versions).toHaveLength(1);

    const updated = await service.updateDocument(created.documentId, {
      title: `${title} 改名`,
      tags: ['renamed'],
    });
    expect(updated.title).toBe(`${title} 改名`);
    expect(updated.tags).toEqual(['renamed']);

    await service.deleteDocument(created.documentId);
    await expect(service.getDocument(created.documentId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const afterDelete = await service.listDocuments({ tag, limit: 10 });
    expect(afterDelete.items.some((item) => item.id === created.documentId)).toBe(false);

    await prisma.document.deleteMany({ where: { id: created.documentId } });
    await prisma.source.deleteMany({ where: { fingerprint: title.toLowerCase() } });
  });

  it('ingests a URL, dedupes content, and appends versions by URL', async () => {
    const url = `https://example.com/notes/${randomUUID()}`;
    const copyUrl = `https://example.com/copy/${randomUUID()}`;
    const alpha = Buffer.from(`<html><body>alpha ${runId}</body></html>`);
    const beta = Buffer.from(`<html><body>beta ${runId}</body></html>`);

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

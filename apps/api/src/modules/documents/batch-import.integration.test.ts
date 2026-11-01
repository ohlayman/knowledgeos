import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import { DocumentRepository, PrismaClient } from '@kos/database';
import type { Env } from '@kos/shared';
import { LocalStorageAdapter } from '@kos/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AppDeps } from '../../deps.js';
import { DocumentService } from './document-service.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
const runId = randomUUID().slice(0, 8);

let root = '';
let app: ReturnType<typeof buildApp>;
const fingerprints: string[] = [];

function batchFiles() {
  const form = new FormData();

  for (let index = 0; index < 190; index += 1) {
    const name = `batch-${runId}-${index}.md`;
    fingerprints.push(name);
    form.append('files', Buffer.from(`# 文档 ${index}\n\n正文内容 ${index} ${runId}`, 'utf8'), {
      filename: name,
      contentType: 'text/markdown',
    });
  }

  for (let index = 0; index < 10; index += 1) {
    const name = `broken-${runId}-${index}.md`;
    fingerprints.push(name);
    form.append('files', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), {
      filename: name,
      contentType: 'text/markdown',
    });
  }

  return form;
}

describe.skipIf(!enabled)('POST /api/v1/documents/files batch import', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kos-batch-'));
    const storage = new LocalStorageAdapter(root);

    const deps: AppDeps = {
      env: { WEB_ORIGIN: 'http://localhost:5173' } as unknown as Env,
      db: { ping: async () => undefined, close: async () => undefined },
      redis: { ping: async () => undefined, close: async () => undefined },
      qdrant: { ping: async () => undefined },
      prisma,
      storage,
      queue: { close: async () => undefined },
      documents: new DocumentService(new DocumentRepository(prisma), storage),
      retrieval: {} as AppDeps['retrieval'],
      conversations: {} as AppDeps['conversations'],
      settings: {} as AppDeps['settings'],
      metrics: {} as AppDeps['metrics'],
      jobs: {} as AppDeps['jobs'],
      chunks: {} as AppDeps['chunks'],
      maintenance: {} as AppDeps['maintenance'],
      urlFetcher: {
        fetch: async () => {
          throw new Error('unused in batch import test');
        },
      },
      wiki: {} as AppDeps['wiki'],
      graph: {} as AppDeps['graph'],
      agents: {} as AppDeps['agents'],
    };

    app = buildApp(deps);
    await app.ready();
  });

  afterAll(async () => {
    const documents = await prisma.document.findMany({
      where: { sources: { some: { source: { fingerprint: { in: fingerprints } } } } },
      select: { id: true },
    });
    if (documents.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: documents.map((item) => item.id) } } });
    }
    await prisma.source.deleteMany({ where: { fingerprint: { in: fingerprints } } });
    await app.close();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  });

  it('imports 190 files and reports 10 corrupt files individually', async () => {
    const form = batchFiles();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/files',
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(response.statusCode).toBe(202);
    const items = response.json().items as Array<{
      fileName: string;
      status: string;
      errorCode?: string;
      message?: string;
      documentId?: string;
    }>;
    expect(items).toHaveLength(200);

    const queued = items.filter((item) => item.status === 'queued');
    const failed = items.filter((item) => item.status === 'failed');
    expect(queued).toHaveLength(190);
    expect(failed).toHaveLength(10);
    for (const item of failed) {
      expect(item.fileName.startsWith('broken-')).toBe(true);
      expect(item.errorCode).toBe('UNSUPPORTED_FORMAT');
      expect(item.message).toBeTruthy();
      expect(item.documentId).toBeUndefined();
    }

    const stored = await prisma.document.count({
      where: { sources: { some: { source: { fingerprint: { in: fingerprints } } } } },
    });
    expect(stored).toBe(190);

    const retry = new FormData();
    retry.append('files', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), {
      filename: `broken-${runId}-0.md`,
      contentType: 'text/markdown',
    });
    const retried = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/files',
      headers: retry.getHeaders(),
      payload: retry.getBuffer(),
    });
    expect(retried.json().items[0]).toMatchObject({
      status: 'failed',
      errorCode: 'UNSUPPORTED_FORMAT',
    });
  }, 60_000);
});

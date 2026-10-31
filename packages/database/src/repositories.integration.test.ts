import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ChunkRepository,
  ConversationRepository,
  DocumentRepository,
  JobRepository,
} from './repositories/index.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const prisma = new PrismaClient();

describe.skipIf(!enabled)('repositories', () => {
  const suffix = randomUUID();
  const sourceFingerprint = `test-${suffix}`;
  let documentId = '';

  afterAll(async () => {
    if (documentId) {
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
    await prisma.source.deleteMany({
      where: { fingerprint: { in: [sourceFingerprint, `${sourceFingerprint}-job`] } },
    });
    await prisma.conversation.deleteMany({ where: { title: `conv-${suffix}` } });
    await prisma.$disconnect();
  });

  it('creates a document with a version and job steps', async () => {
    const documents = new DocumentRepository(prisma);
    const created = await documents.createWithVersion({
      title: 'Test document',
      tags: ['rag', 'test'],
      source: {
        type: 'manual',
        fingerprint: sourceFingerprint,
        identifier: 'test-source',
      },
      version: {
        contentHash: `hash-${suffix}`,
        originalFilename: 'test.md',
      },
    });
    documentId = created.documentId;

    const detail = await documents.getById(documentId);
    expect(detail?.tags).toEqual(['rag', 'test']);
    expect(detail?.currentVersion?.id).toBe(created.versionId);

    const found = await documents.findVersionByContentHash(`hash-${suffix}`);
    expect(found?.documentId).toBe(documentId);

    const jobs = new JobRepository(prisma);
    const job = await jobs.getById(created.jobId);
    expect(job?.steps).toHaveLength(7);
  });

  it('appends a new version and switches the current version', async () => {
    const documents = new DocumentRepository(prisma);
    const appended = await documents.appendVersion(documentId, {
      contentHash: `hash2-${suffix}`,
    });

    const versions = await documents.listVersions(documentId);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.id).toBe(appended.versionId);
    expect(versions[0]?.isCurrent).toBe(true);
    expect(versions[1]?.isCurrent).toBe(false);
  });

  it('upserts chunks and marks vectors ready', async () => {
    const documents = new DocumentRepository(prisma);
    const current = await documents.getById(documentId);
    const versionId = current?.currentVersion?.id;
    expect(versionId).toBeTruthy();

    const chunks = new ChunkRepository(prisma);
    await chunks.replaceForVersion(documentId, versionId!, [
      {
        chunkIndex: 0,
        text: 'hello world',
        tokenCount: 2,
        startOffset: 0,
        endOffset: 11,
        searchText: 'hello world',
      },
      {
        chunkIndex: 1,
        text: 'second chunk',
        tokenCount: 2,
        startOffset: 12,
        endOffset: 24,
        searchText: 'second chunk',
        type: 'code',
      },
    ]);

    const list = await chunks.listByVersion(versionId!);
    expect(list).toHaveLength(2);
    expect(list[1]?.type).toBe('code');

    await chunks.markVectorReady(
      list.map((chunk) => chunk.id),
      'test-model',
      8,
    );

    const ready = await chunks.listByVersion(versionId!);
    expect(ready.every((chunk) => chunk.vectorStatus === 'ready')).toBe(true);
  });

  it('updates job and step status', async () => {
    const documents = new DocumentRepository(prisma);
    const created = await documents.createWithVersion({
      title: 'Job test',
      source: {
        type: 'manual',
        fingerprint: `${sourceFingerprint}-job`,
        identifier: 'job-source',
      },
      version: { contentHash: `hash-job-${suffix}` },
    });

    const jobs = new JobRepository(prisma);
    await jobs.updateStep(created.jobId, 'parse', {
      status: 'succeeded',
      outputSummary: { chars: 10 },
    });
    await jobs.updateJob(created.jobId, { status: 'succeeded', currentStep: 'index' });

    const job = await jobs.getById(created.jobId);
    expect(job?.status).toBe('succeeded');
    expect(job?.steps.find((step) => step.step === 'parse')?.status).toBe('succeeded');

    await prisma.document.deleteMany({ where: { id: created.documentId } });
  });

  it('creates a conversation and message', async () => {
    const conversations = new ConversationRepository(prisma);
    const conversation = await conversations.create(`conv-${suffix}`);
    const message = await conversations.createMessage(conversation.id, {
      role: 'user',
      content: 'hello',
      clientMessageId: `client-${suffix}`,
    });

    const detail = await conversations.getById(conversation.id);
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0]?.id).toBe(message.id);
  });
});

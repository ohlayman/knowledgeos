import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository, JobRepository, PrismaClient } from '@kos/database';
import { buildObjectKey, LocalStorageAdapter } from '@kos/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobService, type JobQueueActions } from './job-service.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
const documents = new DocumentRepository(prisma);
const jobs = new JobRepository(prisma);
const name = `job-service-${randomUUID().slice(0, 8)}.md`;

let root = '';
let documentId = '';
let versionId = '';
let jobId = '';
let service: JobService;
let queue: { retry: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };

describe.skipIf(!enabled)('JobService', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kos-job-service-'));
    const storage = new LocalStorageAdapter(root);
    const storageKey = buildObjectKey(randomUUID().replace(/-/g, '').padEnd(64, '0'));
    await storage.put(storageKey, Buffer.from('# job', 'utf8'), 'text/markdown');

    const created = await documents.createWithVersion({
      title: name,
      source: { type: 'file', fingerprint: name, identifier: name },
      version: {
        contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        fileHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        storageKey,
        storageSize: 5,
        mimeType: 'text/markdown',
        originalFilename: name,
      },
    });
    documentId = created.documentId;
    versionId = created.versionId;
    jobId = created.jobId;

    queue = { retry: vi.fn(), cancel: vi.fn() };
    service = new JobService(prisma, jobs, queue as unknown as JobQueueActions);

    await prisma.jobStep.updateMany({
      where: { jobId, step: { in: ['parse', 'clean', 'metadata', 'dedupe'] } },
      data: { status: 'succeeded' },
    });
    await prisma.jobStep.update({
      where: { jobId_step: { jobId, step: 'chunk' } },
      data: { status: 'failed', errorCode: 'INTERNAL', errorMessage: 'boom' },
    });
    await prisma.processingJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorCode: 'INTERNAL', errorMessage: 'boom' },
    });
  });

  afterAll(async () => {
    if (documentId) {
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
    await prisma.source.deleteMany({ where: { fingerprint: name } });
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  });

  it('retries from the requested step and keeps earlier steps', async () => {
    const updated = await service.retry(jobId, { mode: 'step', step: 'chunk' });

    expect(updated.status).toBe('queued');
    expect(updated.errorCode).toBeNull();
    expect(updated.steps.find((step) => step.step === 'parse')?.status).toBe('succeeded');
    expect(updated.steps.find((step) => step.step === 'chunk')?.status).toBe('pending');
    expect(updated.steps.find((step) => step.step === 'embed')?.status).toBe('pending');
    expect(queue.retry).toHaveBeenCalledWith({ jobId, documentId, versionId });
  });

  it('rejects retry while the job is queued', async () => {
    await expect(service.retry(jobId, { mode: 'full' })).rejects.toMatchObject({
      code: 'JOB_ALREADY_RUNNING',
    });
  });

  it('cancels a running job and skips pending steps', async () => {
    await prisma.processingJob.update({ where: { id: jobId }, data: { status: 'running' } });

    await service.cancel(jobId);

    const job = await jobs.getById(jobId);
    expect(job?.status).toBe('canceled');
    expect(job?.steps.every((step) => step.status !== 'pending')).toBe(true);
    expect(queue.cancel).toHaveBeenCalledWith(jobId);
  });

  it('rejects cancel for a finished job', async () => {
    await expect(service.cancel(jobId)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

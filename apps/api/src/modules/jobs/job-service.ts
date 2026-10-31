import type { JobRepository, JobStatus, PrismaClient } from '@kos/database';
import type { IngestJobData } from '@kos/queue';
import { ApiError, type JobRetryInput } from '@kos/shared';

export interface JobQueueActions {
  retry(data: IngestJobData): Promise<void>;
  cancel(jobId: string): Promise<void>;
}

export class JobService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jobs: JobRepository,
    private readonly queue: JobQueueActions,
  ) {}

  async list(params: { status?: JobStatus; cursor?: string; limit?: number }) {
    return this.jobs.list(params);
  }

  async get(id: string) {
    const job = await this.jobs.getById(id);
    if (!job) {
      throw new ApiError('NOT_FOUND', '任务不存在');
    }
    return job;
  }

  async retry(id: string, input: JobRetryInput) {
    const job = await this.jobs.getById(id);
    if (!job) {
      throw new ApiError('NOT_FOUND', '任务不存在');
    }
    if (job.status === 'queued' || job.status === 'running') {
      throw new ApiError('JOB_ALREADY_RUNNING');
    }

    const startIndex =
      input.mode === 'step' ? job.steps.findIndex((step) => step.step === input.step) : 0;
    if (startIndex < 0) {
      throw new ApiError('INVALID_ARGUMENT', '步骤不存在');
    }

    const fromOrder = job.steps[startIndex]?.stepOrder ?? 0;

    await this.prisma.$transaction(async (tx) => {
      for (const step of job.steps) {
        if (step.stepOrder < fromOrder) {
          continue;
        }
        await tx.jobStep.update({
          where: { jobId_step: { jobId: id, step: step.step } },
          data: {
            status: 'pending',
            errorCode: null,
            errorMessage: null,
            errorStack: null,
            startedAt: null,
            finishedAt: null,
          },
        });
      }

      await tx.processingJob.update({
        where: { id },
        data: {
          status: 'queued',
          currentStep: null,
          errorCode: null,
          errorMessage: null,
          errorStack: null,
          startedAt: null,
          finishedAt: null,
        },
      });
    });

    await this.queue.retry({
      jobId: job.id,
      documentId: job.documentId,
      versionId: job.versionId,
    });

    return this.get(id);
  }

  async cancel(id: string): Promise<void> {
    const job = await this.jobs.getById(id);
    if (!job) {
      throw new ApiError('NOT_FOUND', '任务不存在');
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new ApiError('INVALID_ARGUMENT', '任务已结束，无法取消');
    }

    await this.jobs.cancel(id);
    await this.queue.cancel(id);
  }
}

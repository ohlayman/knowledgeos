import type { JobStatus, JobStepName, Prisma, PrismaClient, StepStatus } from '@prisma/client';

export interface UpdateStepInput {
  status?: StepStatus;
  attempt?: number;
  startedAt?: Date;
  finishedAt?: Date;
  inputSummary?: Prisma.InputJsonValue;
  outputSummary?: Prisma.InputJsonValue;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
}

export interface UpdateJobInput {
  status?: JobStatus;
  currentStep?: JobStepName | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
}

export interface ListJobsParams {
  status?: JobStatus;
  cursor?: string;
  limit?: number;
}

export class JobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getById(id: string) {
    return this.prisma.processingJob.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        document: { select: { id: true, title: true } },
        version: { select: { id: true, versionNo: true, status: true } },
      },
    });
  }

  async list(params: ListJobsParams = {}) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const where: Prisma.ProcessingJobWhereInput = {
      ...(params.status ? { status: params.status } : {}),
    };

    if (params.cursor) {
      const cursorJob = await this.prisma.processingJob.findUnique({
        where: { id: params.cursor },
        select: { id: true, createdAt: true },
      });
      if (cursorJob) {
        where.AND = [
          {
            OR: [
              { createdAt: { lt: cursorJob.createdAt } },
              { createdAt: cursorJob.createdAt, id: { lt: cursorJob.id } },
            ],
          },
        ];
      }
    }

    const rows = await this.prisma.processingJob.findMany({
      where,
      include: {
        document: { select: { id: true, title: true } },
        version: { select: { id: true, versionNo: true, status: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? (items[items.length - 1]?.id ?? null) : null;

    return { items, nextCursor };
  }

  async updateStep(jobId: string, step: JobStepName, input: UpdateStepInput): Promise<void> {
    await this.prisma.jobStep.update({
      where: { jobId_step: { jobId, step } },
      data: input,
    });
  }

  async updateJob(jobId: string, input: UpdateJobInput): Promise<void> {
    await this.prisma.processingJob.update({
      where: { id: jobId },
      data: input,
    });
  }

  async findActiveByVersion(versionId: string) {
    return this.prisma.processingJob.findFirst({
      where: {
        versionId,
        status: { in: ['queued', 'running'] },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  async markInterruptedRunningJobs(): Promise<number> {
    const result = await this.prisma.processingJob.updateMany({
      where: { status: 'running' },
      data: {
        status: 'failed',
        errorCode: 'WORKER_INTERRUPTED',
        errorMessage: 'Worker restarted before the job finished',
        finishedAt: new Date(),
      },
    });

    return result.count;
  }

  async cancel(jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.processingJob.update({
        where: { id: jobId },
        data: { status: 'canceled', finishedAt: new Date() },
      });
      await tx.jobStep.updateMany({
        where: { jobId, status: { in: ['pending', 'running'] } },
        data: { status: 'skipped', finishedAt: new Date() },
      });
    });
  }
}

import type { PrismaClient } from '@kos/database';

export interface QueueStats {
  getJobCounts(): Promise<Record<string, number>>;
}

export interface DashboardMetrics {
  documents: { total: number; ready: number; processing: number; failed: number };
  chunks: { total: number; vectorReady: number };
  storage: { bytes: number };
  jobs: { queued: number; running: number; failed: number };
  queue: {
    waiting: number;
    active: number;
    failed: number;
    completed: number;
    backlog: number;
    alert: boolean;
  };
  health: {
    lastEvent: {
      level: string;
      type: string;
      message: string;
      createdAt: string;
    } | null;
  };
  retrieval: { runs7d: number; p95Ms: number | null };
  messages: { citationFailRate: number | null };
  recentDocuments: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: Date;
  }>;
  recentJobs: Array<{
    id: string;
    documentId: string;
    documentTitle: string;
    status: string;
    currentStep: string | null;
    createdAt: Date;
  }>;
}

export class MetricsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue?: QueueStats,
  ) {}

  async overview(): Promise<DashboardMetrics> {
    const activeDocument = { isDeleted: false };

    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const [
      documentTotal,
      versionsByStatus,
      chunkTotal,
      chunkReady,
      storage,
      jobsByStatus,
      recentDocuments,
      recentJobs,
      lastEvent,
      retrievalStats,
      messageStats,
    ] = await Promise.all([
      this.prisma.document.count({ where: activeDocument }),
      this.prisma.documentVersion.groupBy({
        by: ['status'],
        where: { isCurrent: true, document: activeDocument },
        _count: { _all: true },
      }),
      this.prisma.chunk.count({ where: { document: activeDocument } }),
      this.prisma.chunk.count({
        where: { vectorStatus: 'ready', document: activeDocument },
      }),
      this.prisma.documentVersion.aggregate({
        where: { isCurrent: true, document: activeDocument },
        _sum: { storageSize: true },
      }),
      this.prisma.processingJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.document.findMany({
        where: activeDocument,
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          currentVersion: { select: { status: true } },
        },
      }),
      this.prisma.processingJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          documentId: true,
          status: true,
          currentStep: true,
          createdAt: true,
          document: { select: { title: true } },
        },
      }),
      this.prisma.systemEvent.findFirst({ orderBy: { createdAt: 'desc' } }),
      this.prisma.$queryRaw<Array<{ total: bigint; p95: number | null }>>`
        SELECT count(*)::bigint AS total,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
        FROM retrieval_runs
        WHERE created_at >= ${since7d}
      `,
      this.prisma.$queryRaw<Array<{ total: bigint; failed: bigint }>>`
        SELECT count(*)::bigint AS total,
               count(*) FILTER (
                 WHERE citation_check IS NOT NULL
                   AND citation_check->>'status' IN ('partial', 'failed')
               )::bigint AS failed
        FROM messages
        WHERE role = 'assistant' AND created_at >= ${since7d}
      `,
    ]);

    const queueCounts: Record<string, number> = this.queue
      ? await this.queue.getJobCounts().catch(() => ({}))
      : {};
    const waiting = Number(queueCounts.wait ?? 0) + Number(queueCounts.delayed ?? 0);
    const backlog = waiting + Number(queueCounts.active ?? 0);

    const versionCounts = new Map(versionsByStatus.map((row) => [row.status, row._count._all]));
    const jobCounts = new Map(jobsByStatus.map((row) => [row.status, row._count._all]));

    return {
      documents: {
        total: documentTotal,
        ready: versionCounts.get('ready') ?? 0,
        processing: (versionCounts.get('processing') ?? 0) + (versionCounts.get('queued') ?? 0),
        failed: (versionCounts.get('failed') ?? 0) + (versionCounts.get('needs_ocr') ?? 0),
      },
      chunks: { total: chunkTotal, vectorReady: chunkReady },
      storage: { bytes: storage._sum.storageSize ?? 0 },
      jobs: {
        queued: jobCounts.get('queued') ?? 0,
        running: jobCounts.get('running') ?? 0,
        failed: jobCounts.get('failed') ?? 0,
      },
      recentDocuments: recentDocuments.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.currentVersion?.status ?? 'queued',
        updatedAt: row.updatedAt,
      })),
      queue: {
        waiting,
        active: Number(queueCounts.active ?? 0),
        failed: Number(queueCounts.failed ?? 0),
        completed: Number(queueCounts.completed ?? 0),
        backlog,
        alert: backlog > 100,
      },
      health: {
        lastEvent: lastEvent
          ? {
              level: lastEvent.level,
              type: lastEvent.type,
              message: lastEvent.message,
              createdAt: lastEvent.createdAt.toISOString(),
            }
          : null,
      },
      retrieval: {
        runs7d: Number(retrievalStats[0]?.total ?? 0),
        p95Ms: retrievalStats[0]?.p95 ?? null,
      },
      messages: {
        citationFailRate:
          Number(messageStats[0]?.total ?? 0) === 0
            ? null
            : Number(messageStats[0]?.failed ?? 0) / Number(messageStats[0]?.total ?? 1),
      },
      recentJobs: recentJobs.map((row) => ({
        id: row.id,
        documentId: row.documentId,
        documentTitle: row.document.title,
        status: row.status,
        currentStep: row.currentStep,
        createdAt: row.createdAt,
      })),
    };
  }
}

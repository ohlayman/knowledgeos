import type { PrismaClient } from '@kos/database';

export interface DashboardMetrics {
  documents: { total: number; ready: number; processing: number; failed: number };
  chunks: { total: number; vectorReady: number };
  storage: { bytes: number };
  jobs: { queued: number; running: number; failed: number };
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
  constructor(private readonly prisma: PrismaClient) {}

  async overview(): Promise<DashboardMetrics> {
    const activeDocument = { isDeleted: false };

    const [
      documentTotal,
      versionsByStatus,
      chunkTotal,
      chunkReady,
      storage,
      jobsByStatus,
      recentDocuments,
      recentJobs,
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
    ]);

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

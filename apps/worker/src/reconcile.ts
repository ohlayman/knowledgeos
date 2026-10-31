import type {
  ChunkRepository,
  DocumentRepository,
  JobRepository,
  PrismaClient,
} from '@kos/database';
import type { IngestJobData } from '@kos/queue';
import type { QdrantStore } from '@kos/retrieval';

export interface ReconcileQueue {
  has(jobId: string): Promise<boolean>;
  enqueue(data: IngestJobData): Promise<void>;
}

export interface ReconcileDeps {
  prisma: PrismaClient;
  documents: DocumentRepository;
  chunks: ChunkRepository;
  jobs: JobRepository;
  qdrant: QdrantStore;
  queue: ReconcileQueue;
}

export interface ReconcileResult {
  requeued: number;
  orphansDeleted: number;
}

function isMissingCollection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|404/i.test(message);
}

export async function reconcileOnce(deps: ReconcileDeps): Promise<ReconcileResult> {
  const queued = await deps.prisma.processingJob.findMany({
    where: { status: 'queued' },
    select: { id: true, documentId: true, versionId: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  let requeued = 0;
  for (const job of queued) {
    if (await deps.queue.has(job.id)) {
      continue;
    }
    await deps.queue.enqueue({
      jobId: job.id,
      documentId: job.documentId,
      versionId: job.versionId,
    });
    requeued += 1;
  }

  let orphansDeleted = 0;
  try {
    const ids = await deps.qdrant.scrollIds();
    const existing = await deps.chunks.findExistingIds(ids);
    const orphans = ids.filter((id) => !existing.has(id));
    if (orphans.length > 0) {
      await deps.qdrant.deleteByIds(orphans);
      orphansDeleted = orphans.length;
    }
  } catch (error) {
    if (!isMissingCollection(error)) {
      throw error;
    }
  }

  return { requeued, orphansDeleted };
}

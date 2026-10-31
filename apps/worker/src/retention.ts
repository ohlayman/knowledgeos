import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@kos/database';
import type { QdrantStore } from '@kos/retrieval';
import type { StorageAdapter } from '@kos/storage';

export interface RetentionDeps {
  prisma: PrismaClient;
  storage: StorageAdapter;
  qdrant: QdrantStore;
}

export interface RetentionResult {
  documents: number;
  objects: number;
  retrievalRuns: number;
  mcpLogs: number;
  events: number;
  idempotencyKeys: number;
}

const DAY = 24 * 60 * 60 * 1000;

export async function runRetention(
  deps: RetentionDeps,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const result: RetentionResult = {
    documents: 0,
    objects: 0,
    retrievalRuns: 0,
    mcpLogs: 0,
    events: 0,
    idempotencyKeys: 0,
  };

  const expiredDocuments = await deps.prisma.document.findMany({
    where: { isDeleted: true, deletedAt: { lte: new Date(now.getTime() - 30 * DAY) } },
    select: { id: true },
  });

  for (const document of expiredDocuments) {
    const versions = await deps.prisma.documentVersion.findMany({
      where: { documentId: document.id },
      select: { id: true, storageKey: true },
    });

    for (const version of versions) {
      await deps.qdrant.deleteByVersion(version.id).catch(() => undefined);
    }

    await deps.prisma.document.delete({ where: { id: document.id } });
    result.documents += 1;

    for (const version of versions) {
      if (!version.storageKey) {
        continue;
      }
      try {
        await deps.storage.delete(version.storageKey);
        result.objects += 1;
      } catch {
        // 对象可能已被清理
      }
    }
  }

  result.retrievalRuns = (
    await deps.prisma.retrievalRun.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY) } },
    })
  ).count;

  result.mcpLogs = (
    await deps.prisma.mcpAuditLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY) } },
    })
  ).count;

  result.events = (
    await deps.prisma.systemEvent.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 180 * DAY) } },
    })
  ).count;

  result.idempotencyKeys = (
    await deps.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } })
  ).count;

  await deps.prisma.systemEvent.create({
    data: {
      id: randomUUID(),
      level: 'info',
      type: 'retention',
      message: 'retention completed',
      metadata: { ...result },
    },
  });

  return result;
}

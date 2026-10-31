import { randomUUID } from 'node:crypto';
import type { ChunkType, Prisma, PrismaClient } from '@prisma/client';

export interface ChunkInput {
  chunkIndex: number;
  text: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  pageStart?: number;
  pageEnd?: number;
  headingPath?: string[];
  type?: ChunkType;
  location?: Prisma.InputJsonValue;
  searchText: string;
  suspicious?: boolean;
}

export class ChunkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceForVersion(
    documentId: string,
    versionId: string,
    chunks: ChunkInput[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const chunk of chunks) {
        await tx.chunk.upsert({
          where: {
            versionId_chunkIndex: {
              versionId,
              chunkIndex: chunk.chunkIndex,
            },
          },
          update: {
            text: chunk.text,
            tokenCount: chunk.tokenCount,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            headingPath: chunk.headingPath ?? [],
            type: chunk.type ?? 'text',
            location: chunk.location,
            searchText: chunk.searchText,
            suspicious: chunk.suspicious ?? false,
            vectorStatus: 'pending',
            embeddingModel: null,
            embeddingDim: null,
          },
          create: {
            id: randomUUID(),
            documentId,
            versionId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            tokenCount: chunk.tokenCount,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            headingPath: chunk.headingPath ?? [],
            type: chunk.type ?? 'text',
            location: chunk.location,
            searchText: chunk.searchText,
            suspicious: chunk.suspicious ?? false,
          },
        });
      }

      await tx.chunk.deleteMany({
        where: { versionId, chunkIndex: { gte: chunks.length } },
      });
    });
  }

  async listByVersion(versionId: string) {
    return this.prisma.chunk.findMany({
      where: { versionId },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  async getById(id: string) {
    return this.prisma.chunk.findUnique({ where: { id } });
  }

  async markVectorReady(ids: string[], model: string, dim: number): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.prisma.chunk.updateMany({
      where: { id: { in: ids } },
      data: {
        vectorStatus: 'ready',
        embeddingModel: model,
        embeddingDim: dim,
      },
    });
  }

  async findExistingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.chunk.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    return new Set(rows.map((row) => row.id));
  }

  async listMissingVectors(limit = 500) {
    return this.prisma.chunk.findMany({
      where: {
        vectorStatus: { not: 'ready' },
        version: { isCurrent: true },
        document: { isDeleted: false },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}

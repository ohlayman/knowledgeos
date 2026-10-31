import type { ChunkRepository, PrismaClient } from '@kos/database';
import { ApiError } from '@kos/shared';

export class ChunkService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chunks: ChunkRepository,
  ) {}

  async listByVersion(versionId: string) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: { id: true },
    });
    if (!version) {
      throw new ApiError('NOT_FOUND', '版本不存在');
    }

    return { items: await this.chunks.listByVersion(versionId) };
  }

  async get(id: string) {
    const chunk = await this.chunks.getById(id);
    if (!chunk) {
      throw new ApiError('NOT_FOUND', '块不存在');
    }
    return chunk;
  }
}

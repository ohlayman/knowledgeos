import JSZip from 'jszip';
import type { PrismaClient } from '@kos/database';
import type { QdrantStore } from '@kos/retrieval';
import type { StorageAdapter } from '@kos/storage';
import { ApiError } from '@kos/shared';

export interface ClearResult {
  documents: number;
  versions: number;
  objectsDeleted: number;
}

export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageAdapter,
    private readonly qdrant: QdrantStore,
  ) {}

  async exportBundle(): Promise<Buffer> {
    const [documents, versions, chunks, conversations, messages, citations, settings, providers] =
      await Promise.all([
        this.prisma.document.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.documentVersion.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.chunk.findMany({ orderBy: [{ versionId: 'asc' }, { chunkIndex: 'asc' }] }),
        this.prisma.conversation.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.message.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.citation.findMany({ orderBy: [{ messageId: 'asc' }, { ordinal: 'asc' }] }),
        this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } }),
        this.prisma.providerConfig.findMany({ orderBy: { updatedAt: 'desc' } }),
      ]);

    const exportedAt = new Date().toISOString();
    const zip = new JSZip();

    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          format: 'knowledgeos-export',
          version: 1,
          exportedAt,
          counts: {
            documents: documents.length,
            versions: versions.length,
            chunks: chunks.length,
            conversations: conversations.length,
            messages: messages.length,
            citations: citations.length,
            settings: settings.length,
          },
        },
        null,
        2,
      ),
    );

    zip.file('documents.json', JSON.stringify(documents, null, 2));
    zip.file('versions.json', JSON.stringify(versions, null, 2));
    zip.file('chunks.json', JSON.stringify(chunks, null, 2));
    zip.file('conversations.json', JSON.stringify(conversations, null, 2));
    zip.file('messages.json', JSON.stringify(messages, null, 2));
    zip.file('citations.json', JSON.stringify(citations, null, 2));
    zip.file('settings.json', JSON.stringify(settings, null, 2));
    zip.file(
      'providers.json',
      JSON.stringify(
        providers.map((provider) => ({
          id: provider.id,
          kind: provider.kind,
          provider: provider.provider,
          model: provider.model,
          baseUrl: provider.baseUrl,
          apiKeyLast4: provider.apiKeyLast4,
          isActive: provider.isActive,
          updatedAt: provider.updatedAt,
        })),
        null,
        2,
      ),
    );

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  async clear(confirm: string): Promise<ClearResult> {
    if (confirm !== 'DELETE') {
      throw new ApiError('INVALID_ARGUMENT', '需要输入 DELETE 才能清空知识库');
    }

    const versions = await this.prisma.documentVersion.findMany({
      select: { id: true, storageKey: true },
    });
    const documentCount = await this.prisma.document.count();

    await this.qdrant.deleteCollection().catch(() => undefined);

    await this.prisma.$transaction([
      this.prisma.citation.deleteMany({}),
      this.prisma.messageFeedback.deleteMany({}),
      this.prisma.message.deleteMany({}),
      this.prisma.retrievalRun.deleteMany({}),
      this.prisma.conversation.deleteMany({}),
      this.prisma.document.deleteMany({}),
      this.prisma.source.deleteMany({}),
    ]);

    const keys = [
      ...new Set(versions.flatMap((version) => (version.storageKey ? [version.storageKey] : []))),
    ];
    let objectsDeleted = 0;
    for (const key of keys) {
      try {
        await this.storage.delete(key);
        objectsDeleted += 1;
      } catch {
        // 对象可能已被清理，统计时忽略
      }
    }

    return {
      documents: documentCount,
      versions: versions.length,
      objectsDeleted,
    };
  }
}

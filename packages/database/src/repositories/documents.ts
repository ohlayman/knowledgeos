import { randomUUID } from 'node:crypto';
import type {
  JobStepName,
  JobType,
  Prisma,
  PrismaClient,
  SourceType,
  VersionStatus,
} from '@prisma/client';

const JOB_STEPS: JobStepName[] = [
  'parse',
  'clean',
  'metadata',
  'dedupe',
  'chunk',
  'embed',
  'index',
];

export interface VersionWriteInput {
  contentHash: string;
  fileHash?: string;
  storageKey?: string;
  storageSize?: number;
  mimeType?: string;
  originalFilename?: string;
  normalizedText?: string;
  charCount?: number;
  pageCount?: number;
  language?: string;
  metadata?: Prisma.InputJsonValue;
  parseWarnings?: Prisma.InputJsonValue;
}

export interface CreateDocumentInput {
  title: string;
  tags?: string[];
  ownerId?: string;
  jobType?: JobType;
  source: {
    type: SourceType;
    fingerprint: string;
    identifier: string;
    title?: string;
    metadata?: Prisma.InputJsonValue;
  };
  version: VersionWriteInput;
}

export interface AppendVersionInput extends VersionWriteInput {
  sourceId?: string;
}

export interface ListDocumentsParams {
  status?: VersionStatus;
  type?: SourceType;
  tags?: string[];
  q?: string;
  cursor?: string;
  limit?: number;
  includeDeleted?: boolean;
}

export interface DocumentListResult {
  items: Prisma.DocumentGetPayload<{ include: { currentVersion: true } }>[];
  nextCursor: string | null;
}

export class DocumentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findVersionByContentHash(
    contentHash: string,
  ): Promise<{ documentId: string; versionId: string; isCurrent: boolean } | null> {
    const version = await this.prisma.documentVersion.findFirst({
      where: { contentHash },
      select: { id: true, documentId: true, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    });

    return version
      ? { documentId: version.documentId, versionId: version.id, isCurrent: version.isCurrent }
      : null;
  }

  async findVersionByFileHash(
    fileHash: string,
  ): Promise<{ documentId: string; versionId: string } | null> {
    const version = await this.prisma.documentVersion.findFirst({
      where: { fileHash },
      select: { id: true, documentId: true },
      orderBy: { createdAt: 'desc' },
    });

    return version ? { documentId: version.documentId, versionId: version.id } : null;
  }

  async findDocumentBySource(
    type: SourceType,
    fingerprint: string,
  ): Promise<{ documentId: string; sourceId: string; currentVersionId: string | null } | null> {
    const link = await this.prisma.documentSource.findFirst({
      where: { source: { is: { type, fingerprint } } },
      select: {
        document: { select: { id: true, currentVersionId: true } },
        source: { select: { id: true } },
      },
    });

    return link
      ? {
          documentId: link.document.id,
          sourceId: link.source.id,
          currentVersionId: link.document.currentVersionId,
        }
      : null;
  }

  async createWithVersion(
    input: CreateDocumentInput,
  ): Promise<{ documentId: string; versionId: string; jobId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.source.upsert({
        where: {
          type_fingerprint: {
            type: input.source.type,
            fingerprint: input.source.fingerprint,
          },
        },
        update: {
          identifier: input.source.identifier,
          title: input.source.title,
          lastSeenAt: new Date(),
        },
        create: {
          id: randomUUID(),
          type: input.source.type,
          fingerprint: input.source.fingerprint,
          identifier: input.source.identifier,
          title: input.source.title,
          metadata: input.source.metadata,
        },
      });

      const document = await tx.document.create({
        data: {
          id: randomUUID(),
          ownerId: input.ownerId,
          title: input.title,
          tags: input.tags ?? [],
        },
      });

      const version = await tx.documentVersion.create({
        data: {
          id: randomUUID(),
          documentId: document.id,
          sourceId: source.id,
          versionNo: 1,
          contentHash: input.version.contentHash,
          fileHash: input.version.fileHash,
          storageKey: input.version.storageKey,
          storageSize: input.version.storageSize,
          mimeType: input.version.mimeType,
          originalFilename: input.version.originalFilename,
          normalizedText: input.version.normalizedText,
          charCount: input.version.charCount ?? 0,
          pageCount: input.version.pageCount,
          language: input.version.language,
          metadata: input.version.metadata,
          parseWarnings: input.version.parseWarnings,
          status: 'queued',
          isCurrent: true,
        },
      });

      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });

      await tx.documentSource.create({
        data: {
          documentId: document.id,
          sourceId: source.id,
          isPrimary: true,
        },
      });

      const job = await tx.processingJob.create({
        data: {
          id: randomUUID(),
          documentId: document.id,
          versionId: version.id,
          type: input.jobType ?? 'ingest',
          status: 'queued',
        },
      });

      await tx.jobStep.createMany({
        data: JOB_STEPS.map((step, stepOrder) => ({
          id: randomUUID(),
          jobId: job.id,
          step,
          stepOrder,
        })),
      });

      return { documentId: document.id, versionId: version.id, jobId: job.id };
    });
  }

  async attachSource(
    documentId: string,
    source: {
      type: SourceType;
      fingerprint: string;
      identifier: string;
      title?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<{ sourceId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.source.upsert({
        where: {
          type_fingerprint: {
            type: source.type,
            fingerprint: source.fingerprint,
          },
        },
        update: {
          identifier: source.identifier,
          title: source.title,
          lastSeenAt: new Date(),
        },
        create: {
          id: randomUUID(),
          type: source.type,
          fingerprint: source.fingerprint,
          identifier: source.identifier,
          title: source.title,
          metadata: source.metadata,
        },
      });

      await tx.documentSource.upsert({
        where: {
          documentId_sourceId: {
            documentId,
            sourceId: record.id,
          },
        },
        update: { lastSeenAt: new Date() },
        create: { documentId, sourceId: record.id },
      });

      return { sourceId: record.id };
    });
  }

  async appendVersion(
    documentId: string,
    input: AppendVersionInput,
  ): Promise<{ versionId: string; jobId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.documentVersion.aggregate({
        where: { documentId },
        _max: { versionNo: true },
      });
      const versionNo = (latest._max.versionNo ?? 0) + 1;

      await tx.documentVersion.updateMany({
        where: { documentId, isCurrent: true },
        data: { isCurrent: false },
      });

      const version = await tx.documentVersion.create({
        data: {
          id: randomUUID(),
          documentId,
          sourceId: input.sourceId,
          versionNo,
          contentHash: input.contentHash,
          fileHash: input.fileHash,
          storageKey: input.storageKey,
          storageSize: input.storageSize,
          mimeType: input.mimeType,
          originalFilename: input.originalFilename,
          normalizedText: input.normalizedText,
          charCount: input.charCount ?? 0,
          pageCount: input.pageCount,
          language: input.language,
          metadata: input.metadata,
          parseWarnings: input.parseWarnings,
          status: 'queued',
          isCurrent: true,
        },
      });

      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: version.id },
      });

      const job = await tx.processingJob.create({
        data: {
          id: randomUUID(),
          documentId,
          versionId: version.id,
          type: 'ingest',
          status: 'queued',
        },
      });

      await tx.jobStep.createMany({
        data: JOB_STEPS.map((step, stepOrder) => ({
          id: randomUUID(),
          jobId: job.id,
          step,
          stepOrder,
        })),
      });

      return { versionId: version.id, jobId: job.id };
    });
  }

  async list(params: ListDocumentsParams = {}): Promise<DocumentListResult> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const where: Prisma.DocumentWhereInput = {
      ...(params.includeDeleted ? {} : { isDeleted: false }),
      ...(params.status ? { currentVersion: { status: params.status } } : {}),
      ...(params.type ? { sources: { some: { source: { type: params.type } } } } : {}),
      ...(params.tags?.length ? { tags: { hasSome: params.tags } } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' as const } },
              { tags: { has: params.q } },
            ],
          }
        : {}),
    };

    if (params.cursor) {
      const cursorDocument = await this.prisma.document.findUnique({
        where: { id: params.cursor },
        select: { id: true, updatedAt: true },
      });
      if (cursorDocument) {
        where.AND = [
          {
            OR: [
              { updatedAt: { lt: cursorDocument.updatedAt } },
              { updatedAt: cursorDocument.updatedAt, id: { lt: cursorDocument.id } },
            ],
          },
        ];
      }
    }

    const rows = await this.prisma.document.findMany({
      where,
      include: { currentVersion: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? (items[items.length - 1]?.id ?? null) : null;

    return { items, nextCursor };
  }

  async getById(id: string) {
    return this.prisma.document.findUnique({
      where: { id },
      include: {
        currentVersion: true,
        sources: { include: { source: true } },
      },
    });
  }

  async updateTags(id: string, tags: string[]): Promise<void> {
    await this.prisma.document.update({ where: { id }, data: { tags } });
  }

  async update(id: string, input: { title?: string; tags?: string[] }): Promise<void> {
    await this.prisma.document.update({
      where: { id },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.document.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async listVersions(documentId: string) {
    return this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNo: 'desc' },
    });
  }

  async setCurrentVersion(documentId: string, versionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.documentVersion.findFirst({
        where: { id: versionId, documentId },
        select: { id: true },
      });
      if (!version) {
        throw new Error(`Version ${versionId} does not belong to document ${documentId}`);
      }

      await tx.documentVersion.updateMany({
        where: { documentId, isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.documentVersion.update({
        where: { id: versionId },
        data: { isCurrent: true },
      });
      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: versionId },
      });
    });
  }

  async updateVersionStatus(versionId: string, status: VersionStatus): Promise<void> {
    await this.prisma.documentVersion.update({
      where: { id: versionId },
      data: {
        status,
        ...(status === 'ready' ? { readyAt: new Date() } : {}),
      },
    });
  }
}

import type { PrismaClient, WikiRepository } from '@kos/database';
import { ApiError, type WikiContentInput } from '@kos/shared';
import { slugify, type WikiPageContent } from '@kos/wiki-engine';

interface ConflictEntry {
  type: string;
  subject?: string;
  predicate?: string;
  detail?: string;
  a?: { value: string; evidenceChunkId: string };
  b?: { value: string; evidenceChunkId: string };
  resolution?: string;
  reason?: string;
}

export interface ExtractionEnqueuer {
  (input: { documentId: string; versionId: string }): Promise<void>;
}

export class WikiService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly wiki: WikiRepository,
    private readonly enqueueExtraction?: ExtractionEnqueuer,
  ) {}

  async listPages(filter: { type?: string; status?: string; limit?: number }) {
    return this.wiki.listPages({
      ...(filter.type ? { type: filter.type as never } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.limit ? { limit: filter.limit } : {}),
    });
  }

  async getPage(slug: string) {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    const backlinks = await this.wiki.getBacklinks(page.id);
    const pending = await this.prisma.wikiProposal.findMany({
      where: { targetPageId: page.id, status: 'pending' },
      select: { conflicts: true },
    });
    const unresolvedConflicts = pending.reduce((sum, proposal) => {
      const conflicts = (proposal.conflicts as unknown as ConflictEntry[] | null) ?? [];
      return sum + conflicts.filter((conflict) => !conflict.resolution).length;
    }, 0);

    const evidenceChunkIds = [
      ...new Set(
        (
          (page.currentRevision?.content as unknown as WikiPageContent | undefined)?.paragraphs ??
          []
        ).flatMap((paragraph) => paragraph.evidenceChunkIds),
      ),
    ];
    const evidence = evidenceChunkIds.length
      ? await this.prisma.chunk.findMany({
          where: { id: { in: evidenceChunkIds } },
          select: { id: true, documentId: true, text: true },
        })
      : [];

    return { ...page, backlinks, unresolvedConflicts, evidence };
  }

  async createPage(input: {
    slug?: string;
    title: string;
    type: string;
    summary?: string;
    aliases?: string[];
  }) {
    const slug = input.slug ?? slugify(input.title);
    const existing = await this.prisma.wikiPage.findUnique({ where: { slug } });
    if (existing) {
      throw new ApiError('DUPLICATE_RESOURCE', '同名页面已存在');
    }

    const page = await this.wiki.createPage({
      slug,
      title: input.title,
      type: input.type as never,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.aliases ? { aliases: input.aliases } : {}),
    });

    await this.wiki.createRevision({
      pageId: page.id,
      editorType: 'human',
      content: { summary: input.summary ?? '', paragraphs: [] },
      changeSummary: '创建页面',
    });

    return this.getPage(slug);
  }

  async updatePage(
    slug: string,
    input: { title?: string; summary?: string; aliases?: string[]; archive?: boolean },
  ) {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    await this.wiki.updatePageMeta(page.id, {
      ...(input.title ? { title: input.title } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.aliases ? { aliases: input.aliases } : {}),
      ...(input.archive ? { status: 'archived' as never } : {}),
    });
    return this.getPage(slug);
  }

  async listRevisions(slug: string) {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    return page.revisions;
  }

  async saveRevision(
    slug: string,
    input: {
      content: WikiContentInput;
      baseRevisionId: string;
      changeSummary?: string;
    },
  ) {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    if (page.currentRevisionId !== input.baseRevisionId) {
      throw new ApiError('VERSION_CONFLICT', '页面已被更新，请先刷新再编辑');
    }

    const normalized: WikiPageContent = {
      summary: input.content.summary,
      paragraphs: input.content.paragraphs.map((paragraph) => ({
        ...paragraph,
        origin: 'human',
        versionIntroduced: paragraph.versionIntroduced ?? page.revisions.length + 1,
      })),
    };

    const revision = await this.wiki.createRevision({
      pageId: page.id,
      editorType: 'human',
      content: normalized,
      parentRevisionId: input.baseRevisionId,
      changeSummary: input.changeSummary ?? '人工编辑',
    });

    return { revision, page: await this.getPage(slug) };
  }

  async diff(slug: string, fromId: string, toId: string) {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    const from = page.revisions.find((revision) => revision.id === fromId);
    const to = page.revisions.find((revision) => revision.id === toId);
    if (!from || !to) {
      throw new ApiError('NOT_FOUND', '版本不存在');
    }

    const before = (from.content as unknown as WikiPageContent).paragraphs ?? [];
    const after = (to.content as unknown as WikiPageContent).paragraphs ?? [];
    const beforeById = new Map(before.map((paragraph) => [paragraph.id, paragraph]));
    const afterById = new Map(after.map((paragraph) => [paragraph.id, paragraph]));

    return {
      from: { id: from.id, revisionNo: from.revisionNo },
      to: { id: to.id, revisionNo: to.revisionNo },
      added: after.filter((paragraph) => !beforeById.has(paragraph.id)),
      removed: before.filter((paragraph) => !afterById.has(paragraph.id)),
      changed: after
        .filter((paragraph) => {
          const previous = beforeById.get(paragraph.id);
          return previous && previous.text !== paragraph.text;
        })
        .map((paragraph) => ({ before: beforeById.get(paragraph.id)!, after: paragraph })),
    };
  }

  async rollback(slug: string, targetRevisionId: string, reason: string) {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    const revision = await this.wiki.rollback(page.id, targetRevisionId, reason);
    return { revision, page: await this.getPage(slug) };
  }

  async listProposals(filter: { status?: string; limit?: number }) {
    return this.wiki.listProposals({
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.limit ? { limit: filter.limit } : {}),
    });
  }

  async getProposal(id: string) {
    const proposal = await this.wiki.getProposal(id);
    if (!proposal) {
      throw new ApiError('NOT_FOUND', '提案不存在');
    }
    const chunkIds = [
      ...new Set((proposal.evidence as unknown as { chunkIds?: string[] } | null)?.chunkIds ?? []),
    ];
    const evidenceChunks = chunkIds.length
      ? await this.prisma.chunk.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true, documentId: true, text: true },
        })
      : [];
    return { ...proposal, evidenceChunks };
  }

  async acceptProposal(id: string, baseRevisionId?: string) {
    const result = await this.wiki.acceptProposal(id, {
      ...(baseRevisionId ? { baseRevisionId } : {}),
    });
    if (result.status === 'stale') {
      throw new ApiError('VERSION_CONFLICT', '提案基于旧版本，请重新计算差异');
    }
    if (result.status === 'not_pending') {
      throw new ApiError('DUPLICATE_RESOURCE', '提案已处理');
    }
    if (result.status === 'invalid') {
      throw new ApiError('INVALID_ARGUMENT', `提案无法落库：${result.reason}`);
    }
    return { revisionId: result.revisionId, pageId: result.pageId };
  }

  async rejectProposal(id: string, reason: string, comment?: string) {
    return this.wiki.rejectProposal(id, {
      reason,
      ...(comment ? { comment } : {}),
    });
  }

  async rewriteProposal(
    id: string,
    input: { content: WikiContentInput; baseRevisionId: string; summary?: string },
  ) {
    const result = await this.wiki.rewriteProposal(id, {
      content: {
        summary: input.content.summary,
        paragraphs: input.content.paragraphs.map((paragraph) => ({
          ...paragraph,
          origin: 'human',
          versionIntroduced: paragraph.versionIntroduced ?? 1,
        })),
      },
      baseRevisionId: input.baseRevisionId,
      ...(input.summary ? { summary: input.summary } : {}),
    });
    if (result.status === 'stale') {
      throw new ApiError('VERSION_CONFLICT', '提案基于旧版本，请重新计算差异');
    }
    if (result.status === 'not_pending') {
      throw new ApiError('DUPLICATE_RESOURCE', '提案已处理');
    }
    if (result.status === 'invalid') {
      throw new ApiError('INVALID_ARGUMENT', `提案无法落库：${result.reason}`);
    }
    return { revisionId: result.revisionId, pageId: result.pageId };
  }

  async listReviewTasks(status = 'open') {
    return this.prisma.reviewTask.findMany({
      where: { status: status as never },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  async listConflicts() {
    const proposals = await this.prisma.wikiProposal.findMany({
      where: { status: 'pending' },
      include: { targetPage: true },
    });

    const seen = new Set<string>();
    return proposals.flatMap((proposal) => {
      const conflicts = (proposal.conflicts as unknown as ConflictEntry[] | null) ?? [];
      return conflicts
        .map((conflict, index) => ({
          id: `${proposal.id}:${index}`,
          proposalId: proposal.id,
          pageId: proposal.targetPageId,
          pageTitle: proposal.targetPage?.title ?? null,
          ...conflict,
        }))
        .filter((conflict) => {
          if (conflict.resolution) {
            return false;
          }
          const key = `${conflict.pageId ?? ''}|${conflict.type}|${conflict.predicate ?? ''}|${conflict.a?.value ?? ''}|${conflict.b?.value ?? ''}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
    });
  }

  async resolveConflict(id: string, resolution: string, reason?: string) {
    const [proposalId, indexText] = id.split(':');
    const index = Number(indexText);
    if (!proposalId || !Number.isInteger(index)) {
      throw new ApiError('INVALID_ARGUMENT', '冲突 ID 不合法');
    }

    const proposal = await this.prisma.wikiProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) {
      throw new ApiError('NOT_FOUND', '冲突不存在');
    }

    const conflicts = ((proposal.conflicts as unknown as ConflictEntry[] | null) ?? []).slice();
    const conflict = conflicts[index];
    if (!conflict) {
      throw new ApiError('NOT_FOUND', '冲突不存在');
    }

    conflicts[index] = {
      ...conflict,
      resolution,
      ...(reason ? { reason } : {}),
    };

    await this.prisma.wikiProposal.update({
      where: { id: proposalId },
      data: { conflicts: conflicts as never },
    });

    return { id, resolution, reason: reason ?? null };
  }

  async resolveStale(slug: string, action: 'confirm' | 'archive') {
    const page = await this.wiki.getPageBySlug(slug);
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }
    await this.wiki.resolveStale(page.id, action);
    return this.getPage(slug);
  }

  async listEntities(query?: string) {
    return this.prisma.entity.findMany({
      where: {
        status: 'active',
        ...(query ? { canonicalName: { contains: query, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ mentionCount: 'desc' }, { canonicalName: 'asc' }],
      take: 200,
    });
  }

  async getEntity(id: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
      include: {
        facts: true,
        relationsFrom: { include: { toEntity: true } },
        relationsTo: { include: { fromEntity: true } },
      },
    });
    if (!entity) {
      throw new ApiError('NOT_FOUND', '实体不存在');
    }
    return entity;
  }

  async mergeEntity(id: string, targetEntityId: string) {
    if (id === targetEntityId) {
      throw new ApiError('INVALID_ARGUMENT', '不能合并到自身');
    }
    const [source, target] = await Promise.all([
      this.prisma.entity.findUnique({ where: { id } }),
      this.prisma.entity.findUnique({ where: { id: targetEntityId } }),
    ]);
    if (!source || !target) {
      throw new ApiError('NOT_FOUND', '实体不存在');
    }

    return this.prisma.entity.update({
      where: { id },
      data: { status: 'merged', mergedIntoId: targetEntityId },
    });
  }

  async triggerExtraction(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { currentVersion: true },
    });
    if (!document || document.isDeleted) {
      throw new ApiError('NOT_FOUND', '文档不存在');
    }
    if (!document.currentVersion) {
      throw new ApiError('INVALID_ARGUMENT', '文档没有可用版本');
    }

    await this.enqueueExtraction?.({
      documentId,
      versionId: document.currentVersion.id,
    });

    return {
      documentId,
      versionId: document.currentVersion.id,
      queued: Boolean(this.enqueueExtraction),
    };
  }
}

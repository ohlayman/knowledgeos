import { randomUUID } from 'node:crypto';
import type {
  EditorType,
  Prisma,
  PrismaClient,
  ProposalChangeType,
  ProposalStatus,
  WikiPageType,
  WikiPageStatus,
} from '@prisma/client';
import {
  extractWikiLinks,
  slugify,
  type WikiPageContent,
  type WikiParagraph,
} from '@kos/wiki-engine';

export interface CreatePageInput {
  slug: string;
  title: string;
  type: WikiPageType;
  summary?: string;
  aliases?: string[];
}

export interface CreateRevisionInput {
  pageId: string;
  editorType: EditorType;
  content: WikiPageContent | Prisma.InputJsonValue;
  changeSummary?: string;
  parentRevisionId?: string | null;
  proposalId?: string | null;
  evidenceChunkIds?: string[];
  diffStat?: Prisma.InputJsonValue;
}

export interface CreateProposalInput {
  targetPageId?: string | null;
  changeType: ProposalChangeType;
  baseRevisionId?: string | null;
  dedupeKey: string;
  patch: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  conflicts?: Prisma.InputJsonValue;
  validation?: Prisma.InputJsonValue;
  documentVersionId?: string | null;
  modelMeta?: Prisma.InputJsonValue;
  mergeWindowMs?: number;
}

export type AcceptProposalResult =
  | { status: 'accepted'; proposalStatus: ProposalStatus; revisionId: string; pageId: string }
  | { status: 'stale'; proposalStatus: ProposalStatus }
  | { status: 'not_pending'; proposalStatus: ProposalStatus }
  | { status: 'invalid'; proposalStatus: ProposalStatus; reason: string };

const PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class WikiRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPage(input: CreatePageInput) {
    return this.prisma.wikiPage.create({
      data: {
        id: randomUUID(),
        slug: input.slug,
        title: input.title,
        type: input.type,
        summary: input.summary ?? null,
        aliases: input.aliases ?? [],
      },
    });
  }

  async getPageById(id: string) {
    return this.prisma.wikiPage.findUnique({
      where: { id },
      include: {
        currentRevision: true,
        revisions: { orderBy: { revisionNo: 'desc' } },
      },
    });
  }

  async getPageBySlug(slug: string) {
    return this.prisma.wikiPage.findUnique({
      where: { slug },
      include: {
        currentRevision: true,
        revisions: { orderBy: { revisionNo: 'desc' } },
        outgoingLinks: true,
        incomingLinks: { include: { fromPage: true } },
      },
    });
  }

  async listPages(filter: { type?: WikiPageType; status?: WikiPageStatus; limit?: number }) {
    return this.prisma.wikiPage.findMany({
      where: {
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: filter.limit ?? 100,
      include: { currentRevision: true },
    });
  }

  async pageCandidates() {
    const pages = await this.prisma.wikiPage.findMany({
      where: { status: { not: 'archived' } },
      include: { currentRevision: true },
    });

    return pages.map((page) => {
      const content = page.currentRevision?.content as unknown as WikiPageContent | undefined;
      return {
        id: page.id,
        slug: page.slug,
        title: page.title,
        aliases: page.aliases,
        type: page.type,
        evidenceChunkIds:
          content?.paragraphs.flatMap((paragraph) => paragraph.evidenceChunkIds) ?? [],
      };
    });
  }

  async updatePageMeta(
    id: string,
    input: { title?: string; summary?: string; aliases?: string[]; status?: WikiPageStatus },
  ) {
    return this.prisma.wikiPage.update({
      where: { id },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.status === 'archived' ? { archivedAt: new Date() } : {}),
      },
    });
  }

  async createRevision(input: CreateRevisionInput) {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.wikiRevision.findFirst({
        where: { pageId: input.pageId },
        orderBy: { revisionNo: 'desc' },
        select: { revisionNo: true },
      });

      const evidenceChunkIds =
        input.evidenceChunkIds ??
        ((input.content as WikiPageContent).paragraphs ?? []).flatMap(
          (paragraph) => paragraph.evidenceChunkIds,
        );

      const revision = await tx.wikiRevision.create({
        data: {
          id: randomUUID(),
          pageId: input.pageId,
          revisionNo: (last?.revisionNo ?? 0) + 1,
          parentRevisionId: input.parentRevisionId ?? null,
          editorType: input.editorType,
          changeSummary: input.changeSummary ?? null,
          content: input.content as Prisma.InputJsonValue,
          evidenceChunkIds: [...new Set(evidenceChunkIds)],
          diffStat: input.diffStat,
          proposalId: input.proposalId ?? null,
        },
      });

      await tx.wikiPage.update({
        where: { id: input.pageId },
        data: {
          currentRevisionId: revision.id,
          status: 'published',
          ...(input.editorType === 'human' ? { lastReviewedAt: new Date() } : {}),
        },
      });

      await syncLinks(tx, input.pageId, input.content as WikiPageContent);

      return revision;
    });
  }

  async rollback(pageId: string, targetRevisionId: string, reason: string) {
    const page = await this.getPageById(pageId);
    if (!page) {
      throw new Error('page not found');
    }
    const target = page.revisions.find((revision) => revision.id === targetRevisionId);
    if (!target) {
      throw new Error('revision not found');
    }

    return this.createRevision({
      pageId,
      editorType: 'system',
      content: target.content as Prisma.InputJsonValue,
      parentRevisionId: page.currentRevisionId,
      changeSummary: `回滚到 v${target.revisionNo}：${reason}`,
      evidenceChunkIds: target.evidenceChunkIds,
    });
  }

  async createProposal(input: CreateProposalInput) {
    const existing = await this.prisma.wikiProposal.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (existing) {
      return existing;
    }

    if (input.mergeWindowMs && input.targetPageId) {
      const since = new Date(Date.now() - input.mergeWindowMs);
      const pending = await this.prisma.wikiProposal.findFirst({
        where: {
          targetPageId: input.targetPageId,
          changeType: input.changeType,
          status: 'pending',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        const mergedPatch = mergePatch(pending.patch, input.patch);
        return this.prisma.wikiProposal.update({
          where: { id: pending.id },
          data: { patch: mergedPatch },
        });
      }
    }

    const proposal = await this.prisma.$transaction(async (tx) => {
      const backlinks = input.targetPageId
        ? await tx.wikiLink.count({ where: { toPageId: input.targetPageId } })
        : 0;
      const created = await tx.wikiProposal.create({
        data: {
          id: randomUUID(),
          targetPageId: input.targetPageId ?? null,
          changeType: input.changeType,
          baseRevisionId: input.baseRevisionId ?? null,
          dedupeKey: input.dedupeKey,
          patch: input.patch,
          evidence: input.evidence,
          conflicts: input.conflicts,
          validation: input.validation,
          documentVersionId: input.documentVersionId ?? null,
          modelMeta: input.modelMeta,
          expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        },
      });

      await tx.reviewTask.create({
        data: {
          id: randomUUID(),
          type: 'proposal',
          targetType: 'wiki_proposal',
          targetId: input.targetPageId ?? created.id,
          proposalId: created.id,
          priority: backlinks,
        },
      });

      return created;
    });

    return proposal;
  }

  async listProposals(filter: { status?: ProposalStatus; limit?: number } = {}) {
    return this.prisma.wikiProposal.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: [{ createdAt: 'desc' }],
      take: filter.limit ?? 100,
      include: { targetPage: true, baseRevision: true },
    });
  }

  async getProposal(id: string) {
    return this.prisma.wikiProposal.findUnique({
      where: { id },
      include: { targetPage: true, baseRevision: true, documentVersion: true },
    });
  }

  async acceptProposal(
    id: string,
    input: {
      baseRevisionId?: string | null;
      reviewerId?: string | null;
      patchOverride?: Prisma.InputJsonValue;
    },
  ): Promise<AcceptProposalResult> {
    const proposal = await this.prisma.wikiProposal.findUnique({ where: { id } });
    if (!proposal) {
      return { status: 'not_pending', proposalStatus: 'pending' };
    }
    if (proposal.status !== 'pending') {
      return { status: 'not_pending', proposalStatus: proposal.status };
    }

    const pageId = proposal.targetPageId;
    let baseContent: WikiPageContent = { summary: '', paragraphs: [] };
    let baseRevisionId: string | null = null;

    if (proposal.targetPageId) {
      const page = await this.prisma.wikiPage.findUnique({
        where: { id: proposal.targetPageId },
        include: { currentRevision: true },
      });
      if (!page) {
        return { status: 'invalid', proposalStatus: proposal.status, reason: 'page_missing' };
      }
      const currentId = page.currentRevisionId;
      if (
        (proposal.baseRevisionId && proposal.baseRevisionId !== currentId) ||
        (input.baseRevisionId && input.baseRevisionId !== currentId)
      ) {
        return { status: 'stale', proposalStatus: proposal.status };
      }
      baseRevisionId = currentId;
      baseContent = (page.currentRevision?.content as unknown as WikiPageContent) ?? baseContent;
    }

    const patch = (input.patchOverride ?? proposal.patch) as unknown as PatchPayload;
    const { content, evidenceChunkIds, pageMeta } = applyPatch(
      baseContent,
      patch,
      proposal.changeType,
    );

    if (evidenceChunkIds.length > 0) {
      const rows = await this.prisma.chunk.findMany({
        where: { id: { in: evidenceChunkIds } },
        select: { id: true },
      });
      const found = new Set(rows.map((row) => row.id));
      const missing = evidenceChunkIds.filter((chunkId) => !found.has(chunkId));
      if (missing.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.wikiProposal.update({
            where: { id: proposal.id },
            data: {
              status: 'invalid',
              validation: {
                ok: false,
                reason: 'evidence_missing',
                missing,
              } as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.reviewTask.updateMany({
            where: { proposalId: proposal.id, status: 'open' },
            data: { status: 'resolved', resolvedAt: new Date() },
          });
        });
        return { status: 'invalid', proposalStatus: 'invalid', reason: 'evidence_missing' };
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let targetPageId = pageId;

      if (!targetPageId) {
        if (!pageMeta) {
          return {
            status: 'invalid' as const,
            proposalStatus: proposal.status,
            reason: 'missing_new_page',
          };
        }
        const created = await tx.wikiPage.create({
          data: {
            id: randomUUID(),
            slug: pageMeta.slug,
            title: pageMeta.title,
            type: pageMeta.type,
            summary: pageMeta.summary ?? content.summary,
            aliases: pageMeta.aliases ?? [],
            status: 'published',
            lastReviewedAt: new Date(),
          },
        });
        targetPageId = created.id;
      }

      const last = await tx.wikiRevision.findFirst({
        where: { pageId: targetPageId },
        orderBy: { revisionNo: 'desc' },
        select: { revisionNo: true },
      });

      const revision = await tx.wikiRevision.create({
        data: {
          id: randomUUID(),
          pageId: targetPageId,
          revisionNo: (last?.revisionNo ?? 0) + 1,
          parentRevisionId: baseRevisionId,
          editorType: 'model',
          changeSummary: (patch as unknown as { summary?: string }).summary ?? '接受模型提案',
          content: content as unknown as Prisma.InputJsonValue,
          evidenceChunkIds,
          proposalId: proposal.id,
          diffStat: {
            ops: Array.isArray((patch as PatchPayload).ops)
              ? (patch as PatchPayload).ops!.length
              : 0,
          },
        },
      });

      await tx.wikiPage.update({
        where: { id: targetPageId },
        data: {
          currentRevisionId: revision.id,
          status: 'published',
          lastReviewedAt: new Date(),
        },
      });
      await syncLinks(tx, targetPageId, content);

      await tx.wikiProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'accepted',
          reviewedAt: new Date(),
          reviewedBy: input.reviewerId ?? null,
        },
      });

      await tx.reviewTask.updateMany({
        where: { proposalId: proposal.id, status: 'open' },
        data: { status: 'resolved', resolvedAt: new Date() },
      });

      return {
        status: 'accepted' as const,
        proposalStatus: 'accepted' as const,
        revisionId: revision.id,
        pageId: targetPageId,
      };
    });
  }

  async rejectProposal(
    id: string,
    input: { reason: string; comment?: string; reviewerId?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wikiProposal.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectReason: input.reason,
          rejectComment: input.comment ?? null,
          reviewedAt: new Date(),
          reviewedBy: input.reviewerId ?? null,
        },
      });
      await tx.reviewTask.updateMany({
        where: { proposalId: id, status: 'open' },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      return updated;
    });
  }

  async rewriteProposal(
    id: string,
    input: {
      content: WikiPageContent;
      baseRevisionId: string;
      reviewerId?: string | null;
      summary?: string;
    },
  ): Promise<AcceptProposalResult> {
    const proposal = await this.prisma.wikiProposal.findUnique({ where: { id } });
    if (!proposal || proposal.status !== 'pending') {
      return { status: 'not_pending', proposalStatus: proposal?.status ?? 'pending' };
    }
    if (!proposal.targetPageId) {
      return { status: 'invalid', proposalStatus: proposal.status, reason: 'page_missing' };
    }

    const page = await this.prisma.wikiPage.findUnique({
      where: { id: proposal.targetPageId },
      include: { currentRevision: true },
    });
    if (!page) {
      return { status: 'invalid', proposalStatus: proposal.status, reason: 'page_missing' };
    }
    if (page.currentRevisionId !== input.baseRevisionId) {
      return { status: 'stale', proposalStatus: proposal.status };
    }

    const revision = await this.prisma.$transaction(async (tx) => {
      const last = await tx.wikiRevision.findFirst({
        where: { pageId: page.id },
        orderBy: { revisionNo: 'desc' },
        select: { revisionNo: true },
      });
      const created = await tx.wikiRevision.create({
        data: {
          id: randomUUID(),
          pageId: page.id,
          revisionNo: (last?.revisionNo ?? 0) + 1,
          parentRevisionId: input.baseRevisionId,
          editorType: 'human',
          changeSummary: input.summary ?? '人工改写后接受',
          content: input.content as unknown as Prisma.InputJsonValue,
          evidenceChunkIds: input.content.paragraphs.flatMap(
            (paragraph) => paragraph.evidenceChunkIds,
          ),
          proposalId: proposal.id,
        },
      });
      await tx.wikiPage.update({
        where: { id: page.id },
        data: {
          currentRevisionId: created.id,
          status: 'published',
          lastReviewedAt: new Date(),
        },
      });
      await syncLinks(tx, page.id, input.content);
      await tx.wikiProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'accepted',
          reviewedAt: new Date(),
          reviewedBy: input.reviewerId ?? null,
        },
      });
      await tx.reviewTask.updateMany({
        where: { proposalId: proposal.id, status: 'open' },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      return created;
    });

    return {
      status: 'accepted',
      proposalStatus: 'accepted',
      revisionId: revision.id,
      pageId: page.id,
    };
  }

  async replaceLinks(
    fromPageId: string,
    links: Array<{ targetSlug: string; relationType?: string | null; context?: string | null }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.wikiLink.deleteMany({ where: { fromPageId } });
      if (links.length === 0) {
        return;
      }
      const targets = await tx.wikiPage.findMany({
        where: { slug: { in: links.map((link) => link.targetSlug) } },
        select: { id: true, slug: true },
      });
      const bySlug = new Map(targets.map((target) => [target.slug, target.id]));

      await tx.wikiLink.createMany({
        data: links.map((link) => ({
          id: randomUUID(),
          fromPageId,
          toPageId: bySlug.get(link.targetSlug) ?? null,
          targetSlug: link.targetSlug,
          relationType: link.relationType ?? null,
          context: link.context ?? null,
        })),
      });
    });
  }

  async listLinks(fromPageId: string) {
    return this.prisma.wikiLink.findMany({
      where: { fromPageId },
      include: { toPage: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getBacklinks(toPageId: string) {
    return this.prisma.wikiLink.findMany({
      where: { toPageId },
      include: { fromPage: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markPagesStaleForDocument(documentId: string, currentVersionId: string) {
    const oldChunks = await this.prisma.chunk.findMany({
      where: { documentId, versionId: { not: currentVersionId } },
      select: { id: true },
    });
    const chunkIds = oldChunks.map((chunk) => chunk.id);
    if (chunkIds.length === 0) {
      return { pages: 0 };
    }

    const revisions = await this.prisma.wikiRevision.findMany({
      where: { evidenceChunkIds: { hasSome: chunkIds } },
      select: { pageId: true },
    });
    const pageIds = [...new Set(revisions.map((revision) => revision.pageId))];
    if (pageIds.length === 0) {
      return { pages: 0 };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.wikiPage.updateMany({
        where: { id: { in: pageIds }, status: { not: 'archived' } },
        data: { status: 'stale' },
      });
      for (const pageId of pageIds) {
        const existing = await tx.reviewTask.findFirst({
          where: { targetId: pageId, type: 'stale_review', status: 'open' },
        });
        if (!existing) {
          await tx.reviewTask.create({
            data: {
              id: randomUUID(),
              type: 'stale_review',
              targetType: 'wiki_page',
              targetId: pageId,
            },
          });
        }
      }
    });

    return { pages: pageIds.length };
  }

  async resolveStale(pageId: string, action: 'confirm' | 'archive', reviewerId?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.wikiPage.update({
        where: { id: pageId },
        data:
          action === 'archive'
            ? { status: 'archived', archivedAt: new Date(), lastReviewedAt: new Date() }
            : { status: 'published', lastReviewedAt: new Date() },
      });
      await tx.reviewTask.updateMany({
        where: { targetId: pageId, type: 'stale_review', status: 'open' },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      void reviewerId;
      return page;
    });
  }
}

type TxClient = Prisma.TransactionClient;

async function syncLinks(tx: TxClient, pageId: string, content: WikiPageContent | undefined) {
  await tx.wikiLink.deleteMany({ where: { fromPageId: pageId } });
  const paragraphs = content?.paragraphs ?? [];
  const seen = new Set<string>();
  const links = paragraphs
    .flatMap((paragraph) => extractWikiLinks(paragraph.text))
    .map((link) => ({ ...link, targetSlug: slugify(link.targetSlug) }))
    .filter((link) => {
      if (seen.has(link.targetSlug)) {
        return false;
      }
      seen.add(link.targetSlug);
      return true;
    });
  if (links.length === 0) {
    return;
  }

  const targets = await tx.wikiPage.findMany({
    where: { slug: { in: links.map((link) => link.targetSlug) } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(targets.map((target) => [target.slug, target.id]));

  await tx.wikiLink.createMany({
    data: links.map((link) => ({
      id: randomUUID(),
      fromPageId: pageId,
      toPageId: bySlug.get(link.targetSlug) ?? null,
      targetSlug: link.targetSlug,
      relationType: link.relationType,
      context: link.context,
    })),
  });
}

interface PatchPayload {
  summary?: string;
  ops?: Array<
    | { op: 'add'; paragraph: WikiParagraph }
    | { op: 'delete'; paragraphId: string }
    | { op: 'protected'; paragraphId: string; section: string; reason: string }
  >;
  newPage?: {
    slug: string;
    title: string;
    type: WikiPageType;
    summary?: string;
    aliases?: string[];
  };
}

function mergePatch(existing: Prisma.JsonValue, incoming: Prisma.InputJsonValue) {
  const left = (existing ?? {}) as PatchPayload;
  const right = (incoming ?? {}) as PatchPayload;
  const ops = [...(left.ops ?? [])];

  for (const op of right.ops ?? []) {
    if (op.op === 'add') {
      if (!ops.some((item) => item.op === 'add' && item.paragraph.id === op.paragraph.id)) {
        ops.push(op);
      }
    } else if (!ops.some((item) => item.op === op.op && item.paragraphId === op.paragraphId)) {
      ops.push(op);
    }
  }

  return { ...left, ...right, ops } as unknown as Prisma.InputJsonValue;
}

function applyPatch(
  base: WikiPageContent,
  patch: PatchPayload,
  changeType: ProposalChangeType,
): { content: WikiPageContent; evidenceChunkIds: string[]; pageMeta?: PatchPayload['newPage'] } {
  const paragraphs = [...(base.paragraphs ?? [])];

  for (const op of patch.ops ?? []) {
    if (op.op === 'add') {
      if (!paragraphs.some((paragraph) => paragraph.id === op.paragraph.id)) {
        paragraphs.push(op.paragraph);
      }
    } else if (op.op === 'delete') {
      const index = paragraphs.findIndex((paragraph) => paragraph.id === op.paragraphId);
      if (index >= 0 && paragraphs[index]?.origin !== 'human') {
        paragraphs.splice(index, 1);
      }
    }
  }

  const content: WikiPageContent = {
    summary: patch.newPage?.summary ?? patch.summary ?? base.summary,
    paragraphs,
  };

  const evidenceChunkIds = [
    ...new Set(paragraphs.flatMap((paragraph) => paragraph.evidenceChunkIds)),
  ];

  return {
    content,
    evidenceChunkIds,
    ...(changeType === 'create' || patch.newPage ? { pageMeta: patch.newPage } : {}),
  };
}

import type { PrismaClient } from '@kos/database';
import type { GraphService } from '@kos/graph';
import { buildPrompt, type ChatProvider } from '@kos/llm';
import type { RetrievalService } from '@kos/retrieval';
import {
  ApiError,
  detectSuspiciousText,
  normalizeEntityName,
  resolveTokenScope,
  uniqueCitationOrdinals,
  type AskKnowledgeInput,
  type GetKnowledgeSourcesInput,
  type GetRelatedKnowledgeInput,
  type McpDocumentScope,
  type McpRequestScope,
  type ProposeKnowledgeUpdateInput,
  type ReadWikiInput,
  type SearchKnowledgeInput,
} from '@kos/shared';
import type { WikiPageContent } from '@kos/wiki-engine';
import type { WikiService } from '../wiki/wiki-service.js';
import type { McpContext } from './auth.js';

const NO_EVIDENCE_TEXT =
  '没有找到足够的相关内容。可以换用更具体的关键词、扩大检索范围，或先导入相关材料。';
const ASK_TIMEOUT_MS = 20_000;
const EXCERPT_LIMIT = 4000;

export interface McpServiceDeps {
  prisma: PrismaClient;
  retrieval: RetrievalService;
  graph: GraphService;
  wiki: WikiService;
  chatProvider: () => Promise<ChatProvider>;
}

export interface McpSearchItem {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  versionId: string;
  excerpt: string;
  score: number;
  headingPath: string[];
  page: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  suspicious: boolean;
}

export interface McpScopeDescriptor {
  mode: 'all' | 'tags' | 'documents';
  summary: string;
  tags?: string[];
  documentIds?: string[];
}

function describeScope(
  scope: McpDocumentScope | null | undefined,
  request?: McpRequestScope,
): McpScopeDescriptor {
  const value = scope ?? { mode: 'all' };
  if (value.mode === 'tags') {
    const tags = request?.tags?.length
      ? (value.tags ?? []).filter((tag) => request.tags?.includes(tag))
      : (value.tags ?? []);
    return { mode: 'tags', summary: `标签：${tags.join('、')}`, tags };
  }

  if (value.mode === 'documents') {
    const documentIds = request?.documentIds?.length
      ? (value.documentIds ?? []).filter((id) => request.documentIds?.includes(id))
      : (value.documentIds ?? []);
    return {
      mode: 'documents',
      summary: `指定文档 ${documentIds.length} 份`,
      documentIds,
    };
  }

  if (request?.tags?.length) {
    return {
      mode: 'tags',
      summary: `标签：${request.tags.join('、')}`,
      tags: request.tags,
    };
  }
  if (request?.documentIds?.length) {
    return {
      mode: 'documents',
      summary: `指定文档 ${request.documentIds.length} 份`,
      documentIds: request.documentIds,
    };
  }
  return { mode: 'all', summary: '全部文档' };
}

function truncateExcerpt(text: string): string {
  return text.length > EXCERPT_LIMIT ? `${text.slice(0, EXCERPT_LIMIT)}…` : text;
}

let activeAsks = 0;
const MAX_CONCURRENT_ASKS = 2;

export class McpService {
  constructor(private readonly deps: McpServiceDeps) {}

  async search(context: McpContext, input: SearchKnowledgeInput) {
    const resolution = resolveTokenScope(
      context.token.documentScope as McpDocumentScope | null,
      input.scope,
    );
    const scope = describeScope(
      context.token.documentScope as McpDocumentScope | null,
      input.scope,
    );
    context.summary = {
      query: input.query,
      topK: input.topK ?? 8,
      scope: { mode: scope.mode, tags: scope.tags, documentIds: scope.documentIds },
    };

    if (!resolution.ok) {
      return {
        items: [] as McpSearchItem[],
        count: 0,
        reason: resolution.reason,
        scope,
        questionType: 'open',
      };
    }

    context.summary.pushedFilters = { ...resolution.filter };

    const result = await this.deps.retrieval.retrieve(input.query, {
      finalTopK: input.topK ?? 8,
      ...resolution.filter,
    });

    const chunkIds = result.evidence.map((item) => item.chunkId);
    const documentIds = [...new Set(result.evidence.map((item) => item.documentId))];
    const [chunks, documents] = await Promise.all([
      chunkIds.length
        ? this.deps.prisma.chunk.findMany({
            where: { id: { in: chunkIds } },
            select: {
              id: true,
              startOffset: true,
              endOffset: true,
              pageStart: true,
              pageEnd: true,
              suspicious: true,
            },
          })
        : Promise.resolve([]),
      documentIds.length
        ? this.deps.prisma.document.findMany({
            where: { id: { in: documentIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
    ]);

    const chunkIndex = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const titles = new Map(documents.map((document) => [document.id, document.title]));

    const items: McpSearchItem[] = result.evidence.map((item) => {
      const chunk = chunkIndex.get(item.chunkId);
      return {
        chunkId: item.chunkId,
        documentId: item.documentId,
        documentTitle: titles.get(item.documentId) ?? item.documentId,
        versionId: item.versionId,
        excerpt: truncateExcerpt(item.text),
        score: item.score,
        headingPath: item.headingPath,
        page: item.page ?? chunk?.pageStart ?? null,
        pageStart: chunk?.pageStart ?? null,
        pageEnd: chunk?.pageEnd ?? null,
        suspicious: (chunk?.suspicious ?? false) || detectSuspiciousText(item.text),
      };
    });

    context.resultCount = items.length;
    context.suspicious = items.some((item) => item.suspicious);

    return {
      items,
      count: items.length,
      ...(result.noEvidence ? { reason: 'no_match_in_scope' as const } : {}),
      scope,
      questionType: result.trace.questionType,
    };
  }

  async readWiki(context: McpContext, input: ReadWikiInput) {
    const page = await this.deps.prisma.wikiPage.findFirst({
      where: {
        ...(input.slug ? { slug: input.slug } : { id: input.pageId }),
        status: 'published',
        archivedAt: null,
      },
      include: { currentRevision: true, revisions: { orderBy: { revisionNo: 'desc' } } },
    });
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在或尚未发布');
    }

    const revision =
      input.version === undefined
        ? page.currentRevision
        : (page.revisions.find((item) => item.revisionNo === input.version) ?? null);
    if (!revision) {
      throw new ApiError('NOT_FOUND', '页面版本不存在');
    }

    const content = (revision.content as unknown as WikiPageContent | null) ?? {
      summary: '',
      paragraphs: [],
    };
    const evidenceChunkIds = [
      ...new Set(content.paragraphs.flatMap((paragraph) => paragraph.evidenceChunkIds)),
    ];
    if (!(await context.guard.canAccessChunks(evidenceChunkIds))) {
      throw new ApiError('NOT_FOUND', '页面不存在或尚未发布');
    }

    const paragraphs = content.paragraphs.map((paragraph) => ({
      section: paragraph.section,
      text: paragraph.text,
      evidenceChunkIds: paragraph.evidenceChunkIds,
      suspicious: detectSuspiciousText(paragraph.text),
    }));

    const markdown = [
      `# ${page.title}`,
      ...(content.summary ? ['', `> ${content.summary}`] : []),
      ...paragraphs.flatMap((paragraph) => ['', `## ${paragraph.section}`, '', paragraph.text]),
    ].join('\n');

    context.summary = {
      slug: page.slug,
      ...(input.version === undefined ? {} : { version: input.version }),
    };
    context.resultCount = 1;
    context.suspicious = paragraphs.some((paragraph) => paragraph.suspicious);

    return {
      pageId: page.id,
      slug: page.slug,
      title: page.title,
      type: page.type,
      status: page.status,
      versionNo: revision.revisionNo,
      updatedAt: revision.createdAt.toISOString(),
      summary: content.summary,
      markdown,
      paragraphs,
      suspicious: context.suspicious,
    };
  }

  async related(context: McpContext, input: GetRelatedKnowledgeInput) {
    const entity = await this.resolveEntity(context, input);
    const hops = input.hops ?? 1;
    const neighborhood = await this.deps.graph.neighborhood(entity.id, hops, 200);

    const evidenceIds = [...new Set(neighborhood.edges.flatMap((edge) => edge.evidenceChunkIds))];
    const allowed = await this.allowedChunks(context, evidenceIds);
    const edges = neighborhood.edges.filter((edge) =>
      edge.evidenceChunkIds.length > 0
        ? edge.evidenceChunkIds.every((id) => allowed.has(id))
        : false,
    );

    const nodes = new Map(neighborhood.nodes.map((node) => [node.id, node]));
    const items = edges
      .map((edge) => {
        const outgoing = edge.fromId === entity.id;
        const otherId = outgoing ? edge.toId : edge.fromId;
        const other = nodes.get(otherId);
        return {
          entityId: otherId,
          name: other?.name ?? otherId,
          type: other?.type ?? 'unknown',
          relationType: edge.type,
          direction: outgoing ? ('out' as const) : ('in' as const),
          confidence: edge.confidence,
          evidenceCount: edge.evidenceChunkIds.length,
        };
      })
      .filter((item, index, list) => {
        return (
          list.findIndex(
            (candidate) =>
              candidate.entityId === item.entityId &&
              candidate.relationType === item.relationType &&
              candidate.direction === item.direction,
          ) === index
        );
      });

    context.summary = {
      entityId: entity.id,
      ...(input.pageId ? { pageId: input.pageId } : {}),
      hops,
    };
    context.resultCount = items.length;

    return {
      entity: {
        id: entity.id,
        name: entity.canonicalName,
        type: entity.type,
        mentionCount: entity.mentionCount,
      },
      items,
      truncated: neighborhood.truncated || edges.length !== neighborhood.edges.length,
    };
  }

  async sources(context: McpContext, input: GetKnowledgeSourcesInput) {
    if (input.chunkId) {
      const chunk = await this.deps.prisma.chunk.findUnique({
        where: { id: input.chunkId },
        include: {
          version: true,
          document: { include: { sources: { include: { source: true } } } },
        },
      });
      if (!chunk || chunk.document.isDeleted) {
        throw new ApiError('NOT_FOUND', '来源不存在');
      }
      if (!(await context.guard.canAccessDocument(chunk.documentId))) {
        throw new ApiError('NOT_FOUND', '来源不存在');
      }
      context.summary = { chunkId: input.chunkId };
      context.resultCount = 1;
      return this.sourcePayload(
        chunk.document,
        chunk.version,
        {
          id: chunk.id,
          headingPath: chunk.headingPath,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
        },
        chunk.document.sources,
      );
    }

    const document = await this.deps.prisma.document.findUnique({
      where: { id: input.documentId },
      include: {
        currentVersion: true,
        sources: { include: { source: true } },
      },
    });
    if (!document || document.isDeleted || !document.currentVersion) {
      throw new ApiError('NOT_FOUND', '来源不存在');
    }
    if (!(await context.guard.canAccessDocument(document.id))) {
      throw new ApiError('NOT_FOUND', '来源不存在');
    }
    context.summary = { documentId: input.documentId };
    context.resultCount = 1;
    return this.sourcePayload(document, document.currentVersion, null, document.sources);
  }

  async ask(context: McpContext, input: AskKnowledgeInput) {
    const resolution = resolveTokenScope(
      context.token.documentScope as McpDocumentScope | null,
      input.scope,
    );
    const scope = describeScope(
      context.token.documentScope as McpDocumentScope | null,
      input.scope,
    );
    context.summary = {
      question: input.question,
      scope: { mode: scope.mode, tags: scope.tags, documentIds: scope.documentIds },
    };

    if (!resolution.ok) {
      return {
        answer: NO_EVIDENCE_TEXT,
        citations: [],
        hasSufficientEvidence: false,
        reason: resolution.reason,
        scope,
      };
    }
    context.summary.pushedFilters = { ...resolution.filter };

    if (activeAsks >= MAX_CONCURRENT_ASKS) {
      throw new ApiError('RATE_LIMITED', '问答并发已满，请稍后重试');
    }
    activeAsks += 1;

    try {
      const result = await this.deps.retrieval.retrieve(input.question, resolution.filter);
      if (result.noEvidence) {
        return {
          answer: NO_EVIDENCE_TEXT,
          citations: [],
          hasSufficientEvidence: false,
          reason: 'no_match_in_scope' as const,
          scope,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
      let answer = '';
      try {
        const chat = await this.deps.chatProvider();
        const prompt = buildPrompt({
          question: input.question,
          history: [],
          evidence: result.evidence.map((item, index) => ({
            ordinal: index + 1,
            chunkId: item.chunkId,
            documentTitle: item.sourcePath ?? item.documentId,
            text: item.text,
            ...(item.page === undefined ? {} : { page: item.page }),
            headingPath: item.headingPath,
          })),
        });

        for await (const delta of chat.stream(prompt.messages, { signal: controller.signal })) {
          answer += delta;
        }
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ApiError('PROVIDER_TIMEOUT', '问答超时，请稍后重试');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }

      const citations = await this.validateCitations(answer, result.evidence);
      context.resultCount = citations.length;
      context.suspicious = citations.some((citation) => citation.suspicious);

      return {
        answer,
        citations,
        hasSufficientEvidence: citations.some((citation) => citation.valid),
        scope,
        evidenceCount: result.evidence.length,
      };
    } finally {
      activeAsks -= 1;
    }
  }

  async propose(context: McpContext, input: ProposeKnowledgeUpdateInput) {
    const page = await this.deps.prisma.wikiPage.findUnique({ where: { id: input.pageId } });
    if (!page || page.archivedAt) {
      throw new ApiError('NOT_FOUND', '页面不存在');
    }

    const evidenceChunkIds = [...new Set(input.evidenceChunkIds)];
    if (!(await context.guard.canAccessChunks(evidenceChunkIds))) {
      throw new ApiError('FORBIDDEN_SCOPE', '证据超出令牌作用域');
    }

    const proposal = await this.deps.wiki.createExternalProposal({
      pageId: page.id,
      summary: input.summary,
      evidenceChunkIds,
    });

    context.summary = {
      pageId: page.id,
      evidenceCount: evidenceChunkIds.length,
    };
    context.resultCount = 1;

    return {
      proposalId: proposal.id,
      status: proposal.status,
      existing: proposal.existing,
      pageId: page.id,
      message: proposal.existing ? '已有相同证据集的待审提案' : '提案已创建，等待人工审核',
    };
  }

  private async resolveEntity(
    context: McpContext,
    input: GetRelatedKnowledgeInput,
  ): Promise<{
    id: string;
    canonicalName: string;
    type: string;
    mentionCount: number;
    sourceChunkIds: string[];
  }> {
    if (input.entityId) {
      const entity = await this.deps.prisma.entity.findFirst({
        where: { id: input.entityId, status: 'active' },
      });
      if (!entity || !(await context.guard.canAccessChunks(entity.sourceChunkIds))) {
        throw new ApiError('NOT_FOUND', '实体不存在');
      }
      return entity;
    }

    const page = await this.deps.prisma.wikiPage.findFirst({
      where: { id: input.pageId, status: 'published', archivedAt: null },
      include: { currentRevision: true },
    });
    if (!page) {
      throw new ApiError('NOT_FOUND', '页面不存在或尚未发布');
    }

    const content = (page.currentRevision?.content as unknown as WikiPageContent | null) ?? {
      summary: '',
      paragraphs: [],
    };
    const chunkIds = [...new Set(content.paragraphs.flatMap((p) => p.evidenceChunkIds))];
    if (!(await context.guard.canAccessChunks(chunkIds))) {
      throw new ApiError('NOT_FOUND', '页面不存在或尚未发布');
    }

    if (chunkIds.length > 0) {
      const mentions = await this.deps.prisma.entityMention.groupBy({
        by: ['entityId'],
        where: { chunkId: { in: chunkIds } },
        _count: { entityId: true },
        orderBy: { _count: { entityId: 'desc' } },
        take: 1,
      });
      const topId = mentions[0]?.entityId;
      if (topId) {
        const entity = await this.deps.prisma.entity.findFirst({
          where: { id: topId, status: 'active' },
        });
        if (entity) {
          return entity;
        }
      }
    }

    const normalized = normalizeEntityName(page.title);
    const entity =
      (await this.deps.prisma.entity.findFirst({
        where: { normalizedName: normalized, status: 'active' },
      })) ??
      (await this.deps.prisma.entity.findFirst({
        where: { aliases: { has: page.title }, status: 'active' },
      }));
    if (!entity) {
      throw new ApiError('NOT_FOUND', '未找到关联实体');
    }
    return entity;
  }

  private async allowedChunks(context: McpContext, chunkIds: string[]): Promise<Set<string>> {
    if (chunkIds.length === 0) {
      return new Set<string>();
    }
    const rows = await this.deps.prisma.chunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, documentId: true },
    });
    const visible = new Set<string>();
    for (const row of rows) {
      if (await context.guard.canAccessDocument(row.documentId)) {
        visible.add(row.id);
      }
    }
    return visible;
  }

  private sourcePayload(
    document: {
      id: string;
      title: string;
      tags: string[];
      createdAt: Date;
      updatedAt: Date;
    },
    version: {
      id: string;
      versionNo: number;
      status: string;
      mimeType: string | null;
      originalFilename: string | null;
      charCount: number;
      pageCount: number | null;
      createdAt: Date;
    },
    chunk: {
      id: string;
      headingPath: string[];
      pageStart: number | null;
      pageEnd: number | null;
      startOffset: number;
      endOffset: number;
    } | null,
    sources: Array<{
      firstSeenAt: Date;
      lastSeenAt: Date;
      source: { type: string; identifier: string; title: string | null };
    }>,
  ) {
    const primary = sources[0];
    return {
      document: {
        id: document.id,
        title: document.title,
        tags: document.tags,
        importedAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      },
      version: {
        id: version.id,
        versionNo: version.versionNo,
        status: version.status,
        mimeType: version.mimeType,
        originalFilename: version.originalFilename,
        charCount: version.charCount,
        pageCount: version.pageCount,
        createdAt: version.createdAt.toISOString(),
      },
      ...(chunk
        ? {
            chunk: {
              id: chunk.id,
              headingPath: chunk.headingPath,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
            },
          }
        : {}),
      source: primary
        ? {
            type: primary.source.type,
            identifier: primary.source.identifier,
            title: primary.source.title,
            firstSeenAt: primary.firstSeenAt.toISOString(),
            lastSeenAt: primary.lastSeenAt.toISOString(),
          }
        : null,
    };
  }

  private async validateCitations(
    answer: string,
    evidence: Array<{
      chunkId: string;
      documentId: string;
      versionId: string;
      text: string;
    }>,
  ) {
    const citations: Array<{
      ordinal: number;
      chunkId: string;
      documentId: string;
      versionId: string;
      quote: string;
      valid: boolean;
      validationError?: string;
      suspicious: boolean;
    }> = [];

    for (const ordinal of uniqueCitationOrdinals(answer)) {
      const item = evidence[ordinal - 1];
      if (!item) {
        continue;
      }
      const chunk = await this.deps.prisma.chunk.findUnique({
        where: { id: item.chunkId },
        select: { id: true, versionId: true },
      });
      const version = chunk
        ? await this.deps.prisma.documentVersion.findUnique({
            where: { id: chunk.versionId },
            select: { isCurrent: true },
          })
        : null;
      const valid = Boolean(chunk && version?.isCurrent);
      const quote = item.text.slice(0, 500);
      citations.push({
        ordinal,
        chunkId: item.chunkId,
        documentId: item.documentId,
        versionId: item.versionId,
        quote,
        valid,
        ...(valid ? {} : { validationError: chunk ? 'NOT_CURRENT' : 'CHUNK_MISSING' }),
        suspicious: detectSuspiciousText(item.text),
      });
    }

    return citations;
  }
}

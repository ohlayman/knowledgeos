import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, WikiRepository } from '@kos/database';
import type { AgentTool } from '@kos/agent-core';
import type { GraphService } from '@kos/graph';
import type { RetrievalService } from '@kos/retrieval';
import { normalizeEntityName } from '@kos/shared';
import { slugify } from '@kos/wiki-engine';

export interface AgentToolDeps {
  prisma: PrismaClient;
  retrieval: RetrievalService;
  wiki: WikiRepository;
  graph: GraphService;
}

export function createAgentTools(deps: AgentToolDeps): AgentTool[] {
  return [
    {
      name: 'search_knowledge',
      description: '在知识库中做混合检索，返回最相关的块。',
      paramsHint: '{ query: string, topK?: number }',
      params: z.object({
        query: z.string().min(1).max(1000),
        topK: z.number().int().min(1).max(10).optional(),
      }),
      kind: 'read',
      async execute(args) {
        const result = await deps.retrieval.retrieve(args.query, {
          finalTopK: args.topK ?? 5,
          rerankEnabled: false,
        });
        const data = result.evidence.map((item) => ({
          chunkId: item.chunkId,
          documentId: item.documentId,
          sourcePath: item.sourcePath ?? null,
          text: item.text.slice(0, 600),
        }));
        return {
          summary: `命中 ${data.length} 个块${result.noEvidence ? '（无相关证据）' : ''}`,
          data,
        };
      },
    },
    {
      name: 'get_chunk',
      description: '按块 ID 取回原文全文。',
      paramsHint: '{ chunkId: uuid }',
      params: z.object({ chunkId: z.string().uuid() }),
      kind: 'read',
      async execute(args) {
        const chunk = await deps.prisma.chunk.findUnique({
          where: { id: args.chunkId },
          select: { id: true, documentId: true, text: true },
        });
        if (!chunk) {
          throw new Error('块不存在');
        }
        return {
          summary: `块 ${chunk.id} 共 ${chunk.text.length} 字`,
          data: { ...chunk, text: chunk.text.slice(0, 1500) },
        };
      },
    },
    {
      name: 'read_wiki_page',
      description: '读取已发布的 Wiki 页面内容。',
      paramsHint: '{ slug: string }',
      params: z.object({ slug: z.string().min(1).max(200) }),
      kind: 'read',
      async execute(args) {
        const page = await deps.prisma.wikiPage.findUnique({
          where: { slug: args.slug },
          include: { currentRevision: true },
        });
        if (!page || page.status !== 'published') {
          throw new Error('页面不存在或未发布');
        }
        const content = page.currentRevision?.content as unknown as {
          summary?: string;
          paragraphs?: Array<{ section: string; text: string }>;
        } | null;
        return {
          summary: `页面 ${page.title}（${page.status}）`,
          data: {
            title: page.title,
            summary: content?.summary ?? '',
            paragraphs: (content?.paragraphs ?? []).slice(0, 6),
          },
        };
      },
    },
    {
      name: 'get_related_knowledge',
      description: '查询实体的图谱邻域与关系。',
      paramsHint: '{ entityName: string, hops?: 1|2|3 }',
      params: z.object({
        entityName: z.string().min(1).max(200),
        hops: z.number().int().min(1).max(3).optional(),
      }),
      kind: 'read',
      async execute(args) {
        const entity = await deps.prisma.entity.findFirst({
          where: { normalizedName: normalizeEntityName(args.entityName), status: 'active' },
          select: { id: true, canonicalName: true },
        });
        if (!entity) {
          throw new Error('实体不存在');
        }
        const neighborhood = await deps.graph.neighborhood(entity.id, args.hops ?? 1);
        const names = new Map(neighborhood.nodes.map((node) => [node.id, node.name]));
        return {
          summary: `实体 ${entity.canonicalName} 有 ${neighborhood.edges.length} 条关系`,
          data: {
            nodes: neighborhood.nodes.map((node) => ({ name: node.name, type: node.type })),
            edges: neighborhood.edges.map((edge) => ({
              from: names.get(edge.fromId) ?? edge.fromId,
              to: names.get(edge.toId) ?? edge.toId,
              type: edge.type,
              confidence: edge.confidence,
              evidenceChunkIds: edge.evidenceChunkIds,
            })),
          },
        };
      },
    },
    {
      name: 'summarize_document',
      description: '按文档当前版本的块生成摘录式摘要。',
      paramsHint: '{ documentId: uuid }',
      params: z.object({ documentId: z.string().uuid() }),
      kind: 'read',
      async execute(args) {
        const document = await deps.prisma.document.findUnique({
          where: { id: args.documentId },
          include: { currentVersion: { include: { chunks: { orderBy: { chunkIndex: 'asc' } } } } },
        });
        if (!document || document.isDeleted) {
          throw new Error('文档不存在');
        }
        const chunks = document.currentVersion?.chunks ?? [];
        const text = chunks
          .map(
            (chunk) =>
              `${chunk.headingPath.length ? `[${chunk.headingPath.join(' > ')}] ` : ''}${chunk.text}`,
          )
          .join('\n')
          .slice(0, 1200);
        return {
          summary: `文档「${document.title}」共 ${chunks.length} 个块`,
          data: { title: document.title, excerpt: text },
        };
      },
    },
    {
      name: 'propose_wiki_update',
      description: '生成待审的 Wiki 更新提案（不直接落库）。',
      paramsHint: '{ title: string, section: string, text: string, evidenceChunkIds: uuid[] }',
      params: z.object({
        title: z.string().min(1).max(200),
        section: z.string().min(1).max(40).default('定义'),
        text: z.string().min(1).max(1200),
        evidenceChunkIds: z.array(z.string().uuid()).min(1).max(5),
      }),
      kind: 'proposal',
      async execute(args) {
        const chunkCount = await deps.prisma.chunk.count({
          where: { id: { in: args.evidenceChunkIds } },
        });
        if (chunkCount !== args.evidenceChunkIds.length) {
          throw new Error('证据块不存在');
        }

        const slug = slugify(args.title);
        const existing = await deps.wiki.getPageBySlug(slug);
        const paragraph = {
          id: `p-${randomUUID().slice(0, 12)}`,
          section: args.section,
          text: args.text,
          evidenceChunkIds: args.evidenceChunkIds,
          origin: 'model' as const,
          versionIntroduced: (existing?.revisions.length ?? 0) + 1,
        };

        const proposal = await deps.wiki.createProposal({
          ...(existing
            ? { targetPageId: existing.id, baseRevisionId: existing.currentRevisionId }
            : {}),
          changeType: existing ? 'update' : 'create',
          dedupeKey: `agent-${randomUUID()}`,
          patch: {
            summary: args.text.slice(0, 120),
            ops: [{ op: 'add', paragraph }],
            ...(existing
              ? {}
              : {
                  newPage: {
                    slug,
                    title: args.title,
                    type: 'concept',
                    summary: args.text.slice(0, 120),
                  },
                }),
          } as never,
          evidence: { chunkIds: args.evidenceChunkIds } as never,
          validation: { ok: true, warnings: [] } as never,
        });
        return {
          summary: `已生成提案 ${proposal.id}，等待人工审核`,
          data: { proposalId: proposal.id, status: proposal.status },
        };
      },
    },
  ];
}

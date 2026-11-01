import { z } from 'zod';

export const MCP_TOOL_NAMES = [
  'search_knowledge',
  'read_wiki',
  'get_related_knowledge',
  'get_knowledge_sources',
  'ask_knowledge',
  'propose_knowledge_update',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const DEFAULT_MCP_TOOL_ALLOWLIST: McpToolName[] = [
  'search_knowledge',
  'read_wiki',
  'get_related_knowledge',
  'get_knowledge_sources',
  'ask_knowledge',
];

export const MCP_MAX_RESULT_BYTES = 32 * 1024;

export interface McpToolDefinition {
  name: McpToolName;
  title: string;
  description: string;
  readOnly: boolean;
  defaultEnabled: boolean;
}

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'search_knowledge',
    title: '检索知识库',
    description:
      '在用户的知识库中做语义与关键词混合检索。当需要查找已导入的资料、笔记或文档片段时优先使用；返回片段、文档标题、文档 ID 与块 ID。单次最多 8 条，返回体积不超过 32KB。',
    readOnly: true,
    defaultEnabled: true,
  },
  {
    name: 'read_wiki',
    title: '读取 Wiki 页面',
    description:
      '按 slug 或 pageId 读取已发布的 Wiki 页面正文（Markdown）。当用户提到某个主题的「词条」「Wiki 页面」，或需要成段背景说明时使用；只返回已发布页面。',
    readOnly: true,
    defaultEnabled: true,
  },
  {
    name: 'get_related_knowledge',
    title: '查询关联知识',
    description:
      '从某个实体或 Wiki 页面出发，查询知识图谱中最多两跳的关联实体与关系类型。当需要了解「和 X 相关的东西」「X 和 Y 有什么关系」时使用。',
    readOnly: true,
    defaultEnabled: true,
  },
  {
    name: 'get_knowledge_sources',
    title: '查询来源元数据',
    description:
      '查询某个块或文档的来源信息（来源类型、导入时间、文档版本、原始链接）。当需要确认检索结果的出处与时间时使用。',
    readOnly: true,
    defaultEnabled: true,
  },
  {
    name: 'ask_knowledge',
    title: '知识库问答',
    description:
      '针对知识库内容做一次完整问答，返回答案与引用。当需要一段成形的解释而不是原始片段时使用；没有足够证据时会明确标记，不会编造。',
    readOnly: true,
    defaultEnabled: true,
  },
  {
    name: 'propose_knowledge_update',
    title: '提交 Wiki 更新提案',
    description:
      '为某个 Wiki 页面创建一条待审核的更新提案。只创建提案，不会修改页面内容；同一页面同一证据集重复调用返回已有提案。默认关闭，需在接入令牌中显式开启。',
    readOnly: false,
    defaultEnabled: false,
  },
];

export const McpDocumentScopeSchema = z.object({
  mode: z.enum(['all', 'tags', 'documents']),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  documentIds: z.array(z.string().uuid()).max(500).optional(),
});

export type McpDocumentScope = z.infer<typeof McpDocumentScopeSchema>;

export const DEFAULT_MCP_SCOPE: McpDocumentScope = { mode: 'all' };

export const McpRequestScopeSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
    documentIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .optional();

export type McpRequestScope = z.infer<typeof McpRequestScopeSchema>;

export interface McpScopeFilter {
  tags?: string[];
  documentIds?: string[];
}

export type ScopeResolution =
  { ok: true; filter: McpScopeFilter } | { ok: false; reason: 'scope_empty' };

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function intersect(allowed: string[], requested?: string[]): string[] | undefined {
  if (!requested?.length) {
    return undefined;
  }
  const allowedSet = new Set(allowed);
  return dedupe(requested.filter((value) => allowedSet.has(value)));
}

export function resolveTokenScope(
  tokenScope: McpDocumentScope | null | undefined,
  requestScope?: McpRequestScope,
): ScopeResolution {
  const scope = tokenScope ?? DEFAULT_MCP_SCOPE;
  const requestedTags = requestScope?.tags?.length ? dedupe(requestScope.tags) : undefined;
  const requestedDocs = requestScope?.documentIds?.length
    ? dedupe(requestScope.documentIds)
    : undefined;

  if (scope.mode === 'all') {
    return {
      ok: true,
      filter: {
        ...(requestedTags ? { tags: requestedTags } : {}),
        ...(requestedDocs ? { documentIds: requestedDocs } : {}),
      },
    };
  }

  if (scope.mode === 'tags') {
    const allowed = scope.tags ?? [];
    if (allowed.length === 0) {
      return { ok: false, reason: 'scope_empty' };
    }
    const tags = intersect(allowed, requestedTags);
    if (tags && tags.length === 0) {
      return { ok: false, reason: 'scope_empty' };
    }
    return {
      ok: true,
      filter: {
        tags: tags ?? dedupe(allowed),
        ...(requestedDocs ? { documentIds: requestedDocs } : {}),
      },
    };
  }

  const allowed = scope.documentIds ?? [];
  if (allowed.length === 0) {
    return { ok: false, reason: 'scope_empty' };
  }
  const documentIds = intersect(allowed, requestedDocs);
  if (documentIds && documentIds.length === 0) {
    return { ok: false, reason: 'scope_empty' };
  }
  return {
    ok: true,
    filter: {
      documentIds: documentIds ?? dedupe(allowed),
      ...(requestedTags ? { tags: requestedTags } : {}),
    },
  };
}

export function scopeSummary(scope: McpDocumentScope | null | undefined): string {
  const value = scope ?? DEFAULT_MCP_SCOPE;
  if (value.mode === 'tags') {
    const tags = value.tags ?? [];
    return tags.length ? `标签：${tags.join('、')}` : '标签（未选择）';
  }
  if (value.mode === 'documents') {
    const count = value.documentIds?.length ?? 0;
    return count ? `指定文档 ${count} 份` : '指定文档（未选择）';
  }
  return '全部文档';
}

export function isScopeEmpty(scope: McpDocumentScope): boolean {
  if (scope.mode === 'tags') {
    return (scope.tags?.length ?? 0) === 0;
  }
  if (scope.mode === 'documents') {
    return (scope.documentIds?.length ?? 0) === 0;
  }
  return false;
}

const SUSPICIOUS_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?)/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /ignore\s+(the\s+)?system\s+prompt/i,
  /(system|developer)\s+prompt/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /<\/?\s*(system|assistant|developer)\s*>/i,
  /忽略(以上|之前|前面|上述|所有)(的)?(指令|提示|要求|规则)/,
  /(系统|开发者)提示词/,
  /不要(再)?(遵守|执行)(之前|以上)的(指令|规则)/,
];

export function detectSuspiciousText(text: string): boolean {
  return SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(text));
}

export const SearchKnowledgeInputSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  scope: McpRequestScopeSchema,
});

export const ReadWikiInputSchema = z
  .object({
    slug: z.string().trim().min(1).max(255).optional(),
    pageId: z.string().uuid().optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine((value) => Boolean(value.slug || value.pageId), {
    message: '需要提供 slug 或 pageId',
  });

export const GetRelatedKnowledgeInputSchema = z
  .object({
    entityId: z.string().uuid().optional(),
    pageId: z.string().uuid().optional(),
    hops: z.number().int().min(1).max(2).optional(),
  })
  .refine((value) => Boolean(value.entityId || value.pageId), {
    message: '需要提供 entityId 或 pageId',
  });

export const GetKnowledgeSourcesInputSchema = z
  .object({
    chunkId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.chunkId || value.documentId), {
    message: '需要提供 chunkId 或 documentId',
  });

export const AskKnowledgeInputSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  scope: McpRequestScopeSchema,
});

export const ProposeKnowledgeUpdateInputSchema = z.object({
  pageId: z.string().uuid(),
  summary: z.string().trim().min(1).max(4000),
  evidenceChunkIds: z.array(z.string().uuid()).min(1).max(20),
});

export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInputSchema>;
export type ReadWikiInput = z.infer<typeof ReadWikiInputSchema>;
export type GetRelatedKnowledgeInput = z.infer<typeof GetRelatedKnowledgeInputSchema>;
export type GetKnowledgeSourcesInput = z.infer<typeof GetKnowledgeSourcesInputSchema>;
export type AskKnowledgeInput = z.infer<typeof AskKnowledgeInputSchema>;
export type ProposeKnowledgeUpdateInput = z.infer<typeof ProposeKnowledgeUpdateInputSchema>;

export const MCP_TOOL_INPUT_SCHEMAS = {
  search_knowledge: SearchKnowledgeInputSchema,
  read_wiki: ReadWikiInputSchema,
  get_related_knowledge: GetRelatedKnowledgeInputSchema,
  get_knowledge_sources: GetKnowledgeSourcesInputSchema,
  ask_knowledge: AskKnowledgeInputSchema,
  propose_knowledge_update: ProposeKnowledgeUpdateInputSchema,
} as const;

export const CreateMcpTokenSchema = z.object({
  name: z.string().trim().min(1).max(128),
  scope: McpDocumentScopeSchema.optional(),
  tools: z.array(z.enum(MCP_TOOL_NAMES)).min(1).max(MCP_TOOL_NAMES.length).optional(),
  dailyLimit: z.number().int().min(1).max(100000).optional(),
  qpsLimit: z.number().int().min(1).max(100).optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export type CreateMcpTokenInput = z.infer<typeof CreateMcpTokenSchema>;

export const UpdateMcpTokenSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  scope: McpDocumentScopeSchema.optional(),
  tools: z.array(z.enum(MCP_TOOL_NAMES)).min(1).max(MCP_TOOL_NAMES.length).optional(),
  dailyLimit: z.number().int().min(1).max(100000).optional(),
  qpsLimit: z.number().int().min(1).max(100).optional(),
});

export type UpdateMcpTokenInput = z.infer<typeof UpdateMcpTokenSchema>;

export function isMcpToolName(value: string): value is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(value);
}

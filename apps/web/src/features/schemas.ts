import { z } from 'zod';

export const VersionSchema = z.object({
  id: z.string(),
  versionNo: z.number(),
  status: z.string(),
  charCount: z.number().default(0),
  pageCount: z.number().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  originalFilename: z.string().nullable().optional(),
  isCurrent: z.boolean().optional(),
  createdAt: z.string(),
});

export const DocumentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentVersion: VersionSchema.nullable(),
});

export const DocumentListSchema = z.object({
  items: z.array(DocumentSummarySchema),
  nextCursor: z.string().nullable(),
});

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  sources: z.array(
    z.object({
      documentId: z.string(),
      sourceId: z.string(),
      source: z.object({
        id: z.string(),
        type: z.string(),
        identifier: z.string(),
        title: z.string().nullable(),
      }),
    }),
  ),
  versions: z.array(VersionSchema),
});

export const ChunkSchema = z.object({
  id: z.string(),
  chunkIndex: z.number(),
  text: z.string(),
  headingPath: z.array(z.string()).default([]),
  pageStart: z.number().nullable().optional(),
  pageEnd: z.number().nullable().optional(),
  tokenCount: z.number(),
  type: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  vectorStatus: z.string(),
  location: z.unknown().nullable().optional(),
});

export const ChunkListSchema = z.object({
  items: z.array(ChunkSchema),
});

export const JobStepSchema = z.object({
  id: z.string(),
  step: z.string(),
  stepOrder: z.number(),
  status: z.string(),
  attempt: z.number(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const JobSummarySchema = z.object({
  id: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  status: z.string(),
  currentStep: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  document: z.object({ id: z.string(), title: z.string() }),
  version: z.object({ id: z.string(), versionNo: z.number(), status: z.string() }),
  steps: z.array(JobStepSchema).optional(),
});

export const JobListSchema = z.object({
  items: z.array(JobSummarySchema),
  nextCursor: z.string().nullable(),
});

export const MetricsSchema = z.object({
  documents: z.object({
    total: z.number(),
    ready: z.number(),
    processing: z.number(),
    failed: z.number(),
  }),
  chunks: z.object({ total: z.number(), vectorReady: z.number() }),
  storage: z.object({ bytes: z.number() }),
  jobs: z.object({ queued: z.number(), running: z.number(), failed: z.number() }),
  queue: z.object({
    waiting: z.number(),
    active: z.number(),
    failed: z.number(),
    completed: z.number(),
    backlog: z.number(),
    alert: z.boolean(),
  }),
  health: z.object({
    lastEvent: z
      .object({
        level: z.string(),
        type: z.string(),
        message: z.string(),
        createdAt: z.string(),
      })
      .nullable(),
  }),
  retrieval: z.object({ runs7d: z.number(), p95Ms: z.number().nullable() }),
  messages: z.object({ citationFailRate: z.number().nullable() }),
  recentDocuments: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      updatedAt: z.string(),
    }),
  ),
  recentJobs: z.array(
    z.object({
      id: z.string(),
      documentId: z.string(),
      documentTitle: z.string(),
      status: z.string(),
      currentStep: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const CitationSchema = z.object({
  ordinal: z.number(),
  chunkId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  quote: z.string(),
  isValid: z.boolean().optional(),
  valid: z.boolean().optional(),
  validationError: z.string().nullable().optional(),
});

export const MessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  status: z.string(),
  model: z.string().nullable().optional(),
  citationCheck: z
    .object({
      status: z.string().optional(),
      checked: z.number().optional(),
      invalid: z.array(z.unknown()).optional(),
      outOfRange: z.array(z.number()).optional(),
    })
    .nullable()
    .optional(),
  createdAt: z.string(),
  citations: z.array(CitationSchema).default([]),
});

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ConversationDetailSchema = ConversationSummarySchema.extend({
  messages: z.array(MessageSchema),
});

export const ConversationListSchema = z.array(ConversationSummarySchema);

export const SettingsSchema = z.object({
  settings: z.record(z.unknown()),
  providers: z.array(
    z.object({
      kind: z.string(),
      provider: z.string(),
      model: z.string(),
      baseUrl: z.string().nullable(),
      apiKeyLast4: z.string().nullable(),
      isActive: z.boolean(),
      updatedAt: z.string(),
    }),
  ),
  runtime: z.object({
    chat: z.object({ model: z.string(), source: z.string() }),
    embedding: z.object({ model: z.string(), dim: z.number(), source: z.string() }),
  }),
});

export type Version = z.infer<typeof VersionSchema>;
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type JobSummary = z.infer<typeof JobSummarySchema>;
export type JobStep = z.infer<typeof JobStepSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export const WikiRevisionSchema = z.object({
  id: z.string(),
  revisionNo: z.number(),
  editorType: z.string(),
  changeSummary: z.string().nullable(),
  content: z.unknown(),
  evidenceChunkIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  proposalId: z.string().nullable().optional(),
});

export const WikiPageSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
  aliases: z.array(z.string()).default([]),
  currentRevisionId: z.string().nullable(),
  updatedAt: z.string(),
  currentRevision: WikiRevisionSchema.nullable().optional(),
});

export const WikiLinkSchema = z.object({
  id: z.string(),
  targetSlug: z.string(),
  relationType: z.string().nullable(),
  context: z.string().nullable(),
  toPage: WikiPageSummarySchema.nullable().optional(),
});

export const WikiBacklinkSchema = z.object({
  id: z.string(),
  context: z.string().nullable(),
  fromPage: WikiPageSummarySchema,
});

export const WikiEvidenceSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  text: z.string(),
});

export const WikiPageDetailSchema = WikiPageSummarySchema.extend({
  revisions: z.array(WikiRevisionSchema),
  outgoingLinks: z.array(WikiLinkSchema).default([]),
  backlinks: z.array(WikiBacklinkSchema).default([]),
  unresolvedConflicts: z.number().default(0),
  evidence: z.array(WikiEvidenceSchema).default([]),
});

export const WikiPageListSchema = z.array(WikiPageSummarySchema);

export const WikiProposalSchema = z.object({
  id: z.string(),
  targetPageId: z.string().nullable(),
  changeType: z.string(),
  baseRevisionId: z.string().nullable(),
  patch: z.unknown(),
  evidence: z.unknown(),
  conflicts: z.unknown(),
  validation: z.unknown(),
  status: z.string(),
  rejectReason: z.string().nullable(),
  rejectComment: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  targetPage: WikiPageSummarySchema.nullable().optional(),
  evidenceChunks: z.array(WikiEvidenceSchema).default([]),
});

export const WikiProposalListSchema = z.array(WikiProposalSchema);

export const WikiConflictSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  pageId: z.string().nullable(),
  pageTitle: z.string().nullable(),
  type: z.string(),
  subject: z.string().optional(),
  predicate: z.string().optional(),
  detail: z.string().optional(),
  a: z.object({ value: z.string(), evidenceChunkId: z.string() }).optional(),
  b: z.object({ value: z.string(), evidenceChunkId: z.string() }).optional(),
  resolution: z.string().optional(),
});

export const WikiConflictListSchema = z.array(WikiConflictSchema);

export const WikiReviewTaskSchema = z.object({
  id: z.string(),
  type: z.string(),
  targetId: z.string(),
  priority: z.number(),
  status: z.string(),
  proposalId: z.string().nullable(),
  createdAt: z.string(),
});

export const WikiReviewTaskListSchema = z.array(WikiReviewTaskSchema);

export const WikiEntitySchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  normalizedName: z.string(),
  type: z.string(),
  aliases: z.array(z.string()).default([]),
  mentionCount: z.number(),
  confidence: z.number(),
  status: z.string(),
});

export const WikiEntityListSchema = z.array(WikiEntitySchema);

export const WikiDiffSchema = z.object({
  from: z.object({ id: z.string(), revisionNo: z.number() }),
  to: z.object({ id: z.string(), revisionNo: z.number() }),
  added: z.array(z.unknown()),
  removed: z.array(z.unknown()),
  changed: z.array(z.unknown()),
});

export type WikiRevision = z.infer<typeof WikiRevisionSchema>;
export type WikiPageSummary = z.infer<typeof WikiPageSummarySchema>;
export type WikiPageDetail = z.infer<typeof WikiPageDetailSchema>;
export type WikiProposal = z.infer<typeof WikiProposalSchema>;
export type WikiConflict = z.infer<typeof WikiConflictSchema>;
export type WikiReviewTask = z.infer<typeof WikiReviewTaskSchema>;
export type WikiEntity = z.infer<typeof WikiEntitySchema>;
export type WikiDiff = z.infer<typeof WikiDiffSchema>;

export const GraphNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  aliases: z.array(z.string()).default([]),
  mentionCount: z.number(),
  confidence: z.number(),
  mergedIntoId: z.string().nullable().optional(),
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  type: z.string(),
  confidence: z.number(),
  evidenceChunkIds: z.array(z.string()).default([]),
  status: z.string(),
  origin: z.string(),
  direction: z.string(),
});

export const GraphNeighborhoodSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  truncated: z.boolean(),
});

export const GraphEntrySchema = z.array(z.object({ node: GraphNodeSchema, degree: z.number() }));

export const GraphPathSchema = z.object({
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  chunkIds: z.array(z.string()),
  score: z.number(),
  scoreBreakdown: z.object({
    confidenceProduct: z.number(),
    sourceQuality: z.number(),
    weakPenalty: z.number(),
  }),
});

export const GraphPathListSchema = z.array(GraphPathSchema);

export const GraphEdgeListSchema = z.array(GraphEdgeSchema);

export const EntityMentionSchema = z.object({
  id: z.string(),
  chunkId: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  chunk: z.object({ id: z.string(), documentId: z.string(), text: z.string() }),
});

export const EntityMentionListSchema = z.array(EntityMentionSchema);

export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphNeighborhood = z.infer<typeof GraphNeighborhoodSchema>;
export type GraphEntry = z.infer<typeof GraphEntrySchema>;
export type GraphPath = z.infer<typeof GraphPathSchema>;
export type EntityMention = z.infer<typeof EntityMentionSchema>;

export const AgentVersionSchema = z.object({
  id: z.string(),
  versionNo: z.number(),
  systemPrompt: z.string(),
  model: z.string(),
  temperature: z.number(),
  toolAllowlist: z.array(z.string()).default([]),
  maxSteps: z.number(),
  tokenBudget: z.number(),
  toolCallBudget: z.number(),
  allowProposal: z.boolean(),
  createdAt: z.string(),
});

export const AgentRunSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentVersionId: z.string(),
  trigger: z.string(),
  input: z.unknown(),
  status: z.string(),
  totalSteps: z.number(),
  totalTokens: z.number(),
  durationMs: z.number().nullable(),
  terminationReason: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const AgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  versions: z.array(AgentVersionSchema).default([]),
  runs: z.array(AgentRunSummarySchema).default([]),
  monthTokens: z.number().optional(),
});

export const AgentListSchema = z.array(AgentSummarySchema);

export const AgentDetailSchema = AgentSummarySchema.extend({
  monthTokens: z.number().default(0),
  medianTokens: z.number().nullable().optional(),
});

export const RunStepSchema = z.object({
  id: z.string(),
  stepIndex: z.number(),
  type: z.string(),
  outputSummary: z.string().nullable(),
  durationMs: z.number().nullable(),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  stepIndex: z.number(),
  toolName: z.string(),
  paramsRedacted: z.unknown(),
  resultSummary: z.string().nullable(),
  status: z.string(),
  durationMs: z.number(),
  errorCode: z.string().nullable(),
});

export const AgentRunDetailSchema = AgentRunSummarySchema.extend({
  steps: z.array(RunStepSchema).default([]),
  toolCalls: z.array(ToolCallSchema).default([]),
  agent: AgentSummarySchema.pick({ id: true, name: true }),
  agentVersion: AgentVersionSchema,
});

export const AgentRunListSchema = z.array(AgentRunSummarySchema);

export const AgentUsageSchema = z.object({
  runs: z.number(),
  tokens: z.number(),
  budget: z.number(),
  remaining: z.number(),
});

export const AgentEstimateSchema = z.object({
  medianTokens: z.number().nullable(),
  estimatedTokens: z.number(),
});

export const AgentToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: z.string(),
  paramsHint: z.string(),
});

export const AgentToolListSchema = z.array(AgentToolSchema);

export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type AgentDetail = z.infer<typeof AgentDetailSchema>;
export type AgentVersion = z.infer<typeof AgentVersionSchema>;
export type AgentRunSummary = z.infer<typeof AgentRunSummarySchema>;
export type AgentRunDetail = z.infer<typeof AgentRunDetailSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type AgentTool = z.infer<typeof AgentToolSchema>;
export type AgentUsage = z.infer<typeof AgentUsageSchema>;
export type AgentEstimate = z.infer<typeof AgentEstimateSchema>;

export const McpScopeSchema = z.object({
  mode: z.enum(['all', 'tags', 'documents']),
  tags: z.array(z.string()).optional(),
  documentIds: z.array(z.string()).optional(),
});

export const McpTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  scope: McpScopeSchema,
  scopeSummary: z.string(),
  tools: z.array(z.string()),
  dailyLimit: z.number(),
  qpsLimit: z.number(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  todayCalls: z.number(),
  status: z.enum(['active', 'expired', 'revoked']),
});

export const McpCreatedTokenSchema = McpTokenSchema.extend({ token: z.string() });

export const McpTokenListSchema = z.array(McpTokenSchema);

export const McpAuditSchema = z.object({
  id: z.string(),
  tokenId: z.string().nullable(),
  tokenName: z.string().nullable(),
  tool: z.string(),
  paramsSummary: z.unknown().nullable(),
  resultCount: z.number().nullable(),
  durationMs: z.number(),
  statusCode: z.number(),
  transport: z.string(),
  suspicious: z.boolean(),
  createdAt: z.string(),
});

export const McpAuditListSchema = z.array(McpAuditSchema);

export const McpAuditStatsSchema = z.object({
  calls: z.number(),
  failures: z.number(),
  rateLimited: z.number(),
  avgLatencyMs: z.number(),
  byTool: z.array(z.object({ tool: z.string(), count: z.number() })),
});

export const McpTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  resultCount: z.number().optional(),
  message: z.string(),
});

export type McpScope = z.infer<typeof McpScopeSchema>;
export type McpToken = z.infer<typeof McpTokenSchema>;
export type McpCreatedToken = z.infer<typeof McpCreatedTokenSchema>;
export type McpAudit = z.infer<typeof McpAuditSchema>;
export type McpAuditStats = z.infer<typeof McpAuditStatsSchema>;
export type McpTestResult = z.infer<typeof McpTestResultSchema>;

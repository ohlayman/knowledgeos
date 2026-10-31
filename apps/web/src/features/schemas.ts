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

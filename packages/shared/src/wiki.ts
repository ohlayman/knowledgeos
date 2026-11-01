import { z } from 'zod';

export const WIKI_PAGE_TYPES = [
  'concept',
  'technology',
  'project',
  'comparison',
  'research',
  'source',
] as const;

export const WIKI_PAGE_STATUSES = ['draft', 'proposed', 'published', 'archived', 'stale'] as const;

export const WikiParagraphSchema = z.object({
  id: z.string().min(1).max(64),
  section: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(2000),
  evidenceChunkIds: z.array(z.string().uuid()).max(20).default([]),
  origin: z.enum(['model', 'human']).default('human'),
  versionIntroduced: z.number().int().min(1).optional(),
});

export const WikiContentSchema = z.object({
  summary: z.string().trim().max(500).default(''),
  paragraphs: z.array(WikiParagraphSchema).max(50),
});

export const CreateWikiPageSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\p{L}\p{N}-]+$/u, 'slug 只允许字母、数字与连字符')
    .optional(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(WIKI_PAGE_TYPES),
  summary: z.string().trim().max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

export const UpdateWikiPageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  archive: z.boolean().optional(),
});

export const WikiRevisionInputSchema = z.object({
  content: WikiContentSchema,
  baseRevisionId: z.string().uuid(),
  changeSummary: z.string().trim().max(200).optional(),
});

export const WikiRollbackSchema = z.object({
  targetRevisionId: z.string().uuid(),
  reason: z.string().trim().min(1).max(200),
});

export const WikiAcceptProposalSchema = z.object({
  baseRevisionId: z.string().uuid().optional(),
});

export const WIKI_REJECT_REASONS = [
  'factual_error',
  'insufficient_evidence',
  'duplicate',
  'wrong_ownership',
  'wording',
] as const;

export const WikiRejectProposalSchema = z.object({
  reason: z.enum(WIKI_REJECT_REASONS),
  comment: z.string().trim().max(500).optional(),
});

export const WikiRewriteProposalSchema = z.object({
  content: WikiContentSchema,
  baseRevisionId: z.string().uuid(),
  summary: z.string().trim().max(200).optional(),
});

export const WIKI_CONFLICT_RESOLUTIONS = ['keep_a', 'keep_b', 'merge', 'dismiss'] as const;

export const WikiResolveConflictSchema = z.object({
  resolution: z.enum(WIKI_CONFLICT_RESOLUTIONS),
  reason: z.string().trim().max(500).optional(),
});

export const WikiMergeEntitySchema = z.object({
  targetEntityId: z.string().uuid(),
});

export const WikiTriggerExtractionSchema = z.object({
  documentId: z.string().uuid(),
});

export const WikiResolveStaleSchema = z.object({
  action: z.enum(['confirm', 'archive']),
});

export const WikiCommentSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

export type WikiContentInput = z.infer<typeof WikiContentSchema>;
export type WikiPageTypeName = (typeof WIKI_PAGE_TYPES)[number];
export type WikiRejectReason = (typeof WIKI_REJECT_REASONS)[number];

import { z } from 'zod';
import { LIMITS } from './constants.js';

export const TextDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(LIMITS.maxTextChars),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]),
});

export type TextDocumentInput = z.infer<typeof TextDocumentInputSchema>;

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), '仅支持 http/https URL');

export const UrlImportInputSchema = z.object({
  urls: z.array(HttpUrlSchema).min(1).max(LIMITS.maxUrlsPerBatch),
});

export type UrlImportInput = z.infer<typeof UrlImportInputSchema>;

export const VersionStatusSchema = z.enum([
  'queued',
  'processing',
  'ready',
  'failed',
  'needs_ocr',
  'expired',
]);

export const SourceTypeSchema = z.enum(['file', 'url', 'manual', 'github', 'rss', 'notion']);

export const DocumentListQuerySchema = z.object({
  status: VersionStatusSchema.optional(),
  type: SourceTypeSchema.optional(),
  tag: z.string().trim().min(1).max(50).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const UpdateDocumentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  })
  .refine((value) => value.title !== undefined || value.tags !== undefined, {
    message: '至少提供一个可更新字段',
  });

export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInputSchema>;

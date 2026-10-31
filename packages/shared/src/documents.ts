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

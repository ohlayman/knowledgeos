import { z } from 'zod';

export const RetrievalSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  documentIds: z.array(z.string().uuid()).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  includeHistoryVersions: z.boolean().optional(),
  topK: z.number().int().min(1).max(50).optional(),
});

export type RetrievalSearchInput = z.infer<typeof RetrievalSearchInputSchema>;

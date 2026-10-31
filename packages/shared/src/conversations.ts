import { z } from 'zod';

export const CreateConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const MessageScopeSchema = z.object({
  documentIds: z.array(z.string().uuid()).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  includeHistoryVersions: z.boolean().optional(),
});

export const SendMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().trim().min(1).max(128).optional(),
  scope: MessageScopeSchema.optional(),
});

export const FeedbackInputSchema = z
  .object({
    type: z.enum(['helpful', 'not_helpful', 'citation_wrong']),
    citationOrdinal: z.number().int().min(1).max(99).optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.type !== 'citation_wrong' || value.citationOrdinal !== undefined, {
    message: 'citation_wrong 需要 citationOrdinal',
  });

export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;

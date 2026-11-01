import { z } from 'zod';

export const ENTITY_TYPES = ['concept', 'technology', 'project', 'agent', 'protocol'] as const;
export const RELATION_TYPES = [
  'RELATED_TO',
  'DEPENDS_ON',
  'USES',
  'IMPLEMENTS',
  'REFERENCES',
  'PART_OF',
  'COMPETES_WITH',
  'EXTENDS',
  'CONFLICTS_WITH',
] as const;

export const ExtractedEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(ENTITY_TYPES),
  aliases: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  evidenceChunkId: z.string().uuid().optional(),
});

export const ExtractedRelationSchema = z.object({
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().min(1).max(200),
  type: z.enum(RELATION_TYPES),
  evidenceChunkId: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const ExtractedFactSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  predicate: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1).max(500),
  valueType: z.enum(['number', 'boolean', 'version', 'text']).optional(),
  evidenceChunkId: z.string().uuid().optional(),
});

export const ExtractionResultSchema = z.object({
  entities: z.array(ExtractedEntitySchema).max(50).default([]),
  relations: z.array(ExtractedRelationSchema).max(50).default([]),
  facts: z.array(ExtractedFactSchema).max(50).default([]),
});

export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;
export type ExtractedRelation = z.infer<typeof ExtractedRelationSchema>;
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ExtractionModel {
  readonly model: string;
  complete(messages: ChatMessage[]): Promise<{ text: string }>;
}

export interface ExtractionCache {
  get(chunkId: string, model: string, promptVersion: string): Promise<ExtractionResult | null>;
  set(
    chunkId: string,
    model: string,
    promptVersion: string,
    result: ExtractionResult,
  ): Promise<void>;
}

export interface ExtractChunkInput {
  chunkId: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
  knownEntities?: string[];
  tokenBudgetLeft?: number;
}

export type ExtractionOutcome =
  | {
      status: 'ok';
      result: ExtractionResult;
      cached: boolean;
      attempts: number;
      entitiesOnly: boolean;
    }
  | { status: 'skipped'; reason: 'schema_invalid' | 'budget_exhausted'; attempts: number };

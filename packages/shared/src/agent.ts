import { z } from 'zod';

export const AGENT_TOOL_NAMES = [
  'search_knowledge',
  'get_chunk',
  'read_wiki_page',
  'get_related_knowledge',
  'summarize_document',
  'propose_wiki_update',
] as const;

const AgentConfigSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(500).optional(),
  systemPrompt: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).max(127).optional(),
  temperature: z.number().min(0).max(1).optional(),
  toolAllowlist: z.array(z.enum(AGENT_TOOL_NAMES)).max(6).optional(),
  maxSteps: z.number().int().min(1).max(12).optional(),
  tokenBudget: z.number().int().min(500).max(200000).optional(),
  toolCallBudget: z.number().int().min(1).max(30).optional(),
  allowProposal: z.boolean().optional(),
});

export const CreateAgentSchema = AgentConfigSchema;
export const UpdateAgentSchema = AgentConfigSchema.partial().extend({
  archive: z.boolean().optional(),
});

export const TriggerAgentRunSchema = z.object({
  input: z.string().trim().min(1).max(4000),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

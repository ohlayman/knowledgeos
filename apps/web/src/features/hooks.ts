import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api-client';
import {
  ChunkListSchema,
  ConversationDetailSchema,
  ConversationListSchema,
  DocumentDetailSchema,
  DocumentListSchema,
  JobListSchema,
  JobSummarySchema,
  MessageSchema,
  MetricsSchema,
  SettingsSchema,
  WikiConflictListSchema,
  WikiDiffSchema,
  WikiEntityListSchema,
  WikiPageDetailSchema,
  WikiPageListSchema,
  WikiProposalListSchema,
  WikiProposalSchema,
  WikiReviewTaskListSchema,
  GraphEntrySchema,
  GraphNeighborhoodSchema,
  GraphEdgeListSchema,
  EntityMentionListSchema,
  AgentListSchema,
  AgentDetailSchema,
  AgentRunListSchema,
  AgentRunDetailSchema,
  AgentUsageSchema,
  AgentEstimateSchema,
  AgentToolListSchema,
} from './schemas.js';

function visibleInterval(ms: number) {
  return () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : ms;
}

export interface DocumentFilters {
  status?: string;
  type?: string;
  tag?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: async () => MetricsSchema.parse(await apiFetch('/metrics/overview')),
    refetchInterval: visibleInterval(30_000),
  });
}

export function useDocuments(filters: DocumentFilters) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  return useQuery({
    queryKey: ['documents', filters],
    queryFn: async () =>
      DocumentListSchema.parse(await apiFetch(`/documents?${search.toString()}`)),
    refetchInterval: visibleInterval(5_000),
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['document', id],
    enabled: Boolean(id),
    queryFn: async () => DocumentDetailSchema.parse(await apiFetch(`/documents/${id}`)),
    refetchInterval: visibleInterval(10_000),
  });
}

export function useChunks(versionId: string | undefined) {
  return useQuery({
    queryKey: ['chunks', versionId],
    enabled: Boolean(versionId),
    queryFn: async () => ChunkListSchema.parse(await apiFetch(`/versions/${versionId}/chunks`)),
  });
}

export function useJobs(filters: { status?: string; cursor?: string } = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      search.set(key, value);
    }
  }

  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: async () => JobListSchema.parse(await apiFetch(`/jobs?${search.toString()}`)),
    refetchInterval: visibleInterval(4_000),
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ['job', id],
    enabled: Boolean(id),
    queryFn: async () => JobSummarySchema.parse(await apiFetch(`/jobs/${id}`)),
    refetchInterval: visibleInterval(4_000),
  });
}

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => ConversationListSchema.parse(await apiFetch('/conversations')),
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ['conversation', id],
    enabled: Boolean(id),
    queryFn: async () => ConversationDetailSchema.parse(await apiFetch(`/conversations/${id}`)),
  });
}

export function useMessage(id: string | undefined) {
  return useQuery({
    queryKey: ['message', id],
    enabled: Boolean(id),
    queryFn: async () => MessageSchema.parse(await apiFetch(`/messages/${id}`)),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => SettingsSchema.parse(await apiFetch('/settings')),
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['metrics'] });
    },
  });
}

export function useUpdateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title?: string; tags?: string[] }) =>
      apiFetch(`/documents/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['document'] });
    },
  });
}

export function useIngestText() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; content: string; tags: string[] }) =>
      apiFetch<{ item: unknown }>('/documents/text', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: ['metrics'] });
    },
  });
}

export function useRetryJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; mode: 'step' | 'full'; step?: string }) =>
      apiFetch(`/jobs/${input.id}/retry`, {
        method: 'POST',
        body: JSON.stringify({
          mode: input.mode,
          ...(input.step ? { step: input.step } : {}),
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/jobs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

export function useCreateConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) =>
      apiFetch<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify(title ? { title } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useDeleteConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useFeedback() {
  return useMutation({
    mutationFn: (input: {
      messageId: string;
      type: 'helpful' | 'not_helpful' | 'citation_wrong';
      citationOrdinal?: number;
    }) =>
      apiFetch(`/messages/${input.messageId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          type: input.type,
          ...(input.citationOrdinal ? { citationOrdinal: input.citationOrdinal } : {}),
        }),
      }),
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, number | boolean | string>) =>
      apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useSaveProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: 'llm' | 'embedding';
      provider: string;
      model: string;
      baseUrl?: string;
      apiKey?: string;
      dim?: number;
    }) =>
      apiFetch(`/settings/providers/${input.kind}`, {
        method: 'PUT',
        body: JSON.stringify({
          provider: input.provider,
          model: input.model,
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.dim ? { dim: input.dim } : {}),
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useExportBundle() {
  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/v1/export');
      if (!response.ok) {
        throw new Error(`导出失败（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `knowledgeos-export-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
}

export function useClearKnowledgeBase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) =>
      apiFetch<{ documents: number; versions: number; objectsDeleted: number }>(
        '/maintenance/clear',
        { method: 'POST', body: JSON.stringify({ confirm }) },
      ),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (input: {
      kind: 'llm' | 'embedding';
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      dim?: number;
    }) =>
      apiFetch<{ ok: boolean; code?: string; message?: string; latencyMs: number }>(
        '/settings/test-connection',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  });
}

export function useWikiPages(filters: { type?: string; status?: string } = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      search.set(key, value);
    }
  }
  return useQuery({
    queryKey: ['wiki-pages', filters],
    queryFn: async () =>
      WikiPageListSchema.parse(await apiFetch(`/wiki/pages?${search.toString()}`)),
  });
}

export function useWikiPage(slug: string | undefined) {
  return useQuery({
    queryKey: ['wiki-page', slug],
    enabled: Boolean(slug),
    queryFn: async () =>
      WikiPageDetailSchema.parse(await apiFetch(`/wiki/pages/${encodeURIComponent(slug!)}`)),
  });
}

export function useWikiProposals(status?: string) {
  return useQuery({
    queryKey: ['wiki-proposals', status],
    queryFn: async () =>
      WikiProposalListSchema.parse(
        await apiFetch(`/wiki/proposals${status ? `?status=${status}` : ''}`),
      ),
  });
}

export function useWikiProposal(id: string | undefined) {
  return useQuery({
    queryKey: ['wiki-proposal', id],
    enabled: Boolean(id),
    queryFn: async () => WikiProposalSchema.parse(await apiFetch(`/wiki/proposals/${id}`)),
  });
}

export function useWikiConflicts() {
  return useQuery({
    queryKey: ['wiki-conflicts'],
    queryFn: async () => WikiConflictListSchema.parse(await apiFetch('/wiki/conflicts')),
  });
}

export function useWikiReviewTasks(status = 'open') {
  return useQuery({
    queryKey: ['wiki-tasks', status],
    queryFn: async () =>
      WikiReviewTaskListSchema.parse(await apiFetch(`/wiki/review-tasks?status=${status}`)),
  });
}

export function useWikiEntities(query?: string) {
  return useQuery({
    queryKey: ['wiki-entities', query],
    queryFn: async () =>
      WikiEntityListSchema.parse(
        await apiFetch(`/entities${query ? `?q=${encodeURIComponent(query)}` : ''}`),
      ),
  });
}

export function useWikiDiff(slug: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['wiki-diff', slug, from, to],
    enabled: Boolean(slug && from && to),
    queryFn: async () =>
      WikiDiffSchema.parse(
        await apiFetch(`/wiki/pages/${encodeURIComponent(slug!)}/diff?from=${from}&to=${to}`),
      ),
  });
}

export function useCreateWikiPage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; type: string; slug?: string; summary?: string }) =>
      apiFetch('/wiki/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wiki-pages'] }),
  });
}

export function useSaveWikiRevision(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      content: unknown;
      baseRevisionId: string;
      changeSummary?: string;
    }) =>
      apiFetch(`/wiki/pages/${encodeURIComponent(slug)}/revisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['wiki-page', slug] });
    },
  });
}

export function useRollbackWikiPage(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { targetRevisionId: string; reason: string }) =>
      apiFetch(`/wiki/pages/${encodeURIComponent(slug)}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['wiki-page', slug] });
    },
  });
}

export function useAcceptProposal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; baseRevisionId?: string }) =>
      apiFetch(`/wiki/proposals/${input.id}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input.baseRevisionId ? { baseRevisionId: input.baseRevisionId } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['wiki-proposals'] });
      void client.invalidateQueries({ queryKey: ['wiki-pages'] });
    },
  });
}

export function useRejectProposal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string; comment?: string }) =>
      apiFetch(`/wiki/proposals/${input.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: input.reason, comment: input.comment }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wiki-proposals'] }),
  });
}

export function useRewriteProposal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      content: unknown;
      baseRevisionId: string;
      summary?: string;
    }) =>
      apiFetch(`/wiki/proposals/${input.id}/rewrite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['wiki-proposals'] });
      void client.invalidateQueries({ queryKey: ['wiki-pages'] });
    },
  });
}

export function useResolveConflict() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; resolution: string; reason?: string }) =>
      apiFetch(`/wiki/conflicts/${input.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: input.resolution, reason: input.reason }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wiki-conflicts'] }),
  });
}

export function useResolveStale(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: 'confirm' | 'archive') =>
      apiFetch(`/wiki/pages/${encodeURIComponent(slug)}/stale`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wiki-page', slug] }),
  });
}

export function useTriggerExtraction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) =>
      apiFetch('/wiki/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['wiki-proposals'] });
    },
  });
}

export function useGraphEntry() {
  return useQuery({
    queryKey: ['graph-entry'],
    queryFn: async () => GraphEntrySchema.parse(await apiFetch('/graph/entry?limit=20')),
  });
}

export function useGraphNeighborhood(entityId: string | undefined, hops = 1, enabled = true) {
  return useQuery({
    queryKey: ['graph-neighbors', entityId, hops],
    enabled: Boolean(entityId) && enabled,
    queryFn: async () =>
      GraphNeighborhoodSchema.parse(
        await apiFetch(`/graph/entities/${entityId}/neighbors?hops=${hops}`),
      ),
  });
}

export function useEntityMentions(entityId: string | undefined) {
  return useQuery({
    queryKey: ['entity-mentions', entityId],
    enabled: Boolean(entityId),
    queryFn: async () =>
      EntityMentionListSchema.parse(await apiFetch(`/entities/${entityId}/mentions`)),
  });
}

export function useGraphPending() {
  return useQuery({
    queryKey: ['graph-pending'],
    queryFn: async () => GraphEdgeListSchema.parse(await apiFetch('/graph/pending')),
  });
}

export function useConfirmRelation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/graph/relations/${id}/confirm`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['graph-neighbors'] }),
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => AgentListSchema.parse(await apiFetch('/agents')),
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: ['agent', id],
    enabled: Boolean(id),
    queryFn: async () => AgentDetailSchema.parse(await apiFetch(`/agents/${id}`)),
  });
}

export function useAgentRuns(agentId: string | undefined) {
  return useQuery({
    queryKey: ['agent-runs', agentId],
    enabled: Boolean(agentId),
    queryFn: async () => AgentRunListSchema.parse(await apiFetch(`/agents/${agentId}/runs`)),
    refetchInterval: 3000,
  });
}

export function useAgentRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['agent-run', runId],
    enabled: Boolean(runId),
    queryFn: async () => AgentRunDetailSchema.parse(await apiFetch(`/agent-runs/${runId}`)),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 1500 : false;
    },
  });
}

export function useAgentUsage() {
  return useQuery({
    queryKey: ['agent-usage'],
    queryFn: async () => AgentUsageSchema.parse(await apiFetch('/agents/usage')),
    refetchInterval: 15_000,
  });
}

export function useAgentEstimate(agentId: string | undefined) {
  return useQuery({
    queryKey: ['agent-estimate', agentId],
    enabled: Boolean(agentId),
    queryFn: async () => AgentEstimateSchema.parse(await apiFetch(`/agents/${agentId}/estimate`)),
  });
}

export function useAgentTools() {
  return useQuery({
    queryKey: ['agent-tools'],
    queryFn: async () => AgentToolListSchema.parse(await apiFetch('/agents/tools')),
  });
}

export function useCreateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      apiFetch('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      apiFetch(`/agents/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['agent', id] });
      void client.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useTriggerAgent(agentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: string) =>
      apiFetch(`/agents/${agentId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['agent-runs', agentId] }),
  });
}

export function useCancelAgentRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) =>
      apiFetch(`/agent-runs/${runId}/cancel`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['agent-run'] }),
  });
}

export function useDeleteAgentRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => apiFetch(`/agent-runs/${runId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['agent-run'] });
      void client.invalidateQueries({ queryKey: ['agent-runs'] });
      void client.invalidateQueries({ queryKey: ['agent-usage'] });
    },
  });
}

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

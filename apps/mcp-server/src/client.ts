import type { McpToolName } from '@kos/shared';

export interface ApiClientOptions {
  apiUrl: string;
  token: string;
  transport: 'stdio' | 'http';
  timeoutMs?: number;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class KosApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async call(tool: McpToolName, input: unknown): Promise<unknown> {
    const url = new URL(`/api/v1/mcp/tools/${tool}`, this.options.apiUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          'x-kos-mcp-transport': this.options.transport,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ApiClientError(
          'KnowledgeOS 服务响应超时，请确认服务正在运行',
          504,
          'TIMEOUT',
          true,
        );
      }
      throw new ApiClientError(
        `无法连接 KnowledgeOS（${this.options.apiUrl}），请确认 API 已启动`,
        503,
        'UPSTREAM_UNAVAILABLE',
        true,
      );
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const envelope = (payload ?? {}) as ErrorEnvelope;
      const code = envelope.error?.code ?? 'INTERNAL';
      throw new ApiClientError(
        envelope.error?.message ?? `KnowledgeOS 请求失败（HTTP ${response.status}）`,
        response.status,
        code,
        envelope.error?.retryable ?? false,
        envelope.error?.details,
      );
    }

    return payload;
  }
}

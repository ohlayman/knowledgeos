export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    retryable: boolean;
    requestId?: string;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.requestId = input.requestId;
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    requestId?: string;
  };
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined || init.body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
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
    throw new ApiError({
      code: envelope.error?.code ?? 'INTERNAL',
      message: envelope.error?.message ?? `请求失败（HTTP ${response.status}）`,
      status: response.status,
      retryable: envelope.error?.retryable ?? false,
      ...(envelope.error?.requestId ? { requestId: envelope.error.requestId } : {}),
    });
  }

  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '未知错误';
}

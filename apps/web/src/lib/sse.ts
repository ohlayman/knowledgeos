export interface SseHandlers {
  onMeta?: (data: { conversationId: string; messageId: string }) => void;
  onStatus?: (data: { phase: string }) => void;
  onRetrieval?: (data: {
    traceId?: string;
    questionType?: string;
    vectorCount: number;
    keywordCount: number;
    finalChunkIds: string[];
    degraded: string[];
    paths?: SsePath[];
  }) => void;
  onDelta?: (text: string) => void;
  onCitations?: (data: { citations: Citation[] }) => void;
  onDone?: (data: { status: string; usage?: Record<string, unknown> }) => void;
  onError?: (data: { code: string; message: string; retryable: boolean }) => void;
}

export interface SsePath {
  nodeNames: string[];
  edges: Array<{
    from: string;
    to: string;
    type: string;
    confidence: number;
    evidenceChunkIds: string[];
  }>;
  chunkIds: string[];
  evidenceRefs?: Array<{ chunkId: string; documentId: string }>;
  score: number;
  scoreBreakdown: {
    confidenceProduct: number;
    sourceQuality: number;
    weakPenalty: number;
  };
}

export interface Citation {
  ordinal: number;
  chunkId: string;
  documentId: string;
  versionId: string;
  quote: string;
  valid: boolean;
  validationError?: string;
}

export function dispatchSseFrame(frame: string, handlers: SseHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];

  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  switch (event) {
    case 'meta':
      handlers.onMeta?.(data as { conversationId: string; messageId: string });
      return;
    case 'status':
      handlers.onStatus?.(data as { phase: string });
      return;
    case 'retrieval':
      handlers.onRetrieval?.(
        data as {
          traceId?: string;
          questionType?: string;
          vectorCount: number;
          keywordCount: number;
          finalChunkIds: string[];
          degraded: string[];
          paths?: SsePath[];
        },
      );
      return;
    case 'delta':
      handlers.onDelta?.((data as { text?: string }).text ?? '');
      return;
    case 'citations':
      handlers.onCitations?.(data as { citations: Citation[] });
      return;
    case 'done':
      handlers.onDone?.(data as { status: string; usage?: Record<string, unknown> });
      return;
    case 'error':
      handlers.onError?.(data as { code: string; message: string; retryable: boolean });
      return;
    default:
      return;
  }
}

export async function streamAnswer(
  conversationId: string,
  body: unknown,
  handlers: SseHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    let message = `请求失败（HTTP ${response.status}）`;
    let code = 'INTERNAL';
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
      message = parsed.error?.message ?? message;
      code = parsed.error?.code ?? code;
    } catch {
      // 非 JSON 错误体按通用错误处理
    }
    handlers.onError?.({ code, message, retryable: false });
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += value;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      dispatchSseFrame(frame, handlers);
    }
  }

  if (buffer.trim().length > 0) {
    dispatchSseFrame(buffer, handlers);
  }
}

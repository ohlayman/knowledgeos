import { ApiError } from '@kos/shared';
import type { ChatMessage, ChatProvider, ChatStreamOptions, TokenUsage } from './types.js';

export interface OpenAIChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS = [1000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatibleChatProvider implements ChatProvider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];

  constructor(options: OpenAIChatOptions) {
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  async *stream(messages: ChatMessage[], options: ChatStreamOptions = {}): AsyncIterable<string> {
    let emitted = 0;

    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      try {
        for await (const delta of this.streamOnce(messages, options)) {
          emitted += 1;
          yield delta;
        }
        return;
      } catch (error) {
        const retryable = error instanceof ApiError && error.retryable;
        if (emitted > 0 || !retryable || attempt === this.retryDelaysMs.length) {
          throw error;
        }
        await sleep(this.retryDelaysMs[attempt]!);
      }
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ChatStreamOptions = {},
  ): Promise<{ text: string; usage?: TokenUsage }> {
    const response = await this.request(messages, options, false);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = payload.choices?.[0]?.message?.content ?? '';
    const usage = payload.usage
      ? {
          inputTokens: payload.usage.prompt_tokens,
          outputTokens: payload.usage.completion_tokens,
        }
      : undefined;

    if (usage) {
      options.onUsage?.(usage);
    }

    return { text, ...(usage ? { usage } : {}) };
  }

  private async *streamOnce(
    messages: ChatMessage[],
    options: ChatStreamOptions,
  ): AsyncIterable<string> {
    const response = await this.request(messages, options, true);
    const body = response.body;
    if (!body) {
      throw new ApiError('PROVIDER_UNAVAILABLE', 'chat 响应没有正文');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | undefined;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);

          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) {
              continue;
            }
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              if (usage) {
                options.onUsage?.(usage);
              }
              return;
            }

            const chunk = JSON.parse(data) as ChatChunk;
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              yield delta;
            }
            if (chunk.usage) {
              usage = {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
              };
            }
          }

          index = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (usage) {
      options.onUsage?.(usage);
    }
  }

  private async request(
    messages: ChatMessage[],
    options: ChatStreamOptions,
    stream: boolean,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream,
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        }),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      const name = (error as { name?: string }).name;
      throw new ApiError(
        name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        'chat 请求失败',
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ApiError(
        retryable ? 'PROVIDER_UNAVAILABLE' : 'INVALID_ARGUMENT',
        `chat 请求失败: HTTP ${response.status}`,
      );
    }

    return response;
  }
}

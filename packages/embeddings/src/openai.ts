import { ApiError } from '@kos/shared';
import type { EmbeddingProvider } from './types.js';

export interface OpenAIEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dim: number;
  batchSize?: number;
  timeoutMs?: number;
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS = [1000, 4000, 16000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dim: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];

  constructor(options: OpenAIEmbeddingOptions) {
    this.model = options.model;
    this.dim = options.dim;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.batchSize = options.batchSize ?? 32;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let index = 0; index < texts.length; index += this.batchSize) {
      const batch = texts.slice(index, index + this.batchSize);
      vectors.push(...(await this.embedBatch(batch)));
    }

    return vectors;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      try {
        return await this.request(texts);
      } catch (error) {
        lastError = error;
        if (!(error instanceof ApiError) || !error.retryable) {
          throw error;
        }
        if (attempt === this.retryDelaysMs.length) {
          break;
        }
        await sleep(this.retryDelaysMs[attempt]!);
      }
    }

    throw lastError;
  }

  private async request(texts: string[]): Promise<number[][]> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      throw new ApiError(
        name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        'embedding 请求失败',
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ApiError(
        retryable ? 'PROVIDER_UNAVAILABLE' : 'INVALID_ARGUMENT',
        `embedding 请求失败: HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const data = payload.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new ApiError('PROVIDER_UNAVAILABLE', 'embedding 响应数量与输入不一致');
    }

    return data.map((item) => {
      const embedding = item.embedding;
      if (!Array.isArray(embedding) || embedding.length !== this.dim) {
        throw new ApiError('INVALID_ARGUMENT', 'embedding 响应维度不符合配置');
      }
      return embedding;
    });
  }
}

import type { PrismaClient, ProviderKind } from '@kos/database';
import { loadProviderSettings, ProviderRepository, SettingsRepository } from '@kos/database';
import { OpenAICompatibleEmbeddingProvider } from '@kos/embeddings';
import { OpenAICompatibleChatProvider } from '@kos/llm';
import {
  ApiError,
  encryptSecret,
  type Env,
  type ProviderSaveInput,
  type SettingsUpdate,
  type TestConnectionInput,
} from '@kos/shared';

export interface SettingsOverview {
  settings: Record<string, unknown>;
  providers: Array<{
    kind: ProviderKind;
    provider: string;
    model: string;
    baseUrl: string | null;
    apiKeyLast4: string | null;
    isActive: boolean;
    updatedAt: Date;
  }>;
  runtime: {
    chat: { model: string; source: 'db' | 'env' | 'fake' };
    embedding: { model: string; dim: number; source: 'db' | 'env' | 'fake' };
  };
}

function last4(key: string): string {
  return key.slice(-4);
}

export class SettingsService {
  private readonly providers: ProviderRepository;
  private readonly settings: SettingsRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
  ) {
    this.providers = new ProviderRepository(prisma);
    this.settings = new SettingsRepository(prisma);
  }

  async overview(): Promise<SettingsOverview> {
    const [settings, providers, chat, embedding] = await Promise.all([
      this.settings.list(),
      this.providers.list(),
      loadProviderSettings(this.prisma, this.env.APP_ENCRYPTION_KEY, 'llm'),
      loadProviderSettings(this.prisma, this.env.APP_ENCRYPTION_KEY, 'embedding'),
    ]);

    return {
      settings,
      providers: providers.map((row) => ({
        kind: row.kind,
        provider: row.provider,
        model: row.model,
        baseUrl: row.baseUrl,
        apiKeyLast4: row.apiKeyLast4,
        isActive: row.isActive,
        updatedAt: row.updatedAt,
      })),
      runtime: {
        chat: {
          model: chat?.model ?? this.env.LLM_MODEL ?? 'fake-chat',
          source: chat ? 'db' : this.env.LLM_API_KEY ? 'env' : 'fake',
        },
        embedding: {
          model: embedding?.model ?? this.env.EMBEDDING_MODEL,
          dim: embedding?.dim ?? this.env.EMBEDDING_DIM,
          source: embedding ? 'db' : this.env.EMBEDDING_API_KEY ? 'env' : 'fake',
        },
      },
    };
  }

  async update(input: SettingsUpdate): Promise<SettingsOverview> {
    await this.settings.upsertMany(
      Object.entries(input.settings).map(([key, value]) => ({ key, value })),
    );
    return this.overview();
  }

  async saveProvider(
    kind: Exclude<ProviderKind, 'rerank'>,
    input: ProviderSaveInput,
  ): Promise<SettingsOverview> {
    let apiKeyEncrypted: string | undefined;
    if (input.apiKey) {
      if (!this.env.APP_ENCRYPTION_KEY) {
        throw new ApiError('INVALID_ARGUMENT', '未配置 APP_ENCRYPTION_KEY，无法保存密钥');
      }
      apiKeyEncrypted = encryptSecret(input.apiKey, this.env.APP_ENCRYPTION_KEY);
    }

    await this.providers.saveActive({
      kind,
      provider: input.provider,
      model: input.model,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(apiKeyEncrypted ? { apiKeyEncrypted, apiKeyLast4: last4(input.apiKey!) } : {}),
      ...(kind === 'embedding' && input.dim ? { extra: { dim: input.dim } } : {}),
    });

    return this.overview();
  }

  async testConnection(input: TestConnectionInput) {
    const stored = await loadProviderSettings(this.prisma, this.env.APP_ENCRYPTION_KEY, input.kind);
    const apiKey =
      input.apiKey ??
      stored?.apiKey ??
      (input.kind === 'llm' ? this.env.LLM_API_KEY : this.env.EMBEDDING_API_KEY);

    if (!apiKey) {
      throw new ApiError('INVALID_ARGUMENT', '未配置 API Key');
    }

    const startedAt = Date.now();

    try {
      if (input.kind === 'llm') {
        const provider = new OpenAICompatibleChatProvider({
          baseUrl:
            input.baseUrl ??
            stored?.baseUrl ??
            this.env.LLM_BASE_URL ??
            'https://api.openai.com/v1',
          apiKey,
          model: input.model ?? stored?.model ?? this.env.LLM_MODEL ?? 'claude-sonnet-5-5',
        });
        await provider.complete([{ role: 'user', content: 'ping' }], { maxTokens: 8 });
      } else {
        const provider = new OpenAICompatibleEmbeddingProvider({
          baseUrl:
            input.baseUrl ??
            stored?.baseUrl ??
            this.env.EMBEDDING_BASE_URL ??
            'https://api.openai.com/v1',
          apiKey,
          model: input.model ?? stored?.model ?? this.env.EMBEDDING_MODEL,
          dim: input.dim ?? stored?.dim ?? this.env.EMBEDDING_DIM,
        });
        await provider.embed(['ping']);
      }

      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      const apiError = error instanceof ApiError ? error : undefined;
      return {
        ok: false,
        code: apiError?.code ?? 'PROVIDER_UNAVAILABLE',
        message: apiError?.message ?? '连接失败',
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}

import type { Env } from '@kos/shared';
import { FakeChatProvider } from './fake.js';
import { OpenAICompatibleChatProvider } from './openai.js';
import type { ChatProvider } from './types.js';

type ChatEnv = Pick<
  Env,
  'NODE_ENV' | 'LLM_PROVIDER' | 'LLM_BASE_URL' | 'LLM_API_KEY' | 'LLM_MODEL'
>;

export interface StoredChatSettings {
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export function createChatProvider(env: ChatEnv, stored?: StoredChatSettings | null): ChatProvider {
  if (stored?.apiKey) {
    return new OpenAICompatibleChatProvider({
      baseUrl: stored.baseUrl ?? env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey: stored.apiKey,
      model: stored.model,
    });
  }

  if (env.LLM_PROVIDER === 'fake' || !env.LLM_API_KEY) {
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER !== 'fake') {
      throw new Error('缺少 LLM_API_KEY，生产环境不能使用 Fake chat');
    }
    return new FakeChatProvider();
  }

  return new OpenAICompatibleChatProvider({
    baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL ?? 'claude-sonnet-5-5',
  });
}

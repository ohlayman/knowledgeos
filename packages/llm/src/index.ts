export { createChatProvider } from './config.js';
export { FakeChatProvider } from './fake.js';
export type { FakeChatOptions } from './fake.js';
export { OpenAICompatibleChatProvider } from './openai.js';
export type { OpenAIChatOptions } from './openai.js';
export { buildPrompt, DEFAULT_HISTORY_TOKEN_BUDGET, PROMPT_VERSION } from './prompt.js';
export type { BuildPromptInput, BuiltPrompt, PromptEvidence } from './prompt.js';
export type {
  ChatMessage,
  ChatProvider,
  ChatRole,
  ChatStreamOptions,
  TokenUsage,
} from './types.js';

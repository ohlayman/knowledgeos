export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChatStreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}

export interface ChatProvider {
  readonly model: string;
  stream(messages: ChatMessage[], options?: ChatStreamOptions): AsyncIterable<string>;
  complete(
    messages: ChatMessage[],
    options?: ChatStreamOptions,
  ): Promise<{ text: string; usage?: TokenUsage }>;
}

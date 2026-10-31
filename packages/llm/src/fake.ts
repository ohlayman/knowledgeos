import type { ChatMessage, ChatProvider, ChatStreamOptions } from './types.js';

export interface FakeChatOptions {
  reply?: (messages: ChatMessage[]) => string;
  chunkSize?: number;
}

export class FakeChatProvider implements ChatProvider {
  readonly model = 'fake-chat';

  constructor(private readonly options: FakeChatOptions = {}) {}

  async *stream(messages: ChatMessage[]): AsyncIterable<string> {
    const text = this.replyFor(messages);
    const size = this.options.chunkSize ?? 8;

    for (let index = 0; index < text.length; index += size) {
      yield text.slice(index, index + size);
    }
  }

  async complete(
    messages: ChatMessage[],
    _options?: ChatStreamOptions,
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    const text = this.replyFor(messages);

    return {
      text,
      usage: {
        inputTokens: messages.reduce((sum, message) => sum + message.content.length, 0),
        outputTokens: text.length,
      },
    };
  }

  private replyFor(messages: ChatMessage[]): string {
    if (this.options.reply) {
      return this.options.reply(messages);
    }

    const evidenceCount = (messages.at(-1)?.content.match(/^\[\d+\]/gm) ?? []).length;
    return evidenceCount > 0
      ? `根据证据，可以这样回答 [1]。共 ${evidenceCount} 条证据。`
      : '没有找到足够的相关内容。';
  }
}

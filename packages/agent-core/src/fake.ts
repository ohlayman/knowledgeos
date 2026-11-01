import type { AgentChatMessage, AgentChatModel } from './runtime.js';

/**
 * 无真实模型时的确定性 Agent：第一轮调用 search_knowledge，拿到结果后给出摘要。
 * 用于本地开发与验收，不模拟复杂推理。
 */
export class FakeAgentModel implements AgentChatModel {
  readonly model = 'fake-agent';

  async complete(messages: AgentChatMessage[]): Promise<{ text: string }> {
    const last = messages.at(-1);
    const userInput = messages.find((message) => message.role === 'user')?.content ?? '';

    if (last?.role === 'user' && last.content.startsWith('工具结果(')) {
      const preview = last.content.slice(0, 800);
      return {
        text: JSON.stringify({
          thought: '读取工具结果并总结',
          final: `根据知识库检索结果，可以确认：\n${preview}`,
        }),
      };
    }

    return {
      text: JSON.stringify({
        thought: '先检索知识库',
        action: {
          tool: 'search_knowledge',
          args: { query: userInput.slice(0, 200), topK: 5 },
        },
      }),
    };
  }
}

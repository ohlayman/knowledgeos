import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runAgent, type AgentChatModel } from './runtime.js';
import { ToolRegistry, type AgentTool } from './tools.js';

function scripted(...responses: string[]): AgentChatModel {
  let index = 0;
  return {
    model: 'scripted',
    async complete() {
      const response = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      return { text: response };
    },
  };
}

const searchTool: AgentTool = {
  name: 'search_knowledge',
  description: '检索知识库',
  paramsHint: '{ query: string, topK?: number }',
  params: z.object({ query: z.string().min(1), topK: z.number().int().max(20).optional() }),
  kind: 'read',
  execute: async (args: { query: string }) => ({ summary: `找到 ${args.query} 的结果` }),
};

const failingTool: AgentTool = {
  name: 'get_chunk',
  description: '取块',
  paramsHint: '{ chunkId: uuid }',
  params: z.object({ chunkId: z.string().uuid() }),
  kind: 'read',
  execute: async () => {
    throw new Error('块不存在');
  },
};

const proposeTool: AgentTool = {
  name: 'propose_wiki_update',
  description: '生成提案',
  paramsHint: '{ title: string }',
  params: z.object({ title: z.string() }),
  kind: 'proposal',
  execute: async () => ({ summary: '已生成提案' }),
};

const baseInput = {
  input: '对比两个方案',
  systemPrompt: '你是助理',
  maxSteps: 4,
  tokenBudget: 10_000,
  toolCallBudget: 8,
  allowlist: ['search_knowledge', 'get_chunk', 'propose_wiki_update'],
  allowProposal: false,
};

describe('runAgent', () => {
  it('直接输出最终回答', async () => {
    const result = await runAgent(baseInput, {
      model: scripted('{"thought":"直接回答","final":"答案"}'),
      registry: new ToolRegistry([searchTool]),
    });

    expect(result.status).toBe('succeeded');
    expect(result.terminationReason).toBe('final_answer');
    expect(result.output).toBe('答案');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('output');
  });

  it('执行工具后生成最终回答', async () => {
    const execute = vi.spyOn(searchTool, 'execute');
    const result = await runAgent(baseInput, {
      model: scripted(
        '{"thought":"先检索","action":{"tool":"search_knowledge","args":{"query":"RAG"}}}',
        '{"thought":"完成","final":"检索结果"}',
      ),
      registry: new ToolRegistry([searchTool]),
    });

    expect(result.status).toBe('succeeded');
    expect(result.totalSteps).toBe(2);
    expect(result.events[0]?.tool?.status).toBe('succeeded');
    expect(result.events[0]?.tool?.paramsRedacted).toEqual({ query: 'RAG' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('达到步数上限即终止且不产生额外步骤', async () => {
    const action = '{"thought":"继续","action":{"tool":"search_knowledge","args":{"query":"x"}}}';
    const result = await runAgent(
      { ...baseInput, maxSteps: 2 },
      { model: scripted(action), registry: new ToolRegistry([searchTool]) },
    );

    expect(result.status).toBe('failed');
    expect(result.terminationReason).toBe('step_limit');
    expect(result.totalSteps).toBe(2);
    expect(result.events.map((event) => event.stepIndex)).toEqual([1, 2]);
    expect(result.output).toContain('第 2 步');
  });

  it('参数非法时返回结构化错误并允许模型修正', async () => {
    const result = await runAgent(baseInput, {
      model: scripted(
        '{"thought":"试一下","action":{"tool":"search_knowledge","args":{"query":123}}}',
        '{"thought":"修正参数","action":{"tool":"search_knowledge","args":{"query":"RAG"}}}',
        '{"thought":"完成","final":"好"}',
      ),
      registry: new ToolRegistry([searchTool]),
    });

    expect(result.status).toBe('succeeded');
    expect(result.events[0]?.tool?.status).toBe('failed');
    expect(result.events[0]?.tool?.errorCode).toBe('INVALID_ARGS');
    expect(result.events[1]?.tool?.status).toBe('succeeded');
  });

  it('未授权工具不会执行', async () => {
    const execute = vi.fn();
    const writeTool: AgentTool = {
      name: 'write_file',
      description: '写入',
      paramsHint: '{}',
      params: z.object({}),
      kind: 'read',
      execute,
    };

    const result = await runAgent(baseInput, {
      model: scripted(
        '{"thought":"越权","action":{"tool":"write_file","args":{}}}',
        '{"thought":"完成","final":"没有执行"}',
      ),
      registry: new ToolRegistry([searchTool, writeTool]),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.events[0]?.tool?.errorCode).toBe('TOOL_NOT_ALLOWED');
    expect(result.status).toBe('succeeded');
  });

  it('提案工具默认关闭', async () => {
    const execute = vi.spyOn(proposeTool, 'execute');
    const result = await runAgent(baseInput, {
      model: scripted(
        '{"thought":"写提案","action":{"tool":"propose_wiki_update","args":{"title":"x"}}}',
        '{"thought":"完成","final":"结束"}',
      ),
      registry: new ToolRegistry([proposeTool]),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.events[0]?.tool?.errorCode).toBe('TOOL_NOT_ALLOWED');
  });

  it('同一工具连续三次失败后终止', async () => {
    const action =
      '{"thought":"再试","action":{"tool":"get_chunk","args":{"chunkId":"11111111-1111-4111-8111-111111111111"}}}';
    const result = await runAgent(
      { ...baseInput, maxSteps: 8 },
      { model: scripted(action), registry: new ToolRegistry([failingTool]) },
    );

    expect(result.status).toBe('failed');
    expect(result.terminationReason).toBe('tool_failures');
    expect(result.totalSteps).toBe(3);
  });

  it('预算耗尽时终止', async () => {
    const result = await runAgent(
      { ...baseInput, maxSteps: 5, tokenBudget: 1 },
      {
        model: scripted(
          '{"thought":"检索一个非常长的说明文本","action":{"tool":"search_knowledge","args":{"query":"RAG"}}}',
        ),
        registry: new ToolRegistry([searchTool]),
      },
    );

    expect(result.status).toBe('failed');
    expect(result.terminationReason).toBe('budget_exhausted');
  });

  it('取消信号终止执行', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent(
      { ...baseInput, maxSteps: 5 },
      {
        model: scripted('{"final":"不应执行"}'),
        registry: new ToolRegistry([]),
        signal: controller.signal,
      },
    );

    expect(result.status).toBe('canceled');
    expect(result.terminationReason).toBe('canceled');
  });
});

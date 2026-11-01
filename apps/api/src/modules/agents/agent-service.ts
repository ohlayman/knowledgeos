import type { AgentRepository, PrismaClient, WikiRepository } from '@kos/database';
import type { ChatProvider } from '@kos/llm';
import type { GraphService } from '@kos/graph';
import type { RetrievalService } from '@kos/retrieval';
import { ApiError } from '@kos/shared';
import {
  FakeAgentModel,
  runAgent,
  ToolRegistry,
  type AgentChatModel,
  type AgentTool,
} from '@kos/agent-core';
import { createAgentTools } from './tools.js';

const MAX_RUNTIME_MS = 120_000;
const MAX_CONCURRENT = 2;
const DEFAULT_DAILY_BUDGET = 200_000;

export class AgentService {
  private readonly registry: ToolRegistry;
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly agents: AgentRepository,
    private readonly chatProvider: () => Promise<ChatProvider>,
    private readonly tools: AgentTool[],
  ) {
    this.registry = new ToolRegistry(tools);
  }

  listTools() {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      kind: tool.kind,
      paramsHint: tool.paramsHint,
    }));
  }

  async listAgents() {
    const agents = await this.agents.listAgents();
    return Promise.all(
      agents.map(async (agent) => ({
        ...agent,
        monthTokens: await this.agents.usageThisMonth(agent.id),
      })),
    );
  }

  async createAgent(input: Parameters<AgentRepository['createAgent']>[0]) {
    return this.agents.createAgent(input);
  }

  async updateAgent(id: string, input: Parameters<AgentRepository['updateAgent']>[1]) {
    await this.requireAgent(id);
    return this.agents.updateAgent(id, input);
  }

  async getAgent(id: string) {
    const agent = await this.agents.getAgent(id);
    if (!agent) {
      throw new ApiError('NOT_FOUND', 'Agent 不存在');
    }
    return {
      ...agent,
      monthTokens: await this.agents.usageThisMonth(id),
      medianTokens: await this.agents.medianRecentTokens(id),
    };
  }

  async archiveAgent(id: string) {
    await this.requireAgent(id);
    return this.agents.archiveAgent(id);
  }

  async usage() {
    const used = await this.agents.usageToday();
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: 'agent.dailyTokenBudget' },
    });
    const budget = typeof setting?.value === 'number' ? setting.value : DEFAULT_DAILY_BUDGET;
    return { ...used, budget, remaining: Math.max(0, budget - used.tokens) };
  }

  async estimate(id: string) {
    await this.requireAgent(id);
    const median = await this.agents.medianRecentTokens(id);
    return {
      medianTokens: median,
      estimatedTokens: median ? Math.round(median * 1.2) : 8000,
    };
  }

  async trigger(id: string, input: string) {
    const agent = await this.requireAgent(id);
    if (agent.status !== 'active') {
      throw new ApiError('INVALID_ARGUMENT', 'Agent 已归档');
    }
    const running = await this.agents.countRunning();
    if (running >= MAX_CONCURRENT) {
      throw new ApiError('RATE_LIMITED', '同时最多 2 个 Agent 执行，请稍后再试');
    }

    const usage = await this.usage();
    if (usage.tokens >= usage.budget) {
      throw new ApiError('QUOTA_EXCEEDED', '今日 Agent 额度已用完，明日 00:00 恢复');
    }

    const version = agent.versions[0];
    if (!version) {
      throw new ApiError('INVALID_ARGUMENT', 'Agent 还没有可用版本');
    }

    const run = await this.agents.createRun({
      agentId: agent.id,
      agentVersionId: version.id,
      trigger: 'manual',
      input: { message: input },
    });

    void this.execute(run.id);
    return run;
  }

  async cancelRun(id: string) {
    const run = await this.agents.getRun(id);
    if (!run) {
      throw new ApiError('NOT_FOUND', '执行记录不存在');
    }
    if (run.status !== 'queued' && run.status !== 'running') {
      return run;
    }
    this.controllers.get(id)?.abort();
    return this.agents.cancelRun(id);
  }

  async deleteRun(id: string) {
    const run = await this.agents.getRun(id);
    if (!run) {
      throw new ApiError('NOT_FOUND', '执行记录不存在');
    }
    if (run.status === 'running' || run.status === 'queued') {
      throw new ApiError('INVALID_ARGUMENT', '执行中的记录不能删除');
    }
    await this.agents.deleteRun(id);
  }

  private async execute(runId: string): Promise<void> {
    const run = await this.agents.getRun(runId);
    if (!run) {
      return;
    }
    const version = run.agentVersion;
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const startedAt = Date.now();

    await this.agents.markRunRunning(runId);

    try {
      const chat = await this.chatProvider();
      const model: AgentChatModel =
        chat.model === 'fake-chat'
          ? new FakeAgentModel()
          : {
              model: chat.model,
              complete: async (messages) => ({
                text: (await chat.complete(messages)).text,
              }),
            };

      const result = await runAgent(
        {
          input:
            typeof (run.input as { message?: unknown }).message === 'string'
              ? String((run.input as { message: string }).message)
              : JSON.stringify(run.input),
          systemPrompt: version.systemPrompt,
          maxSteps: Math.min(version.maxSteps, 12),
          tokenBudget: version.tokenBudget,
          toolCallBudget: version.toolCallBudget,
          allowlist: version.toolAllowlist,
          allowProposal: version.allowProposal,
        },
        {
          model,
          registry: this.registry,
          deadlineMs: startedAt + MAX_RUNTIME_MS,
          signal: controller.signal,
        },
      );

      for (const event of result.events) {
        await this.agents.appendStep(runId, {
          stepIndex: event.stepIndex,
          type: event.type,
          outputSummary: event.outputSummary,
          durationMs: event.durationMs,
        });
        if (event.tool) {
          await this.agents.appendToolCall(runId, {
            stepIndex: event.stepIndex,
            toolName: event.tool.name,
            paramsRedacted: event.tool.paramsRedacted as never,
            resultSummary: event.tool.resultSummary,
            status: event.tool.status,
            durationMs: event.tool.durationMs,
            errorCode: event.tool.errorCode ?? null,
          });
        }
      }

      await this.agents.finishRun(runId, {
        status:
          result.status === 'succeeded'
            ? 'succeeded'
            : result.status === 'canceled'
              ? 'canceled'
              : 'failed',
        totalSteps: result.totalSteps,
        totalTokens: result.totalTokens,
        durationMs: Date.now() - startedAt,
        terminationReason: result.terminationReason,
      });
    } catch (error) {
      console.error('agent run failed', runId, error);
      await this.agents.finishRun(runId, {
        status: 'failed',
        totalSteps: 0,
        totalTokens: 0,
        durationMs: Date.now() - startedAt,
        terminationReason: 'runtime_error',
      });
    } finally {
      this.controllers.delete(runId);
    }
  }

  private async requireAgent(id: string) {
    const agent = await this.agents.getAgent(id);
    if (!agent) {
      throw new ApiError('NOT_FOUND', 'Agent 不存在');
    }
    return agent;
  }
}

export function createAgentService(input: {
  prisma: PrismaClient;
  agents: AgentRepository;
  wiki: WikiRepository;
  retrieval: RetrievalService;
  graph: GraphService;
  chatProvider: () => Promise<ChatProvider>;
}): AgentService {
  const tools = createAgentTools({
    prisma: input.prisma,
    retrieval: input.retrieval,
    wiki: input.wiki,
    graph: input.graph,
  });
  return new AgentService(input.prisma, input.agents, input.chatProvider, tools);
}

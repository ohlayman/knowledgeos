import { randomUUID } from 'node:crypto';
import type {
  AgentStatus,
  Prisma,
  PrismaClient,
  RunStatus,
  RunStepType,
  ToolCallStatus,
} from '@prisma/client';

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  toolAllowlist?: string[];
  maxSteps?: number;
  tokenBudget?: number;
  toolCallBudget?: number;
  allowProposal?: boolean;
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  archive?: boolean;
}

export interface CreateRunInput {
  agentId: string;
  agentVersionId: string;
  trigger: string;
  input: Prisma.InputJsonValue;
}

export interface FinishRunInput {
  status: RunStatus;
  totalSteps: number;
  totalTokens: number;
  durationMs: number;
  terminationReason: string;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export class AgentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createAgent(input: CreateAgentInput) {
    const agentId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.agent.create({
        data: {
          id: agentId,
          name: input.name,
          description: input.description ?? null,
        },
      });
      await tx.agentVersion.create({
        data: {
          id: randomUUID(),
          agentId,
          versionNo: 1,
          systemPrompt: input.systemPrompt,
          model: input.model ?? 'fake-chat',
          temperature: input.temperature ?? 0.2,
          toolAllowlist: input.toolAllowlist ?? ['search_knowledge', 'get_chunk'],
          maxSteps: input.maxSteps ?? 8,
          tokenBudget: input.tokenBudget ?? 20000,
          toolCallBudget: input.toolCallBudget ?? 12,
          allowProposal: input.allowProposal ?? false,
        },
      });
      return tx.agent.findUniqueOrThrow({
        where: { id: agentId },
        include: { versions: { orderBy: { versionNo: 'desc' } } },
      });
    });
  }

  async updateAgent(id: string, input: UpdateAgentInput) {
    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findUniqueOrThrow({
        where: { id },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
      });
      const latest = agent.versions[0];

      await tx.agent.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.archive ? { status: 'archived' as AgentStatus } : {}),
        },
      });

      if (latest) {
        await tx.agentVersion.create({
          data: {
            id: randomUUID(),
            agentId: id,
            versionNo: latest.versionNo + 1,
            systemPrompt: input.systemPrompt ?? latest.systemPrompt,
            model: input.model ?? latest.model,
            temperature: input.temperature ?? latest.temperature,
            toolAllowlist: input.toolAllowlist ?? latest.toolAllowlist,
            maxSteps: input.maxSteps ?? latest.maxSteps,
            tokenBudget: input.tokenBudget ?? latest.tokenBudget,
            toolCallBudget: input.toolCallBudget ?? latest.toolCallBudget,
            allowProposal: input.allowProposal ?? latest.allowProposal,
          },
        });
      }

      return tx.agent.findUniqueOrThrow({
        where: { id },
        include: { versions: { orderBy: { versionNo: 'desc' } } },
      });
    });
  }

  async archiveAgent(id: string) {
    return this.prisma.agent.update({ where: { id }, data: { status: 'archived' } });
  }

  async getAgent(id: string) {
    return this.prisma.agent.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { versionNo: 'desc' } },
        runs: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
  }

  async listAgents() {
    return this.prisma.agent.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: { orderBy: { versionNo: 'desc' }, take: 1 },
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async createRun(input: CreateRunInput) {
    return this.prisma.agentRun.create({
      data: {
        id: randomUUID(),
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        trigger: input.trigger,
        input: input.input,
      },
    });
  }

  async markRunRunning(id: string) {
    return this.prisma.agentRun.update({
      where: { id },
      data: { status: 'running' },
    });
  }

  async appendStep(
    runId: string,
    input: {
      stepIndex: number;
      type: RunStepType;
      outputSummary: string;
      durationMs: number;
    },
  ) {
    return this.prisma.runStep.create({
      data: {
        id: randomUUID(),
        runId,
        stepIndex: input.stepIndex,
        type: input.type,
        outputSummary: input.outputSummary,
        durationMs: input.durationMs,
      },
    });
  }

  async appendToolCall(
    runId: string,
    input: {
      stepIndex: number;
      toolName: string;
      paramsRedacted: Prisma.InputJsonValue;
      resultSummary: string | null;
      status: ToolCallStatus;
      durationMs: number;
      errorCode?: string | null;
    },
  ) {
    return this.prisma.toolCall.create({
      data: {
        id: randomUUID(),
        runId,
        stepIndex: input.stepIndex,
        toolName: input.toolName,
        paramsRedacted: input.paramsRedacted,
        resultSummary: input.resultSummary,
        status: input.status,
        durationMs: input.durationMs,
        errorCode: input.errorCode ?? null,
      },
    });
  }

  async finishRun(id: string, input: FinishRunInput) {
    return this.prisma.agentRun.update({
      where: { id },
      data: {
        status: input.status,
        totalSteps: input.totalSteps,
        totalTokens: input.totalTokens,
        durationMs: input.durationMs,
        terminationReason: input.terminationReason,
        finishedAt: new Date(),
      },
    });
  }

  async getRun(id: string) {
    return this.prisma.agentRun.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepIndex: 'asc' } },
        toolCalls: { orderBy: { stepIndex: 'asc' } },
        agent: true,
        agentVersion: true,
      },
    });
  }

  async listRuns(filter: { agentId?: string; limit?: number } = {}) {
    return this.prisma.agentRun.findMany({
      where: filter.agentId ? { agentId: filter.agentId } : {},
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
  }

  async deleteRun(id: string) {
    await this.prisma.agentRun.delete({ where: { id } });
  }

  async cancelRun(id: string) {
    return this.prisma.agentRun.update({
      where: { id },
      data: {
        status: 'canceled',
        terminationReason: 'canceled',
        finishedAt: new Date(),
      },
    });
  }

  async countRunning(agentId?: string) {
    return this.prisma.agentRun.count({
      where: { status: 'running', ...(agentId ? { agentId } : {}) },
    });
  }

  async usageToday() {
    const rows = await this.prisma.agentRun.aggregate({
      where: { createdAt: { gte: startOfToday() } },
      _count: { id: true },
      _sum: { totalTokens: true },
    });
    return { runs: rows._count.id, tokens: rows._sum.totalTokens ?? 0 };
  }

  async usageThisMonth(agentId: string) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = await this.prisma.agentRun.aggregate({
      where: { agentId, createdAt: { gte: start } },
      _sum: { totalTokens: true },
    });
    return rows._sum.totalTokens ?? 0;
  }

  async medianRecentTokens(agentId: string, limit = 10) {
    const rows = await this.prisma.agentRun.findMany({
      where: { agentId, totalTokens: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { totalTokens: true },
    });
    if (rows.length === 0) {
      return null;
    }
    const sorted = rows.map((row) => row.totalTokens).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }
}

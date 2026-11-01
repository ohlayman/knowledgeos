import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentRepository } from './repositories/agent.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const prisma = new PrismaClient();
const repo = new AgentRepository(prisma);
const suffix = randomUUID().slice(0, 8);
const agentIds: string[] = [];

describe.skipIf(!enabled)('AgentRepository', () => {
  afterAll(async () => {
    if (agentIds.length > 0) {
      await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    }
    await prisma.$disconnect();
  });

  it('creates agents with versions and bumps versions on config change', async () => {
    const agent = await repo.createAgent({
      name: `agent-${suffix}`,
      description: '测试 Agent',
      systemPrompt: '你是测试助手',
      model: 'fake-chat',
      toolAllowlist: ['search_knowledge'],
      maxSteps: 8,
      tokenBudget: 20000,
      toolCallBudget: 12,
      allowProposal: false,
    });
    agentIds.push(agent.id);

    expect(agent.versions).toHaveLength(1);
    expect(agent.versions[0]?.versionNo).toBe(1);

    const updated = await repo.updateAgent(agent.id, {
      systemPrompt: '更新后的提示词',
      toolAllowlist: ['search_knowledge', 'get_chunk'],
    });
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0]?.versionNo).toBe(2);
    expect(updated.versions[0]?.toolAllowlist).toEqual(['search_knowledge', 'get_chunk']);
    expect(updated.versions[1]?.versionNo).toBe(1);

    const archived = await repo.archiveAgent(agent.id);
    expect(archived.status).toBe('archived');
  });

  it('records runs with steps, tool calls and usage; deletion keeps stats correct', async () => {
    const agent = await repo.createAgent({
      name: `run-agent-${suffix}`,
      systemPrompt: '执行',
      model: 'fake-chat',
      toolAllowlist: [],
    });
    agentIds.push(agent.id);
    const version = agent.versions[0]!;

    const run = await repo.createRun({
      agentId: agent.id,
      agentVersionId: version.id,
      trigger: 'manual',
      input: { message: '测试输入' },
    });

    await repo.appendStep(run.id, {
      stepIndex: 1,
      type: 'thought',
      outputSummary: '思考',
      durationMs: 10,
    });
    await repo.appendToolCall(run.id, {
      stepIndex: 1,
      toolName: 'search_knowledge',
      paramsRedacted: { query: 'RAG' },
      resultSummary: '一条结果',
      status: 'succeeded',
      durationMs: 20,
    });
    await repo.appendStep(run.id, {
      stepIndex: 2,
      type: 'output',
      outputSummary: '最终答案',
      durationMs: 5,
    });
    await repo.finishRun(run.id, {
      status: 'succeeded',
      totalSteps: 2,
      totalTokens: 1234,
      durationMs: 60,
      terminationReason: 'final_answer',
    });

    const detail = await repo.getRun(run.id);
    expect(detail?.steps).toHaveLength(2);
    expect(detail?.toolCalls).toHaveLength(1);
    expect(detail?.totalTokens).toBe(1234);

    const before = await repo.usageToday();
    expect(before.runs).toBeGreaterThanOrEqual(1);
    expect(before.tokens).toBeGreaterThanOrEqual(1234);

    await repo.deleteRun(run.id);
    const after = await repo.usageToday();
    expect(after.runs).toBe(before.runs - 1);
    expect(after.tokens).toBe(before.tokens - 1234);
    expect(await repo.getRun(run.id)).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import {
  ChunkRepository,
  ConversationRepository,
  createPrismaClient,
  DocumentRepository,
} from '@kos/database';
import { FakeChatProvider, type ChatMessage, type ChatProvider } from '@kos/llm';
import type { RetrievalResult, RetrievalService } from '@kos/retrieval';
import { buildSearchText } from '@kos/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ConversationService,
  type AnswerSink,
  type CitationPayload,
} from './conversation-service.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const prisma = createPrismaClient(process.env.DATABASE_URL);
const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const conversations = new ConversationRepository(prisma);

const title = `conv-${randomUUID().slice(0, 8)}`;
const conversationIds: string[] = [];

let documentId = '';
let versionId = '';
let chunkId = '';
let chunkText = '';

function recorder(): { sink: AnswerSink; events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  const push = (event: string) => (data: unknown) => events.push({ event, data });

  return {
    events,
    sink: {
      meta: push('meta'),
      status: push('status'),
      retrieval: push('retrieval'),
      delta: (text) => events.push({ event: 'delta', data: text }),
      citations: push('citations'),
      done: push('done'),
      error: push('error'),
    },
  };
}

function retrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    evidence: [
      {
        chunkId,
        documentId,
        versionId,
        text: chunkText,
        score: 0.9,
        headingPath: ['测试'],
      },
    ],
    noEvidence: false,
    trace: {
      rewrittenQuery: 'q',
      questionType: 'fact',
      entities: [],
      keywordHints: [],
      vectorHits: 1,
      keywordHits: 1,
      fusedCount: 1,
      reranked: false,
      degraded: [],
      durationMs: 1,
      timings: {},
    },
    ...overrides,
  };
}

async function createService(chat: ChatProvider, retrieval: Partial<RetrievalService> = {}) {
  const service = new ConversationService(
    prisma,
    conversations,
    chunks,
    {
      retrieve: vi.fn().mockResolvedValue(retrievalResult()),
      ...retrieval,
    } as unknown as RetrievalService,
    async () => chat,
  );
  const conversation = await service.create({ title });
  conversationIds.push(conversation.id);
  return { service, conversationId: conversation.id };
}

describe.skipIf(!enabled)('ConversationService', () => {
  beforeAll(async () => {
    chunkText = '混合检索同时使用向量召回与关键词召回。';
    const created = await documents.createWithVersion({
      title,
      source: { type: 'file', fingerprint: title, identifier: title },
      version: {
        contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        normalizedText: chunkText,
        charCount: chunkText.length,
      },
    });
    documentId = created.documentId;
    versionId = created.versionId;
    await documents.updateVersionStatus(versionId, 'ready');

    await chunks.replaceForVersion(documentId, versionId, [
      {
        chunkIndex: 0,
        text: chunkText,
        tokenCount: 12,
        startOffset: 0,
        endOffset: chunkText.length,
        headingPath: ['测试'],
        searchText: buildSearchText(chunkText),
      },
    ]);
    chunkId = (await chunks.listByVersion(versionId))[0]!.id;
  });

  afterAll(async () => {
    if (conversationIds.length > 0) {
      await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    }
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.source.deleteMany({ where: { fingerprint: title } });
    await prisma.$disconnect();
  });

  it('streams an answer and validates citations', async () => {
    const chatCalls: ChatMessage[][] = [];
    const chat = new FakeChatProvider({
      reply: (messages) => {
        chatCalls.push(messages);
        return '混合检索同时使用两路召回 [1]。';
      },
    });
    const { service, conversationId } = await createService(chat);
    const { sink, events } = recorder();

    await service.answer(conversationId, { content: '混合检索用了什么？' }, sink);

    const done = events.find((event) => event.event === 'done');
    expect(done?.data).toMatchObject({ status: 'complete' });

    const citationEvent = events.find((event) => event.event === 'citations');
    const citations = (citationEvent?.data as { citations: CitationPayload[] }).citations;
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ ordinal: 1, chunkId, valid: true });

    const detail = await conversations.getById(conversationId);
    expect(detail?.title).toBe(title);
    const assistant = detail?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.status).toBe('complete');
    expect(assistant?.content).toContain('[1]');
    expect(assistant?.citationCheck).toMatchObject({ status: 'ok', checked: 1 });
    expect(assistant?.citations[0]).toMatchObject({ ordinal: 1, isValid: true });

    expect(chatCalls[0]?.[0]?.role).toBe('system');
    expect(chatCalls[0]?.at(-1)?.content).toContain('混合检索用了什么？');
  });

  it('flags out-of-range citations as failed', async () => {
    const chat = new FakeChatProvider({ reply: () => '没有依据的回答 [9]。' });
    const { service, conversationId } = await createService(chat);
    const { sink, events } = recorder();

    await service.answer(conversationId, { content: '任意问题' }, sink);

    const detail = await conversations.getById(conversationId);
    const assistant = detail?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.citationCheck).toMatchObject({ status: 'failed', outOfRange: [9] });
    expect(assistant?.citations).toHaveLength(0);
    expect(events.some((event) => event.event === 'done')).toBe(true);
  });

  it('returns a fixed no-evidence answer without calling the model', async () => {
    const chat = new FakeChatProvider({ reply: () => '不应被调用' });
    const { service, conversationId } = await createService(chat, {
      retrieve: vi.fn().mockResolvedValue(retrievalResult({ evidence: [], noEvidence: true })),
    });
    const { sink, events } = recorder();

    await service.answer(conversationId, { content: '空库问题' }, sink);

    const done = events.find((event) => event.event === 'done');
    expect(done?.data).toMatchObject({ status: 'no_evidence' });

    const detail = await conversations.getById(conversationId);
    const assistant = detail?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toContain('没有找到足够的相关内容');
    expect(assistant?.content).not.toContain('不应被调用');
  });

  it('includes prior rounds as history for follow-up questions', async () => {
    const chatCalls: ChatMessage[][] = [];
    const chat = new FakeChatProvider({
      reply: (messages) => {
        chatCalls.push(messages);
        return '回答 [1]。';
      },
    });
    const { service, conversationId } = await createService(chat);
    const first = recorder();
    await service.answer(conversationId, { content: '第一个问题' }, first.sink);
    const second = recorder();
    await service.answer(conversationId, { content: '第二个问题' }, second.sink);

    const secondCall = chatCalls[1] ?? [];
    expect(secondCall.some((message) => message.content === '第一个问题')).toBe(true);
    expect(secondCall.some((message) => message.content.includes('回答 [1]'))).toBe(true);
  });

  it('stores feedback with a snapshot', async () => {
    const chat = new FakeChatProvider({ reply: () => '回答 [1]。' });
    const { service, conversationId } = await createService(chat);
    const { sink } = recorder();
    await service.answer(conversationId, { content: '反馈问题' }, sink);

    const detail = await conversations.getById(conversationId);
    const assistant = detail?.messages.find((message) => message.role === 'assistant');
    if (!assistant) {
      throw new Error('assistant message missing');
    }

    const feedback = await service.feedback(assistant.id, {
      type: 'citation_wrong',
      citationOrdinal: 1,
    });

    expect(feedback.type).toBe('citation_wrong');
    expect(feedback.citationOrdinal).toBe(1);
    expect(feedback.snapshot).toMatchObject({ citations: [{ ordinal: 1 }] });
  });
  it('names a new conversation from the first question', async () => {
    const chat = new FakeChatProvider({ reply: () => '回答 [1]。' });
    const service = new ConversationService(
      prisma,
      conversations,
      chunks,
      { retrieve: vi.fn().mockResolvedValue(retrievalResult()) } as unknown as RetrievalService,
      async () => chat,
    );
    const conversation = await service.create({});
    conversationIds.push(conversation.id);

    const { sink } = recorder();
    await service.answer(conversation.id, { content: '标题来自首轮问题' }, sink);

    const detail = await conversations.getById(conversation.id);
    expect(detail?.title).toBe('标题来自首轮问题');
  });
  it('saves partial content when the client stops', async () => {
    const slow: ChatProvider = {
      model: 'slow-chat',
      async *stream(_messages, options) {
        yield '部分回答';
        if (options?.signal?.aborted) {
          throw new Error('aborted');
        }
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
      async complete() {
        return { text: '' };
      },
    };
    const { service, conversationId } = await createService(slow);
    const controller = new AbortController();
    const events: Array<{ event: string; data: unknown }> = [];
    const base = recorder();
    const sink: AnswerSink = {
      ...base.sink,
      delta: (text) => {
        base.sink.delta(text);
        controller.abort();
      },
    };

    await service.answer(conversationId, { content: '停止生成' }, sink, controller.signal);

    const done = base.events.find((event) => event.event === 'done');
    expect(done?.data).toMatchObject({ status: 'stopped' });

    const detail = await conversations.getById(conversationId);
    const assistant = detail?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.status).toBe('stopped');
    expect(assistant?.content).toBe('部分回答');
    void events;
  });
});

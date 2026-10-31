import type { ChunkRepository, ConversationRepository, PrismaClient, Prisma } from '@kos/database';
import { buildPrompt, type ChatMessage, type ChatProvider } from '@kos/llm';
import type { RetrievalResult, RetrievalService } from '@kos/retrieval';
import {
  ApiError,
  uniqueCitationOrdinals,
  type FeedbackInput,
  type SendMessageInput,
} from '@kos/shared';

export interface AnswerSink {
  meta(payload: { conversationId: string; messageId: string }): void;
  status(payload: { phase: string; scannedDocuments?: number }): void;
  retrieval(payload: {
    traceId?: string;
    vectorCount: number;
    keywordCount: number;
    finalChunkIds: string[];
    degraded: string[];
  }): void;
  delta(text: string): void;
  citations(payload: { citations: CitationPayload[] }): void;
  done(payload: {
    status: 'complete' | 'no_evidence' | 'stopped';
    usage?: Record<string, unknown>;
  }): void;
  error(payload: { code: string; message: string; retryable: boolean }): void;
}

export interface CitationPayload {
  ordinal: number;
  chunkId: string;
  documentId: string;
  versionId: string;
  quote: string;
  valid: boolean;
  validationError?: string;
}

const NO_EVIDENCE_TEXT =
  '没有找到足够的相关内容。可以换用更具体的关键词、扩大检索范围，或先导入相关材料。';
const HISTORY_MESSAGES = 10;

function errorPayload(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: 'INTERNAL', message: '服务内部错误', retryable: true };
}

export class ConversationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly conversations: ConversationRepository,
    private readonly chunks: ChunkRepository,
    private readonly retrieval: RetrievalService,
    private readonly chatProvider: () => Promise<ChatProvider>,
  ) {}

  async list() {
    return this.conversations.list();
  }

  async create(input: { title?: string }) {
    return this.conversations.create(input.title ?? '新会话');
  }

  async get(id: string) {
    const conversation = await this.conversations.getById(id);
    if (!conversation || conversation.deletedAt) {
      throw new ApiError('NOT_FOUND', '会话不存在');
    }
    return conversation;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.conversations.softDelete(id);
  }

  async getMessage(id: string) {
    const message = await this.conversations.getMessage(id);
    if (!message) {
      throw new ApiError('NOT_FOUND', '消息不存在');
    }
    return message;
  }

  async feedback(messageId: string, input: FeedbackInput) {
    const message = await this.getMessage(messageId);
    const snapshot = {
      model: message.model,
      promptVersion: message.promptVersion,
      tokenUsage: message.tokenUsage,
      citationCheck: message.citationCheck,
      citations: message.citations.map((citation) => ({
        ordinal: citation.ordinal,
        chunkId: citation.chunkId,
        isValid: citation.isValid,
      })),
    };

    return this.conversations.addFeedback({
      messageId,
      type: input.type,
      ...(input.citationOrdinal === undefined ? {} : { citationOrdinal: input.citationOrdinal }),
      ...(input.comment ? { comment: input.comment } : {}),
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    });
  }

  async answer(
    conversationId: string,
    input: SendMessageInput,
    sink: AnswerSink,
    signal?: AbortSignal,
  ): Promise<void> {
    const chat = await this.chatProvider();
    const conversation = await this.get(conversationId);

    const history: ChatMessage[] = conversation.messages
      .filter((message) => message.status === 'complete' && message.content.length > 0)
      .slice(-HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }));

    await this.conversations.createMessage(conversationId, {
      role: 'user',
      content: input.content,
      status: 'complete',
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    });

    if (conversation.messages.length === 0 && conversation.title === '新会话') {
      await this.conversations.updateTitle(conversationId, input.content.slice(0, 40));
    }

    const assistant = await this.conversations.createMessage(conversationId, {
      role: 'assistant',
      content: '',
      status: 'streaming',
      model: chat.model,
    });

    sink.meta({ conversationId, messageId: assistant.id });
    sink.status({ phase: 'retrieving' });

    let retrieval: RetrievalResult;
    try {
      retrieval = await this.retrieval.retrieve(input.content, {
        ...(input.scope?.documentIds ? { documentIds: input.scope.documentIds } : {}),
        ...(input.scope?.tags ? { tags: input.scope.tags } : {}),
        ...(input.scope?.includeHistoryVersions === undefined
          ? {}
          : { includeHistoryVersions: input.scope.includeHistoryVersions }),
      });
    } catch (error) {
      await this.failMessage(assistant.id, '', error);
      sink.error(errorPayload(error));
      return;
    }

    sink.retrieval({
      ...(retrieval.runId ? { traceId: retrieval.runId } : {}),
      vectorCount: retrieval.trace.vectorHits,
      keywordCount: retrieval.trace.keywordHits,
      finalChunkIds: retrieval.evidence.map((item) => item.chunkId),
      degraded: retrieval.trace.degraded,
    });

    if (retrieval.runId) {
      await this.prisma.retrievalRun
        .update({ where: { id: retrieval.runId }, data: { messageId: assistant.id } })
        .catch(() => undefined);
    }

    if (retrieval.noEvidence) {
      sink.delta(NO_EVIDENCE_TEXT);
      await this.conversations.updateMessage(assistant.id, {
        content: NO_EVIDENCE_TEXT,
        status: 'complete',
        citationCheck: {
          status: 'ok',
          checked: 0,
          invalid: [],
        } as unknown as Prisma.InputJsonValue,
      });
      sink.done({ status: 'no_evidence' });
      return;
    }

    const prompt = buildPrompt({
      question: input.content,
      history,
      evidence: retrieval.evidence.map((item, index) => ({
        ordinal: index + 1,
        chunkId: item.chunkId,
        documentTitle: item.sourcePath ?? item.documentId,
        text: item.text,
        ...(item.page === undefined ? {} : { page: item.page }),
        headingPath: item.headingPath,
      })),
    });

    let content = '';
    let usage: Record<string, unknown> | undefined;

    try {
      for await (const delta of chat.stream(prompt.messages, {
        ...(signal ? { signal } : {}),
        onUsage: (value) => {
          usage = { ...value };
        },
      })) {
        content += delta;
        sink.delta(delta);
      }
    } catch (error) {
      if (signal?.aborted) {
        await this.conversations.updateMessage(assistant.id, {
          content,
          status: 'stopped',
        });
        sink.done({ status: 'stopped' });
        return;
      }

      await this.failMessage(assistant.id, content, error);
      sink.error(errorPayload(error));
      return;
    }

    const citations = await this.validateCitations(
      assistant.id,
      content,
      retrieval,
      input.scope?.includeHistoryVersions === true,
    );

    const invalid = citations.filter((citation) => !citation.valid);
    const outOfRange = this.outOfRangeOrdinals(content, retrieval);
    const issueCount = invalid.length + outOfRange.length;
    const referenceCount = citations.length + outOfRange.length;
    const citationCheck = {
      status:
        issueCount === 0 ? 'ok' : issueCount >= Math.max(referenceCount, 1) ? 'failed' : 'partial',
      checked: citations.length,
      invalid: invalid.map((citation) => ({
        ordinal: citation.ordinal,
        error: citation.validationError,
      })),
      outOfRange,
    };

    await this.conversations.updateMessage(assistant.id, {
      content,
      status: 'complete',
      promptVersion: prompt.promptVersion,
      ...(usage ? { tokenUsage: usage as unknown as Prisma.InputJsonValue } : {}),
      citationCheck: citationCheck as unknown as Prisma.InputJsonValue,
    });

    sink.citations({ citations });
    sink.done({ status: 'complete', ...(usage ? { usage } : {}) });
  }

  private outOfRangeOrdinals(content: string, retrieval: RetrievalResult): number[] {
    return uniqueCitationOrdinals(content).filter(
      (ordinal) => ordinal < 1 || ordinal > retrieval.evidence.length,
    );
  }

  private async validateCitations(
    messageId: string,
    content: string,
    retrieval: RetrievalResult,
    includeHistory: boolean,
  ): Promise<CitationPayload[]> {
    const ordinals = uniqueCitationOrdinals(content);
    const citations: CitationPayload[] = [];

    for (const ordinal of ordinals) {
      const evidence = retrieval.evidence[ordinal - 1];
      if (!evidence) {
        continue;
      }

      const chunk = await this.chunks.getById(evidence.chunkId);
      let valid = true;
      let validationError: string | undefined;

      if (!chunk) {
        valid = false;
        validationError = 'CHUNK_MISSING';
      } else if (!includeHistory) {
        const version = await this.prisma.documentVersion.findUnique({
          where: { id: chunk.versionId },
          select: { isCurrent: true },
        });
        if (!version?.isCurrent) {
          valid = false;
          validationError = 'NOT_CURRENT';
        }
      }

      const quote = evidence.text.slice(0, 500);
      await this.conversations.addCitation(messageId, {
        chunkId: chunk ? chunk.id : undefined,
        documentId: evidence.documentId,
        versionId: evidence.versionId,
        ordinal,
        quote,
        isValid: valid,
        ...(validationError ? { validationError } : {}),
      });

      citations.push({
        ordinal,
        chunkId: evidence.chunkId,
        documentId: evidence.documentId,
        versionId: evidence.versionId,
        quote,
        valid,
        ...(validationError ? { validationError } : {}),
      });
    }

    return citations;
  }

  private async failMessage(messageId: string, content: string, error: unknown): Promise<void> {
    const payload = errorPayload(error);
    await this.conversations.updateMessage(messageId, {
      content,
      status: 'failed',
      errorCode: payload.code,
    });
  }
}

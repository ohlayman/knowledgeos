import { randomUUID } from 'node:crypto';
import type { MessageRole, MessageStatus, Prisma, PrismaClient } from '@prisma/client';

export interface CreateMessageInput {
  role: MessageRole;
  content: string;
  clientMessageId?: string;
  status?: MessageStatus;
  model?: string;
  promptVersion?: string;
  tokenUsage?: Prisma.InputJsonValue;
}

export interface UpdateMessageInput {
  content?: string;
  status?: MessageStatus;
  citationCheck?: Prisma.InputJsonValue;
  tokenUsage?: Prisma.InputJsonValue;
  errorCode?: string;
  model?: string;
  promptVersion?: string;
}

export interface AddCitationInput {
  chunkId?: string;
  documentId: string;
  versionId: string;
  ordinal: number;
  quote: string;
  startOffset?: number;
  endOffset?: number;
  isValid?: boolean;
  validationError?: string;
}

export class ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(title: string, ownerId?: string) {
    return this.prisma.conversation.create({
      data: { id: randomUUID(), title, ownerId },
    });
  }

  async list(ownerId?: string) {
    return this.prisma.conversation.findMany({
      where: {
        deletedAt: null,
        ...(ownerId ? { ownerId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getById(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { citations: { orderBy: { ordinal: 'asc' } } },
        },
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async createMessage(conversationId: string, input: CreateMessageInput) {
    return this.prisma.message.create({
      data: {
        id: randomUUID(),
        conversationId,
        role: input.role,
        content: input.content,
        clientMessageId: input.clientMessageId,
        status: input.status ?? 'complete',
        model: input.model,
        promptVersion: input.promptVersion,
        tokenUsage: input.tokenUsage,
      },
    });
  }

  async getMessage(id: string) {
    return this.prisma.message.findUnique({
      where: { id },
      include: { citations: { orderBy: { ordinal: 'asc' } } },
    });
  }

  async updateMessage(id: string, input: UpdateMessageInput): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: input,
    });
  }

  async addCitation(messageId: string, input: AddCitationInput) {
    return this.prisma.citation.create({
      data: {
        id: randomUUID(),
        messageId,
        ...input,
      },
    });
  }

  async listMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { citations: { orderBy: { ordinal: 'asc' } } },
    });
  }
}

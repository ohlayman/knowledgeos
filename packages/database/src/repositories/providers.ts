import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, ProviderKind } from '@prisma/client';

export interface ProviderConfigInput {
  kind: ProviderKind;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyEncrypted?: string;
  apiKeyLast4?: string;
  extra?: Prisma.InputJsonValue;
}

export class ProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    return this.prisma.providerConfig.findMany({
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async findActive(kind: ProviderKind) {
    return this.prisma.providerConfig.findFirst({
      where: { kind, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async saveActive(input: ProviderConfigInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.providerConfig.updateMany({
        where: { kind: input.kind, isActive: true },
        data: { isActive: false },
      });

      const existing = await tx.providerConfig.findFirst({
        where: { kind: input.kind, provider: input.provider, model: input.model },
      });

      const data = {
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        ...(input.apiKeyEncrypted === undefined ? {} : { apiKeyEncrypted: input.apiKeyEncrypted }),
        ...(input.apiKeyLast4 === undefined ? {} : { apiKeyLast4: input.apiKeyLast4 }),
        ...(input.extra === undefined ? {} : { extra: input.extra }),
        isActive: true,
        isDraft: false,
      };

      return existing
        ? tx.providerConfig.update({ where: { id: existing.id }, data })
        : tx.providerConfig.create({ data: { id: randomUUID(), ...data } });
    });
  }
}

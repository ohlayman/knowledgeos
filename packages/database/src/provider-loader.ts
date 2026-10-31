import type { PrismaClient, ProviderKind } from '@prisma/client';
import { decryptSecret } from '@kos/shared';
import { ProviderRepository } from './repositories/providers.js';

export interface StoredProviderSettings {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  dim?: number;
}

export async function loadProviderSettings(
  prisma: PrismaClient,
  encryptionKey: string | undefined,
  kind: ProviderKind,
): Promise<StoredProviderSettings | null> {
  const row = await new ProviderRepository(prisma).findActive(kind);
  if (!row) {
    return null;
  }

  let apiKey: string | undefined;
  if (row.apiKeyEncrypted && encryptionKey) {
    try {
      apiKey = decryptSecret(row.apiKeyEncrypted, encryptionKey);
    } catch {
      apiKey = undefined;
    }
  }

  const extra = row.extra as { dim?: number } | null;

  return {
    provider: row.provider,
    model: row.model,
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(typeof extra?.dim === 'number' ? { dim: extra.dim } : {}),
  };
}

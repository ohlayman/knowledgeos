import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';
export type {
  JobStatus,
  McpAuditLog,
  McpToken,
  ProviderKind,
  SourceType,
  VersionStatus,
} from '@prisma/client';
export * from './repositories/index.js';
export * from './provider-loader.js';

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  if (!databaseUrl) {
    return new PrismaClient();
  }

  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}

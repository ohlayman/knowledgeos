import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';
export type { JobStatus, SourceType, VersionStatus } from '@prisma/client';
export * from './repositories/index.js';

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

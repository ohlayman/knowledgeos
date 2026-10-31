import { PrismaClient } from '@prisma/client';

export { PrismaClient } from '@prisma/client';
export type { Prisma } from '@prisma/client';

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

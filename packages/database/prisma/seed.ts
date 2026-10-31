import { Prisma, PrismaClient } from '@prisma/client';

const OWNER_ID = '00000000-0000-7000-8000-000000000001';

const settings: Record<string, Prisma.InputJsonValue> = {
  'retrieval.topK': 10,
  'retrieval.vectorTopN': 40,
  'retrieval.keywordTopN': 40,
  'retrieval.rrfK': 60,
  'retrieval.rerankEnabled': true,
  'retrieval.includeHistoryVersions': false,
  'chunking.targetMin': 300,
  'chunking.targetMax': 800,
  'chunking.hardMax': 1200,
  'processing.concurrency': 2,
  'answering.concurrency': 3,
  'answering.evidenceTokenBudget': 6000,
  'privacy.sendExternalContext': true,
};

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { id: OWNER_ID },
    update: {},
    create: { id: OWNER_ID, name: 'Owner' },
  });

  for (const [key, value] of Object.entries(settings)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

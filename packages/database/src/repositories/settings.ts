import type { Prisma, PrismaClient } from '@prisma/client';

export interface SettingEntry {
  key: string;
  value: Prisma.InputJsonValue;
}

export class SettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<Record<string, Prisma.JsonValue>> {
    const rows = await this.prisma.appSetting.findMany();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async upsertMany(entries: SettingEntry[]): Promise<void> {
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.appSetting.upsert({
          where: { key: entry.key },
          update: { value: entry.value },
          create: { key: entry.key, value: entry.value },
        }),
      ),
    );
  }
}

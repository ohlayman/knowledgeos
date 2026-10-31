import { z } from 'zod';

export const SETTING_KEY_PATTERN =
  /^(retrieval|chunking|processing|answering|privacy)\.[A-Za-z0-9_.]+$/;

export const SettingValueSchema = z.union([z.number(), z.boolean(), z.string().max(500)]);

export const SettingsUpdateSchema = z
  .object({
    settings: z.record(SettingValueSchema),
  })
  .refine((value) => Object.keys(value.settings).every((key) => SETTING_KEY_PATTERN.test(key)), {
    message: '设置键不在允许范围内',
  });

export const ProviderSaveSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(127),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().trim().min(1).max(500).optional(),
  dim: z.number().int().min(1).max(8192).optional(),
});

export const ProviderKindSchema = z.enum(['llm', 'embedding', 'rerank']);

export const TestConnectionSchema = z.object({
  kind: z.enum(['llm', 'embedding']),
  provider: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().min(1).max(127).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().trim().min(1).max(500).optional(),
  dim: z.number().int().min(1).max(8192).optional(),
});

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
export type ProviderSaveInput = z.infer<typeof ProviderSaveSchema>;
export type TestConnectionInput = z.infer<typeof TestConnectionSchema>;

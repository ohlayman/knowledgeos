import { ExtractionResultSchema, type ExtractionResult } from './types.js';

export function parseExtraction(raw: string): ExtractionResult | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }

  const parsed = ExtractionResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

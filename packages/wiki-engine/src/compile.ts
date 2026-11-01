import { createHash } from 'node:crypto';
import type { ExtractionModel } from '@kos/extraction';
import { z } from 'zod';
import { PAGE_TEMPLATES, type PageType } from './template.js';

export type CompileModel = ExtractionModel;

export const PARAGRAPH_LIMIT = 12;

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  concept: '概念',
  technology: '技术',
  project: '项目',
  comparison: '对比',
  research: '研究',
  source: '来源',
};

export interface WikiParagraph {
  id: string;
  section: string;
  text: string;
  evidenceChunkIds: string[];
  origin: 'model' | 'human';
  versionIntroduced: number;
}

export interface WikiPageContent {
  summary: string;
  paragraphs: WikiParagraph[];
}

export type PatchOp =
  | {
      op: 'add';
      paragraphId: string;
      section: string;
      text: string;
      evidenceChunkIds: string[];
    }
  | { op: 'delete'; paragraphId: string }
  | { op: 'protected'; paragraphId: string; section: string; reason: string };

export interface CompileEvidence {
  chunkId: string;
  text: string;
  documentTitle?: string;
  page?: number;
}

export interface CompileFact {
  subject: string;
  predicate: string;
  value: string;
}

export interface CompileRelation {
  from: string;
  to: string;
  type: string;
}

export interface CompileInput {
  pageType: PageType;
  entityName: string;
  evidence: CompileEvidence[];
  facts: CompileFact[];
  relations: CompileRelation[];
  existing: WikiPageContent | null;
}

export type CompileOutcome =
  | {
      status: 'ok';
      content: WikiPageContent;
      patch: PatchOp[];
      validation: { ok: boolean; warnings: Array<{ paragraphId: string; message: string }> };
    }
  | { status: 'needs_split'; paragraphCount: number }
  | { status: 'invalid'; reason: string };

const ParagraphSchema = z.object({
  section: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(2000),
  evidenceChunkIds: z.array(z.string()).default([]),
});

const CompileOutputSchema = z.object({
  summary: z.string().trim().max(500).optional(),
  paragraphs: z.array(ParagraphSchema).max(50),
});

function paragraphId(section: string, text: string): string {
  return `p-${createHash('sha256').update(`${section}\n${text}`).digest('hex').slice(0, 12)}`;
}

function parseOutput(raw: string): z.infer<typeof CompileOutputSchema> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = CompileOutputSchema.safeParse(JSON.parse(candidate.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function buildMessages(input: CompileInput) {
  const template = PAGE_TEMPLATES[input.pageType].join(' → ');
  const existing = input.existing?.paragraphs.length
    ? input.existing.paragraphs
        .map(
          (paragraph) =>
            `[${paragraph.origin === 'human' ? '人工' : '模型'}] ${paragraph.section}：${paragraph.text}`,
        )
        .join('\n')
    : '（新页面，无已有内容）';

  const evidence = input.evidence
    .map((item) => `[chunk:${item.chunkId}] ${item.text}`)
    .join('\n\n');

  const facts = input.facts.length
    ? input.facts.map((fact) => `${fact.subject} | ${fact.predicate} = ${fact.value}`).join('\n')
    : '（无）';

  return [
    {
      role: 'system' as const,
      content: [
        '你是 Wiki 编译器，只输出 JSON，不要解释。',
        '页面由段落组成，每段只表达一个可被证据支持的主张。',
        '每个段落必须给出至少一个 evidenceChunkIds，且只能使用提供的块 ID。',
        '贴近原文措辞，保留限定词；证据不足时明确说明，不补充外部知识。',
        '人工段落不得改写或删除。',
        `输出结构：{"summary": string, "paragraphs": [{"section": string, "text": string, "evidenceChunkIds": string[]}]}`,
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        `页面类型：${PAGE_TYPE_LABELS[input.pageType]}（${input.pageType}）`,
        `实体：${input.entityName}`,
        `建议章节：${template}`,
        `已有内容：\n${existing}`,
        `已抽取事实：\n${facts}`,
        `证据块：\n${evidence}`,
      ].join('\n\n'),
    },
  ];
}

export async function compilePage(
  input: CompileInput,
  deps: { model: CompileModel },
): Promise<CompileOutcome> {
  if (input.evidence.length === 0) {
    return { status: 'invalid', reason: 'no_evidence' };
  }

  const allowed = new Set(input.evidence.map((item) => item.chunkId));
  const messages = buildMessages(input);
  let output: z.infer<typeof CompileOutputSchema> | null = null;

  for (let attempt = 0; attempt < 2 && !output; attempt += 1) {
    try {
      output = parseOutput((await deps.model.complete(messages)).text);
    } catch {
      output = null;
    }
  }

  if (!output) {
    return { status: 'invalid', reason: 'schema_invalid' };
  }

  if (output.paragraphs.length > PARAGRAPH_LIMIT) {
    return { status: 'needs_split', paragraphCount: output.paragraphs.length };
  }

  for (const paragraph of output.paragraphs) {
    if (paragraph.evidenceChunkIds.length === 0) {
      return { status: 'invalid', reason: 'paragraph_without_evidence' };
    }
    if (paragraph.evidenceChunkIds.some((chunkId) => !allowed.has(chunkId))) {
      return { status: 'invalid', reason: 'evidence_not_in_scope' };
    }
  }

  const existingParagraphs = input.existing?.paragraphs ?? [];
  const humanParagraphs = existingParagraphs.filter((paragraph) => paragraph.origin === 'human');
  const existingModel = existingParagraphs.filter((paragraph) => paragraph.origin === 'model');

  const generated: WikiParagraph[] = [];
  const patch: PatchOp[] = [];

  for (const paragraph of output.paragraphs) {
    const id = paragraphId(paragraph.section, paragraph.text);
    const humanConflict = humanParagraphs.find(
      (human) => human.section === paragraph.section && human.text === paragraph.text,
    );
    if (humanConflict) {
      patch.push({
        op: 'protected',
        paragraphId: humanConflict.id,
        section: paragraph.section,
        reason: '人工段落已存在，需显式解锁后才能覆盖',
      });
      continue;
    }

    generated.push({
      id,
      section: paragraph.section,
      text: paragraph.text,
      evidenceChunkIds: paragraph.evidenceChunkIds,
      origin: 'model',
      versionIntroduced: (input.existing?.paragraphs.length ?? 0) + 1,
    });
    patch.push({
      op: 'add',
      paragraphId: id,
      section: paragraph.section,
      text: paragraph.text,
      evidenceChunkIds: paragraph.evidenceChunkIds,
    });
  }

  const generatedIds = new Set(generated.map((paragraph) => paragraph.id));
  for (const paragraph of existingModel) {
    if (!generatedIds.has(paragraph.id)) {
      patch.push({ op: 'delete', paragraphId: paragraph.id });
    }
  }

  const warnings = generated
    .filter((paragraph) => paragraph.text.length < 80 || paragraph.text.length > 400)
    .map((paragraph) => ({
      paragraphId: paragraph.id,
      message: `段落长度 ${paragraph.text.length} 字，建议 80–400 字`,
    }));

  return {
    status: 'ok',
    content: {
      summary: output.summary ?? input.existing?.summary ?? '',
      paragraphs: [...humanParagraphs, ...generated],
    },
    patch,
    validation: { ok: true, warnings },
  };
}

export class FakeCompileModel implements CompileModel {
  readonly model = 'fake-compiler';

  async complete(messages: Array<{ role: string; content: string }>): Promise<{ text: string }> {
    const user = messages.at(-1)?.content ?? '';
    const matches = [
      ...user.matchAll(/\[chunk:([0-9a-f-]{36})\] ([\s\S]*?)(?=\n\n\[chunk:|\n*$)/g),
    ];
    const template = PAGE_TEMPLATES.concept[0] ?? '定义';

    const paragraphs = matches.slice(0, 6).map((match) => ({
      section: template,
      text: match[2]!.trim().slice(0, 400),
      evidenceChunkIds: [match[1]!],
    }));

    const summary = paragraphs[0]?.text.slice(0, 100) ?? '';
    return { text: JSON.stringify({ summary, paragraphs }) };
  }
}

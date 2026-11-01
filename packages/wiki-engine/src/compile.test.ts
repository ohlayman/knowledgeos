import { describe, expect, it } from 'vitest';
import { compilePage, FakeCompileModel, type CompileModel, type WikiParagraph } from './compile.js';

const chunkA = '11111111-1111-4111-8111-111111111111';
const chunkB = '22222222-2222-4222-8222-222222222222';
const chunkC = '33333333-3333-4333-8333-333333333333';

const evidence = [
  {
    chunkId: chunkA,
    text: '混合检索同时使用向量召回与关键词召回，两路结果用 RRF 融合。',
    documentTitle: '检索笔记',
  },
  {
    chunkId: chunkB,
    text: 'RRF 只依赖排名，不依赖不同量纲的分数，因此能稳定合并两路结果。',
    documentTitle: '融合笔记',
  },
];

function modelReturning(output: string): CompileModel {
  return {
    model: 'test-compile',
    async complete() {
      return { text: output };
    },
  };
}

const baseInput = {
  pageType: 'concept' as const,
  entityName: '混合检索',
  evidence,
  facts: [],
  relations: [],
  existing: null,
};

describe('compilePage', () => {
  it('生成带证据锚点的页面内容与新增段落', async () => {
    const model = modelReturning(
      JSON.stringify({
        summary: '混合检索融合两路召回。',
        paragraphs: [
          {
            section: '定义',
            text: '混合检索同时使用向量召回与关键词召回，两路结果通过 RRF 融合，以兼顾语义相似与精确匹配。',
            evidenceChunkIds: [chunkA],
          },
          {
            section: '工作原理',
            text: 'RRF 只依赖排名而不依赖分数，因此能稳定合并来自不同检索路径的结果。',
            evidenceChunkIds: [chunkB],
          },
        ],
      }),
    );

    const outcome = await compilePage(baseInput, { model });

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.content.paragraphs).toHaveLength(2);
      expect(outcome.content.paragraphs[0]?.evidenceChunkIds).toEqual([chunkA]);
      expect(outcome.patch.filter((op) => op.op === 'add')).toHaveLength(2);
      expect(outcome.validation.ok).toBe(true);
    }
  });

  it('段落缺少证据锚点时判定无效', async () => {
    const model = modelReturning(
      JSON.stringify({
        paragraphs: [
          { section: '定义', text: '一段没有任何证据锚点的文字。', evidenceChunkIds: [] },
        ],
      }),
    );

    const outcome = await compilePage(baseInput, { model });

    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.reason).toBe('paragraph_without_evidence');
    }
  });

  it('引用不在允许集合内的块时判定无效', async () => {
    const model = modelReturning(
      JSON.stringify({
        paragraphs: [{ section: '定义', text: '引用了不存在的块。', evidenceChunkIds: [chunkC] }],
      }),
    );

    const outcome = await compilePage(baseInput, { model });

    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.reason).toBe('evidence_not_in_scope');
    }
  });

  it('超过 12 段时要求拆分页面', async () => {
    const model = modelReturning(
      JSON.stringify({
        paragraphs: Array.from({ length: 13 }, (_, index) => ({
          section: '定义',
          text: `第 ${index} 段用于验证段落上限。`,
          evidenceChunkIds: [chunkA],
        })),
      }),
    );

    const outcome = await compilePage(baseInput, { model });

    expect(outcome.status).toBe('needs_split');
    if (outcome.status === 'needs_split') {
      expect(outcome.paragraphCount).toBe(13);
    }
  });

  it('人工段落不得被覆盖，并生成受保护标记', async () => {
    const human: WikiParagraph = {
      id: 'human-1',
      section: '定义',
      text: '人工撰写并确认过的定义段落，模型不得覆盖。',
      evidenceChunkIds: [chunkA],
      origin: 'human',
      versionIntroduced: 1,
    };

    const model = modelReturning(
      JSON.stringify({
        paragraphs: [
          {
            section: '定义',
            text: '人工撰写并确认过的定义段落，模型不得覆盖。',
            evidenceChunkIds: [chunkB],
          },
        ],
      }),
    );

    const outcome = await compilePage(
      { ...baseInput, existing: { summary: '', paragraphs: [human] } },
      { model },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      const kept = outcome.content.paragraphs.find((paragraph) => paragraph.id === 'human-1');
      expect(kept?.text).toBe(human.text);
      expect(kept?.origin).toBe('human');
      expect(outcome.patch.some((op) => op.op === 'protected')).toBe(true);
    }
  });

  it('没有证据时不编译', async () => {
    const outcome = await compilePage(
      { ...baseInput, evidence: [] },
      {
        model: modelReturning(JSON.stringify({ paragraphs: [] })),
      },
    );

    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.reason).toBe('no_evidence');
    }
  });
});

describe('FakeCompileModel', () => {
  it('用证据文本生成可校验的段落', async () => {
    const outcome = await compilePage(baseInput, { model: new FakeCompileModel() });

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.content.paragraphs.length).toBeGreaterThan(0);
      expect(
        outcome.content.paragraphs.every((paragraph) => paragraph.evidenceChunkIds.length > 0),
      ).toBe(true);
    }
  });
});

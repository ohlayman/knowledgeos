import { parseMarkdown, type ParsedDocument } from '@kos/parser';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunk.js';

const SMALL = { targetMin: 8, targetMax: 20, hardMax: 30, overlapRatio: 0.1 };

function markdown(lines: string[]): ParsedDocument {
  return parseMarkdown(lines.join('\n'));
}

describe('chunkDocument', () => {
  it('按标题分组并保留标题路径', () => {
    const doc = markdown([
      '# 混合检索',
      '',
      '向量召回负责语义相近。',
      '',
      '## 关键词',
      '',
      '关键词召回负责精确匹配。',
    ]);

    const chunks = chunkDocument(doc, SMALL);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.headingPath).toEqual(['混合检索']);
    expect(chunks[0]?.text).toContain('向量召回负责语义相近');
    expect(chunks[1]?.headingPath).toEqual(['混合检索', '关键词']);
    expect(chunks[1]?.text).toContain('关键词召回负责精确匹配');
  });

  it('每个块的偏移落在原文内，核心文本是块文本的后缀', () => {
    const doc = markdown([
      '# 标题',
      '',
      '第一句内容。第二句内容。第三句内容。第四句内容。第五句内容。第六句内容。第七句内容。第八句内容。',
    ]);

    const chunks = chunkDocument(doc, SMALL);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.endOffset).toBeLessThanOrEqual(doc.text.length);
      expect(doc.text.slice(chunk.startOffset, chunk.endOffset).length).toBeGreaterThan(0);
      expect(chunk.text.endsWith(doc.text.slice(chunk.startOffset, chunk.endOffset))).toBe(true);
    }
  });

  it('相邻块带重叠前缀但偏移不包含重叠', () => {
    const doc = markdown([
      '# 标题',
      '',
      '第一句内容。第二句内容。第三句内容。第四句内容。第五句内容。第六句内容。第七句内容。第八句内容。',
    ]);

    const chunks = chunkDocument(doc, SMALL);
    const first = chunks[0]!;
    const second = chunks[1]!;

    const firstCore = doc.text.slice(first.startOffset, first.endOffset);
    const secondCore = doc.text.slice(second.startOffset, second.endOffset);
    const overlap = second.text.slice(0, second.text.length - secondCore.length).trim();

    expect(overlap.length).toBeGreaterThan(0);
    expect(firstCore.endsWith(overlap)).toBe(true);
    expect(second.text.endsWith(secondCore)).toBe(true);
  });

  it('代码块独立成块并带语言信息', () => {
    const doc = markdown([
      '# 代码',
      '',
      '前面的说明文字。',
      '',
      '```ts',
      'const fused = rrf(vectorRanks, keywordRanks, 60);',
      '```',
      '',
      '后面的说明文字。',
    ]);

    const chunks = chunkDocument(doc, { ...SMALL, targetMax: 200, hardMax: 300 });
    const code = chunks.find((chunk) => chunk.type === 'code');

    expect(code).toBeDefined();
    expect(code!.text).toContain('const fused = rrf');
    expect(code!.headingPath).toEqual(['代码']);
    expect(chunks.filter((chunk) => chunk.type === 'code')).toHaveLength(1);
  });

  it('表格整体成块，超限时按行拆分并重复表头', () => {
    const rows = Array.from({ length: 12 }, (_, index) => `| 行${index} | 说明${index} |`);
    const doc = markdown(['# 表格', '', '| 名称 | 说明 |', '| --- | --- |', ...rows]);

    const chunks = chunkDocument(doc, { ...SMALL, targetMax: 30, hardMax: 45 });
    const tables = chunks.filter((chunk) => chunk.type === 'table');

    expect(tables.length).toBeGreaterThan(1);
    for (const chunk of tables) {
      expect(chunk.text.startsWith('名称 | 说明')).toBe(true);
    }
  });

  it('过短的相邻段落合并到同一标题下', () => {
    const doc = markdown(['# 合并', '', '很短的一段。', '', '另一段也很短。']);

    const chunks = chunkDocument(doc, { targetMin: 50, targetMax: 200, hardMax: 300 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('很短的一段');
    expect(chunks[0]?.text).toContain('另一段也很短');
  });

  it('块带上检索用 searchText', () => {
    const doc = markdown(['# 检索', '', '混合检索使用 RRF 融合。']);

    const chunks = chunkDocument(doc, SMALL);

    expect(chunks[0]?.searchText).toContain('混合');
    expect(chunks[0]?.searchText).toContain('rrf');
  });

  it('空文档返回空数组', () => {
    expect(chunkDocument(parseMarkdown(''), SMALL)).toEqual([]);
  });
});

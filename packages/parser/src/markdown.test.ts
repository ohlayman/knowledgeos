import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown.js';

const FIXTURE = [
  '# 混合检索',
  '',
  '混合检索同时使用**向量**与关键词。',
  '',
  '## 列表',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '## 代码',
  '',
  '```ts',
  'const fused = rrf(vectorRanks, keywordRanks, 60);',
  '```',
  '',
  '| 名称 | 作用 |',
  '| --- | --- |',
  '| 向量 | 语义召回 |',
  '| 关键词 | 精确匹配 |',
  '',
  '> 引用的一段话。',
].join('\n');

describe('parseMarkdown', () => {
  it('按文档顺序产出结构块与层级', () => {
    const doc = parseMarkdown(FIXTURE);

    expect(doc.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'heading',
      'code',
      'table',
      'quote',
    ]);

    expect(doc.blocks.filter((block) => block.kind === 'heading').map((b) => b.level)).toEqual([
      1, 2, 2,
    ]);
    expect(doc.blocks[5]?.language).toBe('ts');
    expect(doc.blocks[0]?.text).toBe('混合检索');
    expect(doc.blocks[3]?.text).toBe('- 第一项\n- 第二项');
    expect(doc.blocks[6]?.text).toBe('名称 | 作用\n向量 | 语义召回\n关键词 | 精确匹配');
  });

  it('每个块的偏移都能切回块文本', () => {
    const doc = parseMarkdown(FIXTURE);

    for (const block of doc.blocks) {
      expect(doc.text.slice(block.startOffset, block.endOffset)).toBe(block.text);
    }
  });

  it('正文不含 Markdown 语法标记', () => {
    const doc = parseMarkdown(FIXTURE);

    expect(doc.text).not.toContain('#');
    expect(doc.text).not.toContain('```');
    expect(doc.text).not.toContain('**');
  });

  it('元数据取首个标题并统计词数', () => {
    const doc = parseMarkdown(FIXTURE);

    expect(doc.metadata.title).toBe('混合检索');
    expect(doc.metadata.wordCount).toBeGreaterThan(0);
    expect(doc.warnings).toEqual([]);
  });

  it('emoji 与中文偏移按 UTF-16 code unit 计算', () => {
    const raw = ['# 标题', '', '表情 😀 与中文混排。'].join('\n');
    const doc = parseMarkdown(raw);
    const paragraph = doc.blocks.find((block) => block.kind === 'paragraph');

    expect(paragraph).toBeDefined();
    expect(doc.text.slice(paragraph!.startOffset, paragraph!.endOffset)).toBe(
      '表情 😀 与中文混排。',
    );
  });

  it('结构快照稳定', () => {
    const doc = parseMarkdown(FIXTURE);

    expect(
      doc.blocks.map(({ kind, level, language, startOffset, endOffset }) => ({
        kind,
        level,
        language,
        startOffset,
        endOffset,
      })),
    ).toMatchSnapshot();
  });

  it('空输入返回空文档', () => {
    const doc = parseMarkdown('   \n\n');

    expect(doc.text).toBe('');
    expect(doc.blocks).toEqual([]);
    expect(doc.metadata.wordCount).toBe(0);
  });
});

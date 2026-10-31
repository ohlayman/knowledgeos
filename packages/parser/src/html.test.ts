import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHtml } from './html.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

describe('parseHtml', () => {
  it('提取正文结构并丢弃导航与广告', () => {
    const doc = parseHtml(fixture('article.html'));

    expect(doc.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'list',
      'table',
    ]);
    expect(doc.blocks[0]?.text).toBe('混合检索入门');
    expect(doc.blocks[3]?.text).toContain('向量召回负责语义相近');
    expect(doc.blocks[4]?.text).toContain('向量 | 同义改写');

    expect(doc.text).not.toContain('限时优惠');
    expect(doc.text).not.toContain('相关文章');
    expect(doc.text).not.toContain('版权所有');
  });

  it('提取标题、作者与正文偏移', () => {
    const doc = parseHtml(fixture('article.html'));

    expect(doc.metadata.title).toBe('混合检索入门');
    expect(doc.metadata.language).toBe('zh-CN');
    for (const block of doc.blocks) {
      expect(doc.text.slice(block.startOffset, block.endOffset)).toBe(block.text);
    }
  });

  it('保留代码块与引用块', () => {
    const doc = parseHtml(fixture('blog.html'));

    const code = doc.blocks.find((block) => block.kind === 'code');
    const quote = doc.blocks.find((block) => block.kind === 'quote');

    expect(code?.text).toBe('const chunks = split(blocks, { targetMax: 800 });');
    expect(quote?.text).toContain('重叠只用于检索上下文');
    expect(doc.text).not.toContain('评论区第一条');
  });

  it('正文过短时回退到全文提取并给出警告', () => {
    const doc = parseHtml(fixture('short.html'));

    expect(doc.blocks.map((block) => block.kind)).toEqual(['paragraph']);
    expect(doc.blocks[0]?.text).toContain('很短的内容');
    expect(doc.warnings).toContain('readability_fallback');
  });

  it('正文没有结构化标签时按纯文本兜底', () => {
    const doc = parseHtml('<html><body>裸文本内容</body></html>');

    expect(doc.blocks.map((block) => block.text)).toEqual(['裸文本内容']);
  });

  it('空 HTML 返回空文档', () => {
    const doc = parseHtml('');

    expect(doc.text).toBe('');
    expect(doc.blocks).toEqual([]);
  });
});

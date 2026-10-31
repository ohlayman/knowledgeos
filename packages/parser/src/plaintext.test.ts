import { describe, expect, it } from 'vitest';
import { parsePlainText } from './plaintext.js';

const FIXTURE = ['第一段第一行', '第一段第二行', '', '第二段内容。', '', '', '第三段内容。'].join(
  '\n',
);

describe('parsePlainText', () => {
  it('按空行切分段落', () => {
    const doc = parsePlainText(FIXTURE);

    expect(doc.blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(doc.blocks[0]?.text).toBe('第一段第一行\n第一段第二行');
    expect(doc.blocks[1]?.text).toBe('第二段内容。');
    expect(doc.blocks[2]?.text).toBe('第三段内容。');
  });

  it('每个块的偏移都能切回块文本', () => {
    const doc = parsePlainText(FIXTURE);

    for (const block of doc.blocks) {
      expect(doc.text.slice(block.startOffset, block.endOffset)).toBe(block.text);
    }
  });

  it('兼容 CRLF 换行', () => {
    const doc = parsePlainText('甲\r\n\r\n乙\r\n');

    expect(doc.blocks.map((block) => block.text)).toEqual(['甲', '乙']);
  });

  it('空输入返回空文档', () => {
    const doc = parsePlainText(' \n\t\n');

    expect(doc.text).toBe('');
    expect(doc.blocks).toEqual([]);
    expect(doc.metadata.wordCount).toBe(0);
  });
});

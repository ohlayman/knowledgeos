import { describe, expect, it } from 'vitest';
import { ApiError } from '@kos/shared';
import { parseDocument } from './parse.js';

describe('parseDocument', () => {
  it('按 MIME 类型分派到 Markdown 解析器', async () => {
    const doc = await parseDocument('text/markdown', Buffer.from('# 标题\n\n正文。', 'utf8'));

    expect(doc.blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph']);
  });

  it('按 MIME 类型分派到纯文本解析器', async () => {
    const doc = await parseDocument('text/plain', Buffer.from('甲\n\n乙', 'utf8'));

    expect(doc.blocks.map((block) => block.text)).toEqual(['甲', '乙']);
  });

  it('不支持的 MIME 类型抛出 UNSUPPORTED_FORMAT', async () => {
    await expect(parseDocument('image/png', Buffer.alloc(0))).rejects.toBeInstanceOf(ApiError);
    await expect(parseDocument('image/png', Buffer.alloc(0))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { redactParams } from './redact.js';

describe('redactParams', () => {
  it('保留密钥后四位', () => {
    expect(redactParams({ apiKey: 'sk-secret-4f2a' })).toEqual({ apiKey: '••••4f2a' });
    expect(redactParams({ token: 'abc' })).toEqual({ token: '••••' });
  });

  it('隐藏文件路径但保留结构', () => {
    expect(redactParams({ file: 'C:\\Users\\HP\\secret.txt', other: 1 })).toEqual({
      file: '<path>',
      other: 1,
    });
    expect(redactParams({ path: '/etc/passwd' })).toEqual({ path: '<path>' });
  });

  it('递归处理嵌套结构', () => {
    expect(redactParams({ nested: { password: 'hunter2', list: [{ secret: 'abcdef' }] } })).toEqual(
      { nested: { password: '••••', list: [{ secret: '••••cdef' }] } },
    );
  });
});

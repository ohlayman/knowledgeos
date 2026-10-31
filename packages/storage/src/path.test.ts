import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from './path.js';

const moduleUrl = pathToFileURL(resolve(process.cwd(), 'apps/api/src/deps.ts')).href;

describe('resolveDataDir', () => {
  it('相对路径基于仓库根目录解析', () => {
    const resolved = resolveDataDir('./data', moduleUrl);

    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(resolve(process.cwd(), 'data'));
  });

  it('绝对路径保持不变', () => {
    const absolute = resolve(process.cwd(), 'custom-data');
    expect(resolveDataDir(absolute, moduleUrl)).toBe(absolute);
  });
});

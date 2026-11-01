import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportsWebGL } from './webgl.js';

afterEach(() => vi.restoreAllMocks());

describe('supportsWebGL', () => {
  it('拿不到上下文时返回 false', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(supportsWebGL()).toBe(false);
  });

  it('拿到 webgl2 上下文时返回 true', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    expect(supportsWebGL()).toBe(true);
  });

  it('getContext 抛错时按不可用处理', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(supportsWebGL()).toBe(false);
  });
});

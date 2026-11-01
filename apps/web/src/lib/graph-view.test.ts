import { describe, expect, it } from 'vitest';
import {
  canUse3D,
  defaultViewMode,
  resolveViewMode,
  shouldOfferFallback,
} from './graph-view.js';

describe('图谱视图模式', () => {
  it('桌面且 WebGL 可用时默认 3D', () => {
    expect(defaultViewMode(1440, true)).toBe('3d');
    expect(canUse3D(1024, true)).toBe(true);
  });

  it('窄屏或 WebGL 不可用时回落', () => {
    expect(defaultViewMode(900, true)).toBe('2d');
    expect(defaultViewMode(390, true)).toBe('list');
    expect(defaultViewMode(1440, false)).toBe('2d');
    expect(canUse3D(390, true)).toBe(false);
  });

  it('已保存的选择优先，但不允许在不可用环境恢复 3D', () => {
    expect(resolveViewMode('list', 1440, true)).toBe('list');
    expect(resolveViewMode('2d', 1440, true)).toBe('2d');
    expect(resolveViewMode('3d', 390, true)).toBe('list');
    expect(resolveViewMode('3d', 1440, false)).toBe('2d');
    expect(resolveViewMode('unknown', 1440, true)).toBe('3d');
  });

  it('首帧过慢或帧率过低时提示切换', () => {
    expect(shouldOfferFallback(4100, 60)).toBe(true);
    expect(shouldOfferFallback(1200, 19)).toBe(true);
    expect(shouldOfferFallback(1200, 30)).toBe(false);
    expect(shouldOfferFallback(4000, 20)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { geometryFor, graphPalette } from './graph-style.js';

describe('graph style', () => {
  it('主题色不同且完整', () => {
    const light = graphPalette('light');
    const dark = graphPalette('dark');

    expect(Object.keys(light)).toEqual([
      'canvas',
      'node',
      'selected',
      'link',
      'pending',
      'conflict',
      'text',
    ]);
    expect(light.canvas).not.toBe(dark.canvas);
    expect(light.selected).toBeTruthy();
  });

  it('按类型返回几何体', () => {
    expect(geometryFor('concept')).toBe('sphere');
    expect(geometryFor('technology')).toBe('box');
    expect(geometryFor('project')).toBe('prism');
    expect(geometryFor('agent')).toBe('octa');
    expect(geometryFor('protocol')).toBe('tetra');
    expect(geometryFor('unknown')).toBe('sphere');
  });
});

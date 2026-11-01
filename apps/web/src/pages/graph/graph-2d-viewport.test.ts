import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerOn,
  clampViewport,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './graph-2d-viewport.js';

describe('graph 2d viewport', () => {
  it('clamps zoom into the allowed range', () => {
    expect(clampViewport({ x: 10, y: 20, k: 0.1 }).k).toBe(MIN_ZOOM);
    expect(clampViewport({ x: 10, y: 20, k: 9 }).k).toBe(MAX_ZOOM);
  });

  it('zooms around the pointer so the world point stays under it', () => {
    const before = { x: 0, y: 0, k: 1 };
    const pointer = { x: 200, y: 120 };
    const world = screenToWorld(before, pointer);
    const after = zoomAt(before, pointer, 1.2);
    const screen = worldToScreen(after, world);

    expect(screen.x).toBeCloseTo(200, 5);
    expect(screen.y).toBeCloseTo(120, 5);
    expect(after.k).toBeGreaterThan(1);
  });

  it('pans and round-trips coordinates', () => {
    const viewport = panBy({ x: 0, y: 0, k: 1.5 }, 30, -20);
    const world = { x: 120, y: 80 };
    expect(worldToScreen(viewport, world)).toEqual({ x: 210, y: 100 });
    expect(screenToWorld(viewport, { x: 210, y: 100 })).toEqual(world);
  });

  it('centers a node at the canvas center', () => {
    const viewport = centerOn({ x: 300, y: 200 }, 900, 620, 1.4);
    expect(viewport).toEqual({ x: 450 - 300 * 1.4, y: 310 - 200 * 1.4, k: 1.4 });
  });
});

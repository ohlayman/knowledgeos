export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.5;

export function clampViewport(viewport: Viewport): Viewport {
  return {
    ...viewport,
    k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.k)),
  };
}

export function screenToWorld(viewport: Viewport, point: { x: number; y: number }) {
  return {
    x: (point.x - viewport.x) / viewport.k,
    y: (point.y - viewport.y) / viewport.k,
  };
}

export function worldToScreen(viewport: Viewport, point: { x: number; y: number }) {
  return {
    x: point.x * viewport.k + viewport.x,
    y: point.y * viewport.k + viewport.y,
  };
}

export function zoomAt(
  viewport: Viewport,
  point: { x: number; y: number },
  delta: number,
): Viewport {
  const world = screenToWorld(viewport, point);
  const next = clampViewport({ ...viewport, k: viewport.k * delta });
  return {
    x: point.x - world.x * next.k,
    y: point.y - world.y * next.k,
    k: next.k,
  };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

export function centerOn(
  point: { x: number; y: number },
  width: number,
  height: number,
  k = 1,
): Viewport {
  const zoom = clampViewport({ x: 0, y: 0, k }).k;
  return {
    x: width / 2 - point.x * zoom,
    y: height / 2 - point.y * zoom,
    k: zoom,
  };
}

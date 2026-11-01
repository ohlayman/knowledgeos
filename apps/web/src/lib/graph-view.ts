export type GraphViewMode = '3d' | '2d' | 'list';

export const GRAPH_VIEW_STORAGE_KEY = 'kos-graph-view';

export function canUse3D(width: number, webgl: boolean): boolean {
  return webgl && width >= 1024;
}

export function defaultViewMode(width: number, webgl: boolean): GraphViewMode {
  if (width <= 767) {
    return 'list';
  }
  if (!canUse3D(width, webgl)) {
    return '2d';
  }
  return '3d';
}

export function resolveViewMode(
  saved: string | null,
  width: number,
  webgl: boolean,
): GraphViewMode {
  if (saved === '2d' || saved === 'list') {
    return saved;
  }
  if (saved === '3d') {
    return canUse3D(width, webgl) ? '3d' : defaultViewMode(width, webgl);
  }
  return defaultViewMode(width, webgl);
}

export function shouldOfferFallback(firstFrameMs: number, fps: number): boolean {
  return firstFrameMs > 4000 || fps < 20;
}

export function shouldAutoFit(fitted: boolean, nodeCount: number): boolean {
  return !fitted && nodeCount > 0;
}

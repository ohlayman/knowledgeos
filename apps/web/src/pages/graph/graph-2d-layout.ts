import type { GraphNode } from '../../features/schemas.js';

export interface Point {
  x: number;
  y: number;
}

export const INITIAL_RADIUS = 240;
export const CHILD_RADIUS = 140;
const CENTER: Point = { x: 450, y: 310 };

function hashOf(id: string): number {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

export function angleFor(id: string, index: number): number {
  return ((hashOf(id) + index * 137.508) * Math.PI) / 180;
}

export function initialPosition(id: string, index: number): Point {
  const angle = angleFor(id, index);
  return {
    x: CENTER.x + INITIAL_RADIUS * Math.cos(angle),
    y: CENTER.y + INITIAL_RADIUS * Math.sin(angle),
  };
}

export function nextPositions(
  nodes: GraphNode[],
  existing: Map<string, Point>,
  parent?: Point,
): Map<string, Point> {
  const next = new Map(existing);
  nodes.forEach((node, index) => {
    if (next.has(node.id)) {
      return;
    }
    if (parent) {
      const angle = angleFor(node.id, index);
      next.set(node.id, {
        x: parent.x + CHILD_RADIUS * Math.cos(angle),
        y: parent.y + CHILD_RADIUS * Math.sin(angle),
      });
      return;
    }
    next.set(node.id, initialPosition(node.id, index));
  });
  return next;
}

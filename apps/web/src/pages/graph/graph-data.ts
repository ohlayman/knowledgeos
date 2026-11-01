import type { GraphEdge, GraphNode } from '../../features/schemas.js';

export interface Graph3DNode {
  id: string;
  name: string;
  type: string;
  val: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface Graph3DLink {
  id: string;
  source: string;
  target: string;
  type: string;
  status: string;
}

export interface Graph3DLimits {
  maxNodes?: number;
  maxLinks?: number;
}

export interface Graph3DData {
  nodes: Graph3DNode[];
  links: Graph3DLink[];
  truncated: boolean;
  originalNodes: number;
  originalLinks: number;
}

const DEFAULT_MAX_NODES = 500;
const DEFAULT_MAX_LINKS = 2000;
const LABEL_LIMIT = 150;

export function toGraph3DData(
  nodes: Iterable<GraphNode>,
  edges: Iterable<GraphEdge>,
  limits: Graph3DLimits = {},
): Graph3DData {
  const maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  const maxLinks = limits.maxLinks ?? DEFAULT_MAX_LINKS;

  const allNodes = [...nodes];
  const visibleNodes = allNodes.slice(0, maxNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));

  const allLinks = [...edges];
  const validLinks = allLinks.filter(
    (edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId),
  );
  const visibleLinks = validLinks.slice(0, maxLinks);

  return {
    nodes: visibleNodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      val: 1 + Math.min(node.mentionCount, 20),
    })),
    links: visibleLinks.map((edge) => ({
      id: edge.id,
      source: edge.fromId,
      target: edge.toId,
      type: edge.type,
      status: edge.status,
    })),
    truncated: visibleNodes.length < allNodes.length || validLinks.length > maxLinks,
    originalNodes: allNodes.length,
    originalLinks: allLinks.length,
  };
}

export function neighborsOf(edges: Iterable<GraphEdge>, id: string): Set<string> {
  const neighbors = new Set<string>();
  for (const edge of edges) {
    if (edge.fromId === id) {
      neighbors.add(edge.toId);
    } else if (edge.toId === id) {
      neighbors.add(edge.fromId);
    }
  }
  return neighbors;
}

export function labelVisible(
  total: number,
  id: string,
  state: { selected: string | null; hovered: string | null; neighbors: Set<string> },
): boolean {
  if (total <= LABEL_LIMIT) {
    return true;
  }
  return state.selected === id || state.hovered === id || state.neighbors.has(id);
}

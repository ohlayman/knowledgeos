export interface GraphNode {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  mentionCount: number;
  confidence: number;
  mergedIntoId: string | null;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  confidence: number;
  evidenceChunkIds: string[];
  status: string;
  origin: string;
  direction: string;
}

export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  chunkIds: string[];
  score: number;
  scoreBreakdown: {
    confidenceProduct: number;
    sourceQuality: number;
    weakPenalty: number;
  };
}

export interface GraphNeighborhood {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface EntryNode {
  node: GraphNode;
  degree: number;
}

export interface GraphStore {
  getEntities(ids: string[]): Promise<GraphNode[]>;
  resolveMergedMap(): Promise<Map<string, string>>;
  listRelations(entityIds: string[]): Promise<GraphEdge[]>;
  listEntryNodes(limit: number): Promise<EntryNode[]>;
  listPendingRelations(limit: number): Promise<GraphEdge[]>;
  confirmRelation(id: string): Promise<GraphEdge>;
  mergeEntity(sourceId: string, targetId: string): Promise<void>;
  undoMerge(sourceId: string): Promise<void>;
}

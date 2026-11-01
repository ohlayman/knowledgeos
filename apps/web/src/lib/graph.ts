export const GRAPH_LABEL_LIMIT = 150;
export const GRAPH_AGGREGATE_LIMIT = 400;

export function shouldHideLabels(nodeCount: number): boolean {
  return nodeCount > GRAPH_LABEL_LIMIT;
}

export function shouldAggregate(nodeCount: number): boolean {
  return nodeCount > GRAPH_AGGREGATE_LIMIT;
}

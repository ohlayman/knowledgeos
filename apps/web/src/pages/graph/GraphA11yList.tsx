import type { GraphNode } from '../../features/schemas.js';

export interface GraphA11yListProps {
  nodes: GraphNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  onExpand: (node: GraphNode) => void;
}

export function GraphA11yList({ nodes, selected, onSelect, onExpand }: GraphA11yListProps) {
  return (
    <ul className="sr-only" aria-label="图谱节点列表">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            aria-pressed={selected === node.id}
            onClick={() => {
              onSelect(node.id);
              onExpand(node);
            }}
          >
            节点 {node.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

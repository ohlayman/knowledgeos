import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { GraphEdge, GraphNode } from '../../features/schemas.js';
import { labelVisible, neighborsOf } from './graph-data.js';
import { nextPositions, type Point } from './graph-2d-layout.js';
import { NodeIcon } from './graph-node-icon.js';
import { centerOn, panBy, zoomAt, type Viewport } from './graph-2d-viewport.js';

export interface Graph2DViewHandle {
  focusNode(id: string): void;
  resetView(): void;
}

export interface Graph2DViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: string | null;
  expanded: Set<string>;
  onSelect: (id: string | null) => void;
  onExpand: (node: GraphNode) => void;
  onBackgroundDoubleClick: () => void;
}

const WIDTH = 900;
const HEIGHT = 620;

function shapeFor(node: GraphNode, selected: boolean, size: number) {
  const fill = selected ? 'var(--accent-weak)' : 'var(--paper-1)';
  const stroke = selected ? 'var(--accent)' : 'var(--line-strong)';
  const strokeWidth = selected ? 2 : 1.5;

  switch (node.type) {
    case 'technology':
    case 'project':
      return (
        <rect
          x={-size}
          y={-size}
          width={size * 2}
          height={size * 2}
          rx={6}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'agent':
    case 'protocol':
      return (
        <polygon
          points={`0,${-size} ${size},0 0,${size} ${-size},0`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    default:
      return <circle r={size} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
}

export const Graph2DView = forwardRef<Graph2DViewHandle, Graph2DViewProps>(function Graph2DView(
  { nodes, edges, selected, onSelect, onExpand, onBackgroundDoubleClick },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [entering, setEntering] = useState<Set<string>>(new Set());
  const previousIds = useRef<Set<string>>(new Set());
  const positionsRef = useRef(positions);
  const selectedRef = useRef(selected);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const currentIds = new Set(nodes.map((node) => node.id));
    const added = nodes.filter((node) => !previousIds.current.has(node.id)).map((node) => node.id);
    previousIds.current = currentIds;
    if (added.length === 0) {
      return;
    }
    setEntering(new Set(added));
    const timer = window.setTimeout(() => setEntering(new Set()), 220);
    return () => window.clearTimeout(timer);
  }, [nodes]);

  useEffect(() => {
    setPositions((current) => {
      const parent = selectedRef.current ? current.get(selectedRef.current) : undefined;
      return nextPositions(nodes, current, parent);
    });
  }, [nodes]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
      };
      setViewport((current) => zoomAt(current, point, event.deltaY < 0 ? 1.1 : 0.9));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      const attempt = (tries: number) => {
        const point = positionsRef.current.get(id);
        if (!point) {
          if (tries < 20) {
            window.setTimeout(() => attempt(tries + 1), 100);
          }
          return;
        }
        setViewport((current) => centerOn(point, WIDTH, HEIGHT, Math.max(current.k, 1.2)));
        onSelect(id);
      };
      attempt(0);
    },
    [onSelect],
  );

  const resetView = useCallback(() => {
    setViewport({ x: 0, y: 0, k: 1 });
  }, []);

  const neighbors = hoveredNode ? neighborsOf(edges, hoveredNode) : new Set<string>();

  useImperativeHandle(ref, () => ({ focusNode, resetView }), [focusNode, resetView]);

  const zoomButton = (delta: number) => {
    setViewport((current) => zoomAt(current, { x: WIDTH / 2, y: HEIGHT / 2 }, delta));
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.lastX) / rect.width) * WIDTH;
    const dy = ((event.clientY - drag.lastY) / rect.height) * HEIGHT;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      drag.moved = true;
    }
    if (drag.moved) {
      setViewport((current) => panBy(current, dx, dy));
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) {
      onSelect(null);
    }
  };

  return (
    <div className="graph-2d">
      <div className="graph-2d-controls" role="group" aria-label="画布缩放">
        <button type="button" className="btn sm" onClick={() => zoomButton(1.2)}>
          放大
        </button>
        <button type="button" className="btn sm" onClick={() => zoomButton(0.8)}>
          缩小
        </button>
        <button type="button" className="btn ghost sm" onClick={resetView}>
          重置视图
        </button>
      </div>
      <svg
        ref={svgRef}
        data-testid="graph2d-canvas"
        data-viewport={`${viewport.x},${viewport.y},${viewport.k}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        role="img"
        aria-label="知识图谱"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onBackgroundDoubleClick()}
      >
        <defs>
          <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--line)" opacity="0.4" />
          </pattern>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="var(--line-strong)" />
          </marker>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#dot-grid)" pointerEvents="none" />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          {[...edges].map((edge) => {
            const from = positions.get(edge.fromId);
            const to = positions.get(edge.toId);
            if (!from || !to) {
              return null;
            }
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.hypot(dx, dy) || 1;
            const nx = (-dy / length) * 2;
            const ny = (dx / length) * 2;
            const conflict = edge.type === 'CONFLICTS_WITH';
            const stroke = conflict ? 'var(--danger)' : 'var(--line-strong)';
            return (
              <g key={edge.id}>
                {conflict ? (
                  <>
                    <line
                      x1={from.x + nx}
                      y1={from.y + ny}
                      x2={to.x + nx}
                      y2={to.y + ny}
                      stroke={stroke}
                      strokeWidth={1.5}
                    />
                    <line
                      x1={from.x - nx}
                      y1={from.y - ny}
                      x2={to.x - nx}
                      y2={to.y - ny}
                      stroke={stroke}
                      strokeWidth={1.5}
                      markerEnd="url(#arrow)"
                    />
                  </>
                ) : (
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={stroke}
                    strokeWidth={1}
                    strokeDasharray={edge.status === 'pending' ? '4 3' : undefined}
                    markerEnd="url(#arrow)"
                  />
                )}
                <line
                  data-testid={`edge-hit-${edge.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="transparent"
                  strokeWidth={12}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ cursor: 'help' }}
                >
                  <title>{edge.type}</title>
                </line>
                {hoveredEdge === edge.id ? (
                  <text
                    data-testid={`edge-label-${edge.id}`}
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--ink-500)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {edge.type}
                  </text>
                ) : null}
              </g>
            );
          })}
          {nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) {
              return null;
            }
            const isSelected = selected === node.id;
            const size = isSelected ? 20 : 14;
            const dimmed =
              hoveredNode !== null && node.id !== hoveredNode && !neighbors.has(node.id);
            return (
              <g
                key={node.id}
                data-testid={`node-${node.id}`}
                data-entering={entering.has(node.id) ? 'true' : undefined}
                transform={`translate(${point.x}, ${point.y})`}
                onClick={() => void onExpand(node)}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void onExpand(node);
                  }
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                opacity={dimmed ? 0.35 : 1}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={`节点 ${node.name}`}
              >
                <title>
                  {node.name} · {node.type}
                </title>
                <g className={entering.has(node.id) ? 'graph-node-enter' : undefined}>
                  {isSelected ? (
                    <circle
                      r={size + 6}
                      fill="var(--accent)"
                      opacity={0.12}
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : null}
                  {shapeFor(node, isSelected, size)}
                  <g color="var(--ink-700)" style={{ pointerEvents: 'none' }}>
                    <NodeIcon type={node.type} />
                  </g>
                  {labelVisible(nodes.length, node.id, {
                    selected,
                    hovered: hoveredNode,
                    neighbors,
                  }) ? (
                    <text y={size + 14} textAnchor="middle" fontSize={12} fill="var(--ink-700)">
                      {node.name.slice(0, 16)}
                    </text>
                  ) : null}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      {selected && !edges.some((edge) => edge.fromId === selected || edge.toId === selected) ? (
        <p data-testid="graph2d-no-neighbor" className="graph-2d-note">
          该概念暂未建立关系
        </p>
      ) : null}
      <div className="graph-2d-legend" aria-label="图例">
        {(
          [
            ['concept', '概念'],
            ['technology', '技术'],
            ['project', '项目'],
            ['agent', 'Agent'],
            ['protocol', '协议'],
          ] as const
        ).map(([type, label]) => (
          <span key={type} className="row" style={{ gap: 4 }}>
            <span style={{ color: 'var(--ink-700)', display: 'inline-flex' }}>
              <NodeIcon type={type} />
            </span>
            {label}
          </span>
        ))}
        <span className="row" style={{ gap: 4 }}>
          <span className="legend-line" />
          事实
        </span>
        <span className="row" style={{ gap: 4 }}>
          <span className="legend-line dashed" />
          待定
        </span>
        <span className="row" style={{ gap: 4 }}>
          <span className="legend-line conflict" />
          冲突
        </span>
      </div>
    </div>
  );
});

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import type { GraphEdge, GraphNode } from '../../features/schemas.js';
import { useTheme } from '../../lib/theme.js';
import {
  labelVisible,
  neighborsOf,
  toGraph3DData,
  type Graph3DLink,
  type Graph3DNode,
} from './graph-data.js';
import { geometryFor, graphPalette, type NodeGeometry } from './graph-style.js';

export interface Graph3DViewHandle {
  focusNode(id: string): void;
  resetView(): void;
}

export interface Graph3DViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onExpand: (node: GraphNode) => void;
  onEngineStop?: () => void;
  onCameraChange?: (position: { x: number; y: number; z: number }) => void;
  onContextLost?: () => void;
  onSlow?: () => void;
}

type GraphMethods = ForceGraphMethods<
  NodeObject<Graph3DNode>,
  LinkObject<Graph3DNode, Graph3DLink>
>;

const DEFAULT_CAMERA = { x: 0, y: 0, z: 450 };
const FOCUS_DISTANCE = 120;
const DOUBLE_CLICK_MS = 350;

function createGeometry(shape: NodeGeometry, size: number): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(size * 1.7, size * 1.7, size * 1.7);
    case 'prism':
      return new THREE.CylinderGeometry(size, size, size * 2.2, 6);
    case 'tetra':
      return new THREE.TetrahedronGeometry(size * 1.5);
    case 'octa':
      return new THREE.OctahedronGeometry(size * 1.5);
    default:
      return new THREE.SphereGeometry(size, 16, 12);
  }
}

export const Graph3DView = forwardRef<Graph3DViewHandle, Graph3DViewProps>(function Graph3DView(
  {
    nodes,
    edges,
    selected,
    onSelect,
    onExpand,
    onEngineStop,
    onCameraChange,
    onContextLost,
    onSlow,
  },
  ref,
) {
  const { resolved } = useTheme();
  const palette = graphPalette(resolved);
  const graphRef = useRef<GraphMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [hovered, setHovered] = useState<string | null>(null);
  const lastNodeClick = useRef<{ id: string; at: number } | null>(null);
  const lastBackgroundClick = useRef(0);
  const firstFrameAt = useRef<number | null>(null);
  const slowReported = useRef(false);

  const data = useMemo(() => toGraph3DData(nodes, edges), [nodes, edges]);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const neighbors = useMemo(
    () => (hovered ? neighborsOf(edges, hovered) : new Set<string>()),
    [edges, hovered],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      setSize({
        width: element.clientWidth || 900,
        height: element.clientHeight || 620,
      });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setSize({
          width: Math.max(rect.width, 320),
          height: Math.max(rect.height, 620),
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const engineStopRef = useRef(onEngineStop);
  useEffect(() => {
    engineStopRef.current = onEngineStop;
  }, [onEngineStop]);

  useEffect(() => {
    const fitTimer = setTimeout(() => {
      graphRef.current?.cameraPosition({ x: 0, y: 0, z: 450 }, { x: 0, y: 0, z: 0 }, 600);
      engineStopRef.current?.();
    }, 2500);
    return () => clearTimeout(fitTimer);
  }, [data.nodes.length]);

  const reportCamera = useCallback(() => {
    const camera = graphRef.current?.camera();
    if (!camera || !onCameraChange) {
      return;
    }
    onCameraChange({
      x: Number(camera.position.x.toFixed(1)),
      y: Number(camera.position.y.toFixed(1)),
      z: Number(camera.position.z.toFixed(1)),
    });
  }, [onCameraChange]);

  useEffect(() => {
    const timer = setInterval(reportCamera, 750);
    return () => clearInterval(timer);
  }, [reportCamera]);

  useEffect(() => {
    graphRef.current?.refresh();
  }, [selected, hovered]);

  useEffect(() => {
    if (!onContextLost) {
      return;
    }
    const attach = () => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (!canvas) {
        return undefined;
      }
      const handler = (event: Event) => {
        event.preventDefault();
        onContextLost();
      };
      canvas.addEventListener('webglcontextlost', handler);
      return () => canvas.removeEventListener('webglcontextlost', handler);
    };
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(() => {
      cleanup = attach();
    }, 0);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [onContextLost]);

  useEffect(() => {
    if (firstFrameAt.current === null) {
      firstFrameAt.current = performance.now();
    }
    const started = firstFrameAt.current;
    let frames = 0;
    let frameHandle = 0;
    const sampleStart = performance.now();

    const count = () => {
      frames += 1;
      frameHandle = requestAnimationFrame(count);
    };
    frameHandle = requestAnimationFrame(count);

    const timer = setTimeout(() => {
      cancelAnimationFrame(frameHandle);
      if (slowReported.current || !onSlow) {
        return;
      }
      const elapsed = Math.max(performance.now() - sampleStart, 1);
      const fps = (frames / elapsed) * 1000;
      const firstFrameMs = performance.now() - started;
      if (firstFrameMs > 4000 || fps < 20) {
        slowReported.current = true;
        onSlow();
      }
    }, 5000);

    return () => {
      cancelAnimationFrame(frameHandle);
      clearTimeout(timer);
    };
  }, [onSlow]);

  const focusNode = useCallback(
    (id: string) => {
      const attempt = (tries: number) => {
        const graph = graphRef.current;
        const node = dataRef.current.nodes.find((item) => item.id === id);
        if (!graph || !node) {
          if (tries < 10) {
            window.setTimeout(() => attempt(tries + 1), 100);
          }
          return;
        }
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const z = node.z ?? 0;
        const distance = Math.hypot(x, y, z) || 1;
        const ratio = 1 + FOCUS_DISTANCE / distance;
        graph.cameraPosition({ x: x * ratio, y: y * ratio, z: z * ratio }, { x, y, z }, 800);
        setHovered(id);
        onSelect(id);
      };
      attempt(0);
    },
    [onSelect],
  );

  const resetView = useCallback(() => {
    graphRef.current?.cameraPosition(DEFAULT_CAMERA, { x: 0, y: 0, z: 0 }, 600);
    onCameraChange?.(DEFAULT_CAMERA);
  }, [onCameraChange]);

  useImperativeHandle(ref, () => ({ focusNode, resetView }), [focusNode, resetView]);

  const nodeThreeObject = useCallback(
    (node: Graph3DNode) => {
      const isSelected = selected === node.id;
      const isNeighbor = neighbors.has(node.id);
      const dimmed = hovered !== null && node.id !== hovered && !isNeighbor;
      const size = isSelected ? 12 : 9;
      const material = new THREE.MeshLambertMaterial({
        color: isSelected ? palette.selected : palette.node,
        transparent: true,
        opacity: dimmed ? 0.32 : 1,
      });
      const mesh = new THREE.Mesh(createGeometry(geometryFor(node.type), size), material);

      if (
        labelVisible(data.nodes.length, node.id, {
          selected,
          hovered,
          neighbors,
        })
      ) {
        const label = new SpriteText(node.name.slice(0, 16));
        label.color = palette.text;
        label.textHeight = 7;
        label.position.y = size + 6;
        label.material.depthWrite = false;
        mesh.add(label);
      }

      return mesh;
    },
    [data.nodes.length, hovered, neighbors, palette, selected],
  );

  const handleNodeClick = useCallback(
    (node: Graph3DNode) => {
      const now = performance.now();
      const last = lastNodeClick.current;
      const original = nodes.find((item) => item.id === node.id) ?? node;
      onSelect(node.id);
      onExpand(original as GraphNode);
      if (last && last.id === node.id && now - last.at < DOUBLE_CLICK_MS) {
        focusNode(node.id);
      }
      lastNodeClick.current = { id: node.id, at: now };
    },
    [focusNode, nodes, onExpand, onSelect],
  );

  const handleBackgroundClick = useCallback(() => {
    const now = performance.now();
    if (now - lastBackgroundClick.current < DOUBLE_CLICK_MS) {
      resetView();
    }
    lastBackgroundClick.current = now;
    onSelect(null);
    setHovered(null);
  }, [onSelect, resetView]);

  return (
    <div
      ref={containerRef}
      className="graph-3d"
      data-testid="graph3d-view"
      data-hovered={hovered ?? ''}
    >
      <ForceGraph3D<Graph3DNode, Graph3DLink>
        ref={graphRef}
        graphData={data}
        width={size.width}
        height={size.height}
        backgroundColor={palette.canvas}
        controlType="orbit"
        showNavInfo={false}
        cooldownTicks={120}
        warmupTicks={40}
        enableNodeDrag={false}
        nodeRelSize={5}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={(link) => (link.type === 'CONFLICTS_WITH' ? palette.conflict : palette.link)}
        linkWidth={(link) => (link.type === 'CONFLICTS_WITH' ? 1.4 : 0.6)}
        linkOpacity={0.35}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        onNodeHover={(node) => setHovered(node ? String(node.id) : null)}
        onBackgroundClick={handleBackgroundClick}
      />
    </div>
  );
});

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, EmptyState, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import {
  useConfirmRelation,
  useEntityMentions,
  useGraphEntry,
  useGraphPending,
  useWikiEntities,
} from '../../features/hooks.js';
import { GraphNeighborhoodSchema, type GraphEdge, type GraphNode } from '../../features/schemas.js';
import { apiFetch, errorMessage } from '../../lib/api-client.js';
import { shouldAggregate, shouldHideLabels } from '../../lib/graph.js';

const TYPE_LABELS: Record<string, string> = {
  concept: '概念',
  technology: '技术',
  project: '项目',
  agent: 'Agent',
  protocol: '协议',
};

const WIDTH = 900;
const HEIGHT = 620;

function positionOf(node: GraphNode, index: number): { x: number; y: number } {
  const hash = [...node.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const angle = ((index * 137.508 + (hash % 23)) * Math.PI) / 180;
  const radius = 110 + (index % 4) * 70;
  return { x: WIDTH / 2 + radius * Math.cos(angle), y: HEIGHT / 2 + radius * Math.sin(angle) };
}

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

export function GraphPage() {
  const entry = useGraphEntry();
  const toast = useToast();
  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map());
  const [edges, setEdges] = useState<Map<string, GraphEdge>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [drawerTab, setDrawerTab] = useState<'detail' | 'relations' | 'sources'>('detail');
  const [listView, setListView] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 767,
  );
  const [clusterType, setClusterType] = useState<string | null>(null);

  const searchEntities = useWikiEntities(search.trim() || undefined);
  const mentions = useEntityMentions(selected ?? undefined);
  const pendingRelations = useGraphPending();
  const confirmRelation = useConfirmRelation();

  useEffect(() => {
    if (nodes.size > 0 || !entry.data) {
      return;
    }
    const initial = new Map<string, GraphNode>();
    for (const item of entry.data) {
      initial.set(item.node.id, item.node);
    }
    setNodes(initial);
  }, [entry.data, nodes.size]);

  const mergeNeighborhood = (payload: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
    setNodes((current) => {
      const next = new Map(current);
      for (const node of payload.nodes) {
        next.set(node.id, node);
      }
      return next;
    });
    setEdges((current) => {
      const next = new Map(current);
      for (const edge of payload.edges) {
        next.set(edge.id, edge);
      }
      return next;
    });
  };

  const expand = async (node: GraphNode) => {
    setSelected(node.id);
    setDrawerTab('detail');
    if (expanded.has(node.id) || loadingId) {
      return;
    }
    setLoadingId(node.id);
    try {
      const response = await apiFetch(`/graph/entities/${node.id}/neighbors?hops=1`);
      mergeNeighborhood(GraphNeighborhoodSchema.parse(response));
      setExpanded((current) => new Set(current).add(node.id));
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const visibleNodes = useMemo(() => {
    const all = [...nodes.values()];
    if (clusterType) {
      return all.filter((node) => node.type === clusterType).slice(0, 50);
    }
    return all;
  }, [nodes, clusterType]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    visibleNodes.forEach((node, index) => map.set(node.id, positionOf(node, index)));
    return map;
  }, [visibleNodes]);

  const selectedNode = selected ? nodes.get(selected) : null;
  const selectedEdges = selected
    ? [...edges.values()].filter((edge) => edge.fromId === selected || edge.toId === selected)
    : [];

  const nodeLabel = (id: string) => nodes.get(id)?.name ?? id;

  const aggregate = shouldAggregate(nodes.size) && !clusterType;
  const typeCounts = [...nodes.values()].reduce<Record<string, number>>((acc, node) => {
    acc[node.type] = (acc[node.type] ?? 0) + 1;
    return acc;
  }, {});

  if (entry.isLoading) {
    return (
      <div className="page">
        <SkeletonList />
      </div>
    );
  }
  if (entry.isError) {
    return (
      <div className="page">
        <ErrorState message={errorMessage(entry.error)} />
      </div>
    );
  }
  if (entry.data && entry.data.length === 0) {
    return (
      <div className="page">
        <PageHeader title="知识图谱" subtitle="实体与关系来自 V1.5 的抽取结果" />
        <EmptyState
          title="还没有足够的关系"
          description="导入材料并完成抽取后，实体与关系会出现在这里。"
        />
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: 12 }}>
      <PageHeader
        title="知识图谱"
        subtitle={
          aggregate
            ? '当前视图过大，已按类型聚合'
            : `显示高频概念，搜索或点击节点查看关系（节点 ${nodes.size}）`
        }
        actions={
          <button type="button" className="btn" onClick={() => setListView((value) => !value)}>
            {listView ? '图形视图' : '列表视图'}
          </button>
        }
      />

      {aggregate ? (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          当前视图已聚合。{' '}
          <button type="button" className="btn sm" onClick={() => setListView(true)}>
            切换到列表视图
          </button>
        </div>
      ) : null}

      {!listView ? (
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                className="input"
                style={{ width: 220 }}
                placeholder="搜索实体"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="搜索实体"
              />
              {loadingId ? <span className="tiny muted">展开中…</span> : null}
            </div>
            {search.trim().length > 0 && searchEntities.data ? (
              <div
                className="card card-pad"
                style={{ marginBottom: 8, maxHeight: 140, overflowY: 'auto' }}
              >
                {searchEntities.data.slice(0, 8).map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    className="btn ghost sm"
                    onClick={() => {
                      const node: GraphNode = {
                        id: entity.id,
                        name: entity.canonicalName,
                        type: entity.type,
                        aliases: entity.aliases,
                        mentionCount: entity.mentionCount,
                        confidence: entity.confidence,
                        mergedIntoId: null,
                      };
                      mergeNeighborhood({ nodes: [node], edges: [] });
                      setSearch('');
                      void expand(node);
                    }}
                  >
                    {entity.canonicalName}
                  </button>
                ))}
              </div>
            ) : null}

            <div
              style={{
                position: 'relative',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-o)',
                background: 'var(--paper-1)',
                overflow: 'hidden',
              }}
            >
              {aggregate ? (
                <div
                  className="row"
                  style={{ padding: 24, gap: 16, flexWrap: 'wrap', minHeight: 260 }}
                >
                  {Object.entries(typeCounts).map(([type, count]) => (
                    <button
                      key={type}
                      type="button"
                      className="card card-pad"
                      style={{ width: 140 }}
                      onClick={() => setClusterType(type)}
                    >
                      <strong>{TYPE_LABELS[type] ?? type}</strong>
                      <p className="tiny muted">{count} 个节点</p>
                    </button>
                  ))}
                </div>
              ) : (
                <svg
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                  role="img"
                  aria-label="知识图谱"
                  onDoubleClick={() => {
                    setSelected(null);
                    setClusterType(null);
                  }}
                >
                  <defs>
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
                  {[...edges.values()].map((edge) => {
                    const from = positions.get(edge.fromId);
                    const to = positions.get(edge.toId);
                    if (!from || !to) {
                      return null;
                    }
                    return (
                      <line
                        key={edge.id}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={
                          edge.type === 'CONFLICTS_WITH' ? 'var(--danger)' : 'var(--line-strong)'
                        }
                        strokeWidth={edge.type === 'CONFLICTS_WITH' ? 1.5 : 1}
                        strokeDasharray={edge.status === 'pending' ? '4 3' : undefined}
                        markerEnd="url(#arrow)"
                      >
                        <title>{edge.type}</title>
                      </line>
                    );
                  })}
                  {visibleNodes.map((node) => {
                    const point = positions.get(node.id)!;
                    const isSelected = selected === node.id;
                    const size = isSelected ? 20 : 14;
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${point.x}, ${point.y})`}
                        onClick={() => void expand(node)}
                        style={{ cursor: 'pointer' }}
                        role="button"
                        aria-label={`节点 ${node.name}`}
                      >
                        <title>
                          {node.name} · {TYPE_LABELS[node.type] ?? node.type}
                        </title>
                        {shapeFor(node, isSelected, size)}
                        {!shouldHideLabels(visibleNodes.length) || isSelected ? (
                          <text
                            y={size + 14}
                            textAnchor="middle"
                            fontSize={12}
                            fill="var(--ink-700)"
                          >
                            {node.name.slice(0, 16)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              {clusterType
                ? `已展开 ${TYPE_LABELS[clusterType] ?? clusterType} 的前 50 个节点`
                : '默认显示高频概念，不是全图；点击节点展开一跳邻居。'}
            </p>
          </div>

          {selectedNode ? (
            <aside className="card card-pad" style={{ width: 360, flex: '0 0 360px' }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <strong>{selectedNode.name}</strong>
                <button type="button" className="btn ghost sm" onClick={() => setSelected(null)}>
                  关闭
                </button>
              </div>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                {(['detail', 'relations', 'sources'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`btn sm ${drawerTab === tab ? 'primary' : 'ghost'}`}
                    onClick={() => setDrawerTab(tab)}
                  >
                    {tab === 'detail' ? '详情' : tab === 'relations' ? '关系' : '来源'}
                  </button>
                ))}
              </div>

              {drawerTab === 'detail' ? (
                <div className="stack" style={{ gap: 6 }}>
                  <p className="tiny">
                    类型：{TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                  </p>
                  <p className="tiny">别名：{selectedNode.aliases.join(' / ') || '无'}</p>
                  <p className="tiny">提及次数：{selectedNode.mentionCount}</p>
                  <p className="tiny">置信度：{selectedNode.confidence.toFixed(2)}</p>
                </div>
              ) : null}

              {drawerTab === 'relations' ? (
                <div className="stack" style={{ gap: 8 }}>
                  {selectedEdges.length === 0 ? (
                    <p className="tiny muted">该概念暂未建立关系。</p>
                  ) : (
                    selectedEdges.map((edge) => (
                      <div key={edge.id} className="tiny">
                        <Badge tone={edge.status === 'pending' ? 'warn' : ''}>{edge.type}</Badge>{' '}
                        {edge.fromId === selectedNode.id ? '→' : '←'}{' '}
                        {nodeLabel(edge.fromId === selectedNode.id ? edge.toId : edge.fromId)} ·
                        证据 {edge.evidenceChunkIds.length}
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {drawerTab === 'sources' ? (
                <div className="stack" style={{ gap: 8 }}>
                  {mentions.data?.length ? (
                    mentions.data.map((mention) => (
                      <Link
                        key={mention.id}
                        className="tiny"
                        to={`/documents/${mention.chunk.documentId}?chunk=${mention.chunkId}&entity=${selectedNode.id}`}
                      >
                        定位：{mention.chunk.text.slice(0, 30)}…
                      </Link>
                    ))
                  ) : (
                    <p className="tiny muted">暂无来源。</p>
                  )}
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {visibleNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className="card card-pad list-row"
              onClick={() => void expand(node)}
            >
              <span>
                <strong>{node.name}</strong>{' '}
                <span className="tiny muted">
                  {TYPE_LABELS[node.type] ?? node.type} · {node.mentionCount} 次提及
                </span>
              </span>
              <span className="tiny muted">{node.aliases.join(' / ')}</span>
            </button>
          ))}
        </div>
      )}

      {pendingRelations.data && pendingRelations.data.length > 0 ? (
        <section className="card card-pad" style={{ marginTop: 12 }}>
          <h3>待定关系</h3>
          <p className="tiny muted" style={{ marginBottom: 8 }}>
            低置信度或单次抽取的弱关系不进入图谱，确认后才会生效。
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {pendingRelations.data.slice(0, 20).map((edge) => (
              <div key={edge.id} className="between">
                <span className="tiny">
                  {nodeLabel(edge.fromId)} —{edge.type}→ {nodeLabel(edge.toId)} ·{' '}
                  {edge.confidence.toFixed(2)}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={confirmRelation.isPending}
                  onClick={() =>
                    confirmRelation.mutate(edge.id, {
                      onSuccess: () => toast('关系已确认并入图'),
                      onError: (error) => toast(errorMessage(error), 'error'),
                    })
                  }
                >
                  确认入图
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

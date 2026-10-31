import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import {
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  SkeletonList,
  StatusBadge,
  useToast,
} from '../../components/ui.js';
import {
  useChunks,
  useDeleteDocument,
  useDocument,
  useUpdateDocument,
} from '../../features/hooks.js';
import { errorMessage } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const documentQuery = useDocument(id);
  const currentVersion = documentQuery.data?.currentVersion;
  const chunks = useChunks(currentVersion?.id);
  const update = useUpdateDocument();
  const remove = useDeleteDocument();
  const [editing, setEditing] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const targetChunk = params.get('chunk');

  useEffect(() => {
    if (!targetChunk || !chunks.data) {
      return;
    }
    const element = document.querySelector(`[data-chunk-id="${CSS.escape(targetChunk)}"]`);
    if (element) {
      element.scrollIntoView({ block: 'center' });
      setHighlightId(targetChunk);
      const timer = setTimeout(() => setHighlightId(null), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [targetChunk, chunks.data]);

  const headings = useMemo(() => {
    const items = chunks.data?.items ?? [];
    return items.map((chunk) => ({
      id: chunk.id,
      label:
        chunk.headingPath.length > 0 ? chunk.headingPath.join(' › ') : `块 ${chunk.chunkIndex + 1}`,
      page: chunk.pageStart,
    }));
  }, [chunks.data]);

  if (documentQuery.isPending) {
    return (
      <div className="page">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (documentQuery.isError || !documentQuery.data) {
    return (
      <div className="page">
        <ErrorState
          message={errorMessage(documentQuery.error)}
          onRetry={() => void documentQuery.refetch()}
        />
      </div>
    );
  }

  const data = documentQuery.data;
  const status = data.currentVersion?.status ?? 'queued';

  return (
    <div className="page">
      <PageHeader
        title={data.title}
        subtitle={`v${data.currentVersion?.versionNo ?? 1} · ${data.currentVersion?.charCount ?? 0} 字${
          data.currentVersion?.pageCount ? ` · ${data.currentVersion.pageCount} 页` : ''
        } · 更新于 ${formatDateTime(data.updatedAt)}`}
        actions={
          <>
            <StatusBadge status={status} />
            <button type="button" className="btn sm" onClick={() => setEditing(true)}>
              编辑
            </button>
            <button
              type="button"
              className="btn sm danger"
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm('删除后文档会从知识库隐藏，原始文件仍保留。确定删除？')) {
                  return;
                }
                remove.mutate(data.id, {
                  onSuccess: () => {
                    toast('已逻辑删除');
                    navigate('/library');
                  },
                  onError: (error) => toast(errorMessage(error), 'error'),
                });
              }}
            >
              删除
            </button>
          </>
        }
      />

      <div className="row tiny muted" style={{ marginBottom: 20 }}>
        {data.tags.length > 0 ? (
          data.tags.map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))
        ) : (
          <span>没有标签</span>
        )}
        <span>·</span>
        <span>
          来源：
          {data.sources
            .map(
              (item) =>
                `${item.source.type === 'file' ? '文件' : item.source.type === 'url' ? '网页' : '手动'}`,
            )
            .join('、') || '—'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 24 }}>
        <div>
          {chunks.isPending && status === 'ready' ? <SkeletonList rows={5} /> : null}
          {chunks.isError ? (
            <ErrorState
              message={errorMessage(chunks.error)}
              onRetry={() => void chunks.refetch()}
            />
          ) : null}
          {chunks.data && chunks.data.items.length === 0 ? (
            <EmptyState
              title="还没有可阅读的块"
              description="处理完成后，这里会按块展示正文与块边界。"
            />
          ) : null}
          {chunks.data && chunks.data.items.length > 0 ? (
            <article className="card" style={{ padding: '12px 8px' }}>
              {chunks.data.items.map((chunk) => (
                <section
                  key={chunk.id}
                  className="chunk"
                  data-chunk-id={chunk.id}
                  data-highlight={highlightId === chunk.id}
                  id={`chunk-${chunk.id}`}
                >
                  <div className="chunk-meta">
                    块 {chunk.chunkIndex + 1} · {chunk.tokenCount} tokens
                    {chunk.pageStart ? ` · 第 ${chunk.pageStart} 页` : ''}
                    {chunk.headingPath.length > 0 ? ` · ${chunk.headingPath.join(' › ')}` : ''}
                  </div>
                  {chunk.text}
                </section>
              ))}
            </article>
          ) : null}
        </div>

        <aside className="stack" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
          <section className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>块索引</h3>
            {headings.length === 0 ? (
              <p className="tiny muted">暂无块。</p>
            ) : (
              <div className="stack" style={{ gap: 2, maxHeight: 320, overflowY: 'auto' }}>
                {headings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className="side-item"
                    onClick={() => {
                      const element = document.querySelector(
                        `[data-chunk-id="${CSS.escape(heading.id)}"]`,
                      );
                      element?.scrollIntoView({ block: 'center' });
                      setHighlightId(heading.id);
                      setTimeout(() => setHighlightId(null), 2000);
                    }}
                  >
                    <span className="truncate">{heading.label}</span>
                    {heading.page ? <span className="count">p{heading.page}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>版本</h3>
            <div className="stack" style={{ gap: 6 }}>
              {data.versions.map((version) => (
                <div key={version.id} className="between tiny">
                  <span>
                    v{version.versionNo}
                    {version.isCurrent ? ' · 当前' : ''}
                  </span>
                  <StatusBadge status={version.status} />
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {editing ? (
        <EditDrawer
          title={data.title}
          tags={data.tags}
          busy={update.isPending}
          onClose={() => setEditing(false)}
          onSave={(input) =>
            update.mutate(
              { id: data.id, ...input },
              {
                onSuccess: () => {
                  toast('已保存');
                  setEditing(false);
                },
                onError: (error) => toast(errorMessage(error), 'error'),
              },
            )
          }
        />
      ) : null}

      {status !== 'ready' ? (
        <p className="tiny muted" style={{ marginTop: 16 }}>
          处理状态：<Link to="/jobs">查看任务</Link>
        </p>
      ) : null}
    </div>
  );
}

function EditDrawer({
  title,
  tags,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  tags: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: { title: string; tags: string[] }) => void;
}) {
  const [nextTitle, setNextTitle] = useState(title);
  const [nextTags, setNextTags] = useState(tags.join(', '));

  return (
    <Drawer title="编辑文档" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            title: nextTitle.trim(),
            tags: nextTags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          });
        }}
      >
        <Field label="标题" htmlFor="edit-title">
          <input
            id="edit-title"
            className="input"
            value={nextTitle}
            onChange={(event) => setNextTitle(event.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field label="标签" htmlFor="edit-tags" hint="用逗号分隔">
          <input
            id="edit-tags"
            className="input"
            value={nextTags}
            onChange={(event) => setNextTags(event.target.value)}
          />
        </Field>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </form>
    </Drawer>
  );
}

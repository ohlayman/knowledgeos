import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useResolveStale, useWikiPage } from '../../features/hooks.js';

interface Paragraph {
  id: string;
  section: string;
  text: string;
  evidenceChunkIds: string[];
  origin: 'model' | 'human';
}

interface PageContent {
  summary: string;
  paragraphs: Paragraph[];
}

export function WikiPage() {
  const { slug } = useParams();
  const page = useWikiPage(slug);
  const resolveStale = useResolveStale(slug ?? '');
  const toast = useToast();

  if (page.isLoading) {
    return (
      <div className="page">
        <SkeletonList />
      </div>
    );
  }
  if (page.isError || !page.data) {
    return (
      <div className="page">
        <ErrorState message={errorMessage(page.error)} />
      </div>
    );
  }

  const detail = page.data;
  const content = (detail.currentRevision?.content as unknown as PageContent | null) ?? {
    summary: '',
    paragraphs: [],
  };
  const evidenceById = new Map(detail.evidence.map((item) => [item.id, item]));

  return (
    <div className="page">
      <PageHeader
        title={detail.title}
        subtitle={`${detail.type} · ${detail.aliases.length > 0 ? detail.aliases.join(' / ') : '暂无别名'}`}
        actions={
          <div className="row">
            <Link className="btn" to={`/wiki/${detail.slug}/history`}>
              版本历史
            </Link>
            <Link className="btn primary" to={`/wiki/${detail.slug}/edit`}>
              编辑
            </Link>
          </div>
        }
      />

      {detail.status === 'stale' ? (
        <div
          className="card card-pad"
          style={{ marginBottom: 12, borderColor: 'var(--state-warn-border)' }}
        >
          <div className="between">
            <span>该页面引用的来源已更新，内容可能过期。</span>
            <div className="row">
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  resolveStale.mutate('confirm', {
                    onSuccess: () => toast('已确认页面仍然有效'),
                    onError: (error) => toast(errorMessage(error), 'error'),
                  })
                }
              >
                确认仍有效
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  resolveStale.mutate('archive', {
                    onSuccess: () => toast('页面已归档'),
                    onError: (error) => toast(errorMessage(error), 'error'),
                  })
                }
              >
                归档
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detail.unresolvedConflicts > 0 ? (
        <div
          className="card card-pad"
          style={{ marginBottom: 12, borderColor: 'var(--state-danger-border)' }}
        >
          本页存在 {detail.unresolvedConflicts} 处未裁决冲突。{' '}
          <Link to="/wiki/conflicts">去裁决</Link>
        </div>
      ) : null}

      {content.summary ? <p className="muted">{content.summary}</p> : null}

      <div className="stack" style={{ gap: 16, marginTop: 16 }}>
        {content.paragraphs.map((paragraph) => (
          <section key={paragraph.id} className="card card-pad">
            <div className="between" style={{ marginBottom: 8 }}>
              <strong>{paragraph.section}</strong>
              <Badge tone={paragraph.origin === 'human' ? 'accent' : ''}>
                {paragraph.origin === 'human' ? '人工' : '模型'}
              </Badge>
            </div>
            <p style={{ marginBottom: 10 }}>{paragraph.text}</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {paragraph.evidenceChunkIds.map((chunkId, index) => {
                const chunk = evidenceById.get(chunkId);
                return chunk ? (
                  <Link
                    key={chunkId}
                    className="badge"
                    to={`/documents/${chunk.documentId}?chunk=${chunkId}`}
                  >
                    证据 {index + 1}
                  </Link>
                ) : (
                  <Badge key={chunkId} tone="bad">
                    证据缺失
                  </Badge>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {detail.outgoingLinks.length > 0 ? (
        <section className="card card-pad" style={{ marginTop: 16 }}>
          <h3>相关页面</h3>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {detail.outgoingLinks.map((link) => (
              <div key={link.id}>
                {link.relationType ? (
                  <span className="tiny muted">{link.relationType} → </span>
                ) : null}
                {link.toPage ? (
                  <Link to={`/wiki/${link.toPage.slug}`}>{link.toPage.title}</Link>
                ) : (
                  <span className="tiny muted">{link.targetSlug}（待创建）</span>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h3>被以下页面引用</h3>
        {detail.backlinks.length === 0 ? (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            暂无反向链接。
          </p>
        ) : (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {detail.backlinks.map((backlink) => (
              <div key={backlink.id}>
                <Link to={`/wiki/${backlink.fromPage.slug}`}>{backlink.fromPage.title}</Link>
                {backlink.context ? <p className="tiny muted">{backlink.context}</p> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

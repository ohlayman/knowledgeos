import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useRollbackWikiPage, useWikiDiff, useWikiPage } from '../../features/hooks.js';

interface Paragraph {
  id: string;
  section: string;
  text: string;
}

export function WikiHistoryPage() {
  const { slug } = useParams();
  const page = useWikiPage(slug);
  const toast = useToast();
  const rollback = useRollbackWikiPage(slug ?? '');
  const revisions = page.data?.revisions ?? [];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const diff = useWikiDiff(slug, from || undefined, to || undefined);

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

  const fromId = from || revisions[1]?.id || revisions[0]?.id || '';
  const toId = to || revisions[0]?.id || '';

  return (
    <div className="page">
      <PageHeader title={`${page.data.title} · 版本历史`} subtitle="每次落库都会生成新版本" />

      <div className="stack" style={{ gap: 8 }}>
        {revisions.map((revision) => (
          <div key={revision.id} className="card card-pad list-row">
            <div className="stack" style={{ gap: 4 }}>
              <div className="row">
                <strong>v{revision.revisionNo}</strong>
                <Badge tone={revision.editorType === 'human' ? 'accent' : ''}>
                  {revision.editorType}
                </Badge>
              </div>
              <span className="tiny muted">
                {revision.changeSummary || '无变更说明'} ·{' '}
                {new Date(revision.createdAt).toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={rollback.isPending || revision.id === page.data.currentRevisionId}
              onClick={() => {
                const reason = window.prompt('回滚原因');
                if (!reason) {
                  return;
                }
                rollback.mutate(
                  { targetRevisionId: revision.id, reason },
                  {
                    onSuccess: () => toast('已回滚，并生成新版本'),
                    onError: (error) => toast(errorMessage(error), 'error'),
                  },
                );
              }}
            >
              回滚到此版本
            </button>
          </div>
        ))}
      </div>

      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h3>版本对照</h3>
        <div className="row" style={{ marginTop: 8 }}>
          <select
            className="select"
            value={fromId}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="对照起始版本"
          >
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                v{revision.revisionNo}
              </option>
            ))}
          </select>
          <span>→</span>
          <select
            className="select"
            value={toId}
            onChange={(event) => setTo(event.target.value)}
            aria-label="对照目标版本"
          >
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                v{revision.revisionNo}
              </option>
            ))}
          </select>
        </div>

        {diff.data ? (
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            <p className="tiny muted">
              新增 {diff.data.added.length} 段，删除 {diff.data.removed.length} 段，修改{' '}
              {diff.data.changed.length} 段
            </p>
            {diff.data.added.map((item) => {
              const paragraph = item as Paragraph;
              return (
                <div
                  key={`add-${paragraph.id}`}
                  style={{ borderLeft: '3px solid var(--success)', paddingLeft: 8 }}
                >
                  <strong className="tiny">新增 · {paragraph.section}</strong>
                  <p className="tiny">{paragraph.text}</p>
                </div>
              );
            })}
            {diff.data.removed.map((item) => {
              const paragraph = item as Paragraph;
              return (
                <div
                  key={`remove-${paragraph.id}`}
                  style={{ borderLeft: '3px solid var(--danger)', paddingLeft: 8 }}
                >
                  <strong className="tiny">删除 · {paragraph.section}</strong>
                  <p className="tiny">{paragraph.text}</p>
                </div>
              );
            })}
            {diff.data.changed.map((item, index) => {
              const change = item as { before: Paragraph; after: Paragraph };
              return (
                <div
                  key={`change-${index}`}
                  style={{ borderLeft: '3px solid var(--warning)', paddingLeft: 8 }}
                >
                  <strong className="tiny">修改 · {change.after.section}</strong>
                  <p className="tiny muted">{change.before.text}</p>
                  <p className="tiny">{change.after.text}</p>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

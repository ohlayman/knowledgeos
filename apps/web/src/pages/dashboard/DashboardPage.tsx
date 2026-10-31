import { Link } from 'react-router-dom';
import { MetricCard, PageHeader, StorageMetric } from '../../components/business.js';
import { EmptyState, ErrorState, SkeletonList, StatusBadge } from '../../components/ui.js';
import { useMetrics } from '../../features/hooks.js';
import { formatRelative, statusLabel } from '../../lib/format.js';
import { errorMessage } from '../../lib/api-client.js';

export function DashboardPage() {
  const metrics = useMetrics();

  if (metrics.isPending) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" subtitle="知识库现状与最近活动" />
        <div className="grid grid-6" style={{ marginBottom: 24 }}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 94 }} />
          ))}
        </div>
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (metrics.isError) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" />
        <ErrorState message={errorMessage(metrics.error)} onRetry={() => void metrics.refetch()} />
      </div>
    );
  }

  const data = metrics.data;

  if (data.documents.total === 0) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" subtitle="知识库现状与最近活动" />
        <EmptyState
          title="知识库还是空的"
          description="先导入一份材料，处理完成后这里会显示文档、Chunk 与任务的状态。"
          action={
            <Link className="btn primary" to="/library">
              去导入
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle="知识库现状与最近活动" />

      <div className="grid grid-6" style={{ marginBottom: 28 }}>
        <MetricCard label="文档" value={data.documents.total} to="/library" />
        <MetricCard label="已就绪" value={data.documents.ready} to="/library?status=ready" />
        <MetricCard
          label="处理中"
          value={data.documents.processing}
          to="/library?status=processing"
        />
        <MetricCard
          label="失败"
          value={data.documents.failed}
          note={data.documents.failed > 0 ? '点击查看' : undefined}
          to="/jobs?status=failed"
        />
        <MetricCard
          label="Chunk"
          value={data.chunks.total}
          note={`向量就绪 ${data.chunks.vectorReady}`}
        />
        <StorageMetric bytes={data.storage.bytes} />
      </div>

      <div className="grid grid-2">
        <section className="card card-pad">
          <div className="between" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>最近文档</h2>
            <Link className="tiny" to="/library">
              全部
            </Link>
          </div>
          {data.recentDocuments.length === 0 ? (
            <p className="tiny muted">还没有文档。</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {data.recentDocuments.map((document) => (
                <Link
                  key={document.id}
                  to={`/documents/${document.id}`}
                  className="list-row"
                  style={{ border: 0, padding: '6px 0' }}
                >
                  <span className="grow truncate">{document.title}</span>
                  <StatusBadge status={document.status} />
                  <span className="tiny muted">{formatRelative(document.updatedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card card-pad">
          <div className="between" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>最近任务</h2>
            <Link className="tiny" to="/jobs">
              全部
            </Link>
          </div>
          {data.recentJobs.length === 0 ? (
            <p className="tiny muted">还没有任务。</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {data.recentJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs?job=${job.id}`}
                  className="list-row"
                  style={{ border: 0, padding: '6px 0' }}
                >
                  <span className="grow truncate">{job.documentTitle}</span>
                  <span className="tiny muted">
                    {job.currentStep ? statusLabel(job.currentStep) : '—'}
                  </span>
                  <StatusBadge status={job.status} />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

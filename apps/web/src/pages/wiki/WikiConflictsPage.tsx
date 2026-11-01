import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, EmptyState, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useResolveConflict, useWikiConflicts } from '../../features/hooks.js';

const TYPE_LABELS: Record<string, string> = {
  numeric: '数值冲突',
  negation: '否定冲突',
  temporal: '时间性差异',
};

export function WikiConflictsPage() {
  const conflicts = useWikiConflicts();
  const resolve = useResolveConflict();
  const toast = useToast();

  return (
    <div className="page">
      <PageHeader
        title="冲突裁决"
        subtitle="冲突不合并；读完双方表述后选择保留哪一方或合并"
        actions={
          <Link className="btn" to="/wiki/review">
            返回审核队列
          </Link>
        }
      />

      {conflicts.isLoading ? <SkeletonList /> : null}
      {conflicts.isError ? <ErrorState message={errorMessage(conflicts.error)} /> : null}
      {conflicts.data && conflicts.data.length === 0 ? (
        <EmptyState
          title="没有未裁决冲突"
          description="系统检测到数值、否定或时间差异时会出现在这里。"
        />
      ) : null}

      <div className="stack" style={{ gap: 12 }}>
        {conflicts.data?.map((conflict) => (
          <section key={conflict.id} className="card card-pad">
            <div className="between" style={{ marginBottom: 8 }}>
              <div className="row">
                <Badge tone="warn">{TYPE_LABELS[conflict.type] ?? conflict.type}</Badge>
                {conflict.pageTitle ? (
                  <span className="tiny muted">
                    页面：
                    <Link to={`/wiki/review/${conflict.proposalId}`}>{conflict.pageTitle}</Link>
                  </span>
                ) : null}
              </div>
            </div>
            <p className="tiny muted">{conflict.detail}</p>
            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
              <span className="badge">A：{conflict.a?.value}</span>
              <span className="badge">B：{conflict.b?.value}</span>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              {[
                ['keep_a', '保留 A'],
                ['keep_b', '保留 B'],
                ['merge', '合并表述'],
                ['dismiss', '忽略'],
              ].map(([resolution, label]) => (
                <button
                  key={resolution}
                  type="button"
                  className="btn sm"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate(
                      { id: conflict.id, resolution: resolution! },
                      {
                        onSuccess: () => toast('冲突已裁决'),
                        onError: (error) => toast(errorMessage(error), 'error'),
                      },
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

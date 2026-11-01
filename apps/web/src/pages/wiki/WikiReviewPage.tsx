import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, EmptyState, ErrorState, SkeletonList } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useWikiProposals, useWikiReviewTasks } from '../../features/hooks.js';

const CHANGE_LABELS: Record<string, string> = {
  create: '新建页面',
  update: '更新页面',
  merge_suggestion: '合并建议',
  mark_stale: '标记过期',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  accepted: '已接受',
  rejected: '已拒绝',
  expired: '已过期',
  invalid: '无效',
};

export function WikiReviewPage() {
  const [status, setStatus] = useState('pending');
  const proposals = useWikiProposals(status);
  const tasks = useWikiReviewTasks('open');

  return (
    <div className="page">
      <PageHeader
        title="审核队列"
        subtitle={`待办 ${tasks.data?.length ?? 0} 条 · 按影响面与时间排序`}
        actions={
          <Link className="btn" to="/wiki/conflicts">
            冲突裁决
          </Link>
        }
      />

      <div className="row" style={{ marginBottom: 16 }}>
        <select
          className="select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="按提案状态筛选"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {proposals.isLoading ? <SkeletonList /> : null}
      {proposals.isError ? <ErrorState message={errorMessage(proposals.error)} /> : null}
      {proposals.data && proposals.data.length === 0 ? (
        <EmptyState title="没有待审核的提案" description="导入新材料后，系统会生成更新提案。" />
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        {proposals.data?.map((proposal) => {
          const conflicts = (proposal.conflicts as unknown[] | null) ?? [];
          return (
            <Link
              key={proposal.id}
              className="card card-pad list-row"
              to={`/wiki/review/${proposal.id}`}
            >
              <div className="stack" style={{ gap: 4 }}>
                <strong>
                  {CHANGE_LABELS[proposal.changeType] ?? proposal.changeType}
                  {proposal.targetPage ? ` · ${proposal.targetPage.title}` : ''}
                </strong>
                <span className="tiny muted">
                  {new Date(proposal.createdAt).toLocaleString()} · 冲突 {conflicts.length} 处
                </span>
              </div>
              <Badge tone={proposal.status === 'pending' ? 'warn' : ''}>
                {STATUS_LABELS[proposal.status] ?? proposal.status}
              </Badge>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

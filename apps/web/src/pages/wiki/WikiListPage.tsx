import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, EmptyState, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useCreateWikiPage, useWikiPages } from '../../features/hooks.js';

const TYPE_LABELS: Record<string, string> = {
  concept: '概念',
  technology: '技术',
  project: '项目',
  comparison: '对比',
  research: '研究',
  source: '来源',
};

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  proposed: '待审',
  published: '已发布',
  archived: '已归档',
  stale: '可能过期',
};

export function WikiListPage() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('');
  const [newType, setNewType] = useState('concept');
  const pages = useWikiPages({ type, status });
  const create = useCreateWikiPage();
  const toast = useToast();

  return (
    <div className="page">
      <PageHeader
        title="Wiki"
        subtitle="以概念为单位、每段都可回溯来源的知识页面"
        actions={
          <Link className="btn" to="/wiki/review">
            审核队列
          </Link>
        }
      />

      <div className="row" style={{ marginBottom: 16 }}>
        <select
          className="select"
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-label="按页面类型筛选"
        >
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="按页面状态筛选"
        >
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="新建页面标题"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="新建页面标题"
        />
        <select
          className="select"
          value={newType}
          onChange={(event) => setNewType(event.target.value)}
          aria-label="新建页面类型"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={title.trim().length === 0 || create.isPending}
          onClick={() =>
            create.mutate(
              { title: title.trim(), type: newType },
              {
                onSuccess: () => {
                  setTitle('');
                  toast('页面已创建');
                },
                onError: (error) => toast(errorMessage(error), 'error'),
              },
            )
          }
        >
          新建页面
        </button>
      </div>

      {pages.isLoading ? <SkeletonList /> : null}
      {pages.isError ? <ErrorState message={errorMessage(pages.error)} /> : null}
      {pages.data && pages.data.length === 0 ? (
        <EmptyState
          title="还没有 Wiki 页面"
          description="导入材料后，系统会生成待审页面提案；也可以手动创建。"
        />
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        {pages.data?.map((page) => (
          <Link key={page.id} className="card card-pad list-row" to={`/wiki/${page.slug}`}>
            <div className="stack" style={{ gap: 4 }}>
              <strong>{page.title}</strong>
              <span className="tiny muted">
                {TYPE_LABELS[page.type] ?? page.type} · {page.summary || '暂无摘要'}
              </span>
            </div>
            <Badge
              tone={page.status === 'stale' ? 'warn' : page.status === 'published' ? 'ok' : ''}
            >
              {STATUS_LABELS[page.status] ?? page.status}
            </Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

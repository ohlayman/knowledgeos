import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import {
  Badge,
  Drawer,
  EmptyState,
  ErrorState,
  SkeletonList,
  StatusBadge,
  useToast,
} from '../../components/ui.js';
import { useCancelJob, useJob, useJobs, useRetryJob } from '../../features/hooks.js';
import { errorMessage } from '../../lib/api-client.js';
import { formatDateTime, statusLabel } from '../../lib/format.js';

const STATUS_OPTIONS = [
  ['', '全部状态'],
  ['queued', '排队中'],
  ['running', '运行中'],
  ['succeeded', '已完成'],
  ['failed', '失败'],
  ['canceled', '已取消'],
] as const;

export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const selected = params.get('job') ?? undefined;
  const jobs = useJobs({ ...(status ? { status } : {}) });

  const openJob = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('job', id);
    setParams(next, { replace: true });
  };

  const closeJob = () => {
    const next = new URLSearchParams(params);
    next.delete('job');
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader title="任务" subtitle="处理流水线的每一步都可检查、可重试" />

      <div className="row" style={{ marginBottom: 16 }}>
        <select
          className="select"
          value={status}
          aria-label="按状态筛选任务"
          onChange={(event) => {
            const next = new URLSearchParams(params);
            if (event.target.value) {
              next.set('status', event.target.value);
            } else {
              next.delete('status');
            }
            setParams(next, { replace: true });
          }}
        >
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {jobs.isPending ? <SkeletonList rows={6} /> : null}
      {jobs.isError ? (
        <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
      ) : null}
      {jobs.data && jobs.data.items.length === 0 ? (
        <EmptyState
          title={status ? '没有该状态的任务' : '还没有任务'}
          description="导入材料后会自动创建处理任务。"
          action={
            status ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('status');
                  setParams(next, { replace: true });
                }}
              >
                查看全部
              </button>
            ) : (
              <Link className="btn primary" to="/library">
                去导入
              </Link>
            )
          }
        />
      ) : null}

      {jobs.data && jobs.data.items.length > 0 ? (
        <div className="list">
          {jobs.data.items.map((job) => (
            <button key={job.id} type="button" className="list-row" onClick={() => openJob(job.id)}>
              <div className="grow">
                <div className="truncate" style={{ fontWeight: 500 }}>
                  {job.document.title}
                </div>
                <div className="tiny muted">
                  v{job.version.versionNo} · {job.currentStep ? statusLabel(job.currentStep) : '—'}{' '}
                  · {formatDateTime(job.createdAt)}
                </div>
              </div>
              {job.errorCode ? <Badge tone="bad">{job.errorCode}</Badge> : null}
              <StatusBadge status={job.status} />
            </button>
          ))}
        </div>
      ) : null}

      {selected ? <JobDrawer id={selected} onClose={closeJob} /> : null}
    </div>
  );
}

function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const job = useJob(id);
  const retry = useRetryJob();
  const cancel = useCancelJob();
  const toast = useToast();

  return (
    <Drawer title="任务详情" onClose={onClose}>
      {job.isPending ? <SkeletonList rows={4} /> : null}
      {job.isError ? (
        <ErrorState message={errorMessage(job.error)} onRetry={() => void job.refetch()} />
      ) : null}
      {job.data ? (
        <>
          <div className="between">
            <div>
              <div style={{ fontWeight: 500 }}>{job.data.document.title}</div>
              <div className="tiny muted">
                v{job.data.version.versionNo} · 任务 {job.data.id.slice(0, 8)}
              </div>
            </div>
            <StatusBadge status={job.data.status} />
          </div>

          {job.data.errorCode ? (
            <div className="card card-pad" style={{ borderColor: 'var(--state-danger-border)' }}>
              <div className="tiny mono">{job.data.errorCode}</div>
              <div className="tiny">{job.data.errorMessage}</div>
            </div>
          ) : null}

          <section className="stack" style={{ gap: 6 }}>
            <h3>步骤</h3>
            {(job.data.steps ?? []).map((step) => (
              <div key={step.id} className="card card-pad">
                <div className="between">
                  <div>
                    <div style={{ fontWeight: 500 }}>{statusLabel(step.step)}</div>
                    <div className="tiny muted">
                      尝试 {step.attempt} 次
                      {step.finishedAt ? ` · ${formatDateTime(step.finishedAt)}` : ''}
                    </div>
                  </div>
                  <div className="row">
                    <StatusBadge status={step.status} />
                    {step.status === 'failed' ? (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={retry.isPending}
                        onClick={() =>
                          retry.mutate(
                            { id: job.data!.id, mode: 'step', step: step.step },
                            {
                              onSuccess: () => toast(`已重试 ${statusLabel(step.step)}`),
                              onError: (error) => toast(errorMessage(error), 'error'),
                            },
                          )
                        }
                      >
                        重试此步
                      </button>
                    ) : null}
                  </div>
                </div>
                {step.errorCode ? (
                  <div className="tiny" style={{ color: 'var(--danger)', marginTop: 6 }}>
                    {step.errorCode} · {step.errorMessage}
                  </div>
                ) : null}
              </div>
            ))}
          </section>

          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={retry.isPending || job.data.status === 'running'}
              onClick={() =>
                retry.mutate(
                  { id: job.data!.id, mode: 'full' },
                  {
                    onSuccess: () => toast('已整单重试'),
                    onError: (error) => toast(errorMessage(error), 'error'),
                  },
                )
              }
            >
              整单重试
            </button>
            {job.data.status === 'queued' || job.data.status === 'running' ? (
              <button
                type="button"
                className="btn danger"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(job.data!.id, {
                    onSuccess: () => toast('已取消'),
                    onError: (error) => toast(errorMessage(error), 'error'),
                  })
                }
              >
                取消任务
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

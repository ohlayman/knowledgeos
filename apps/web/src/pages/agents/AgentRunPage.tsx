import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useAgentRun, useCancelAgentRun, useDeleteAgentRun } from '../../features/hooks.js';
import { formatDateTime } from '../../lib/format.js';

const TERMINATION_LABELS: Record<string, string> = {
  final_answer: '正常完成',
  step_limit: '达到步数上限',
  budget_exhausted: '预算耗尽',
  tool_failures: '工具连续失败',
  timeout: '执行超时',
  canceled: '已取消',
  model_error: '模型调用失败',
  runtime_error: '运行时错误',
};

export function AgentRunPage() {
  const { runId } = useParams();
  const run = useAgentRun(runId);
  const cancel = useCancelAgentRun();
  const remove = useDeleteAgentRun();
  const toast = useToast();
  const navigate = useNavigate();

  if (run.isLoading) {
    return (
      <div className="page">
        <SkeletonList />
      </div>
    );
  }
  if (run.isError || !run.data) {
    return (
      <div className="page">
        <ErrorState message={errorMessage(run.error)} />
      </div>
    );
  }

  const detail = run.data;
  const running = detail.status === 'running' || detail.status === 'queued';
  const message =
    typeof (detail.input as { message?: unknown })?.message === 'string'
      ? String((detail.input as { message: string }).message)
      : JSON.stringify(detail.input);
  const steps = [...detail.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  return (
    <div className="page">
      <PageHeader
        title={`执行记录 · ${detail.agent.name}`}
        subtitle={`${formatDateTime(detail.createdAt)} · 版本 v${detail.agentVersion.versionNo}`}
        actions={
          <div className="row">
            <Link className="btn" to={`/agents/${detail.agentId}`}>
              返回 Agent
            </Link>
            {running ? (
              <button
                type="button"
                className="btn"
                onClick={() => cancel.mutate(detail.id)}
                disabled={cancel.isPending}
              >
                取消
              </button>
            ) : (
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (!window.confirm('删除这条执行记录？成本统计会同步更新。')) {
                    return;
                  }
                  remove.mutate(detail.id, {
                    onSuccess: () => {
                      toast('记录已删除');
                      navigate('/agents');
                    },
                    onError: (error) => toast(errorMessage(error), 'error'),
                  });
                }}
              >
                删除记录
              </button>
            )}
          </div>
        }
      />

      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Badge
            tone={
              detail.status === 'succeeded' ? 'ok' : detail.status === 'failed' ? 'bad' : 'warn'
            }
          >
            {detail.status}
          </Badge>
          <span className="tiny">步数 {detail.totalSteps}</span>
          <span className="tiny">耗时 {detail.durationMs ?? 0}ms</span>
          <span className="tiny">tokens {detail.totalTokens}</span>
          <span className="tiny">
            终止原因：
            {TERMINATION_LABELS[detail.terminationReason ?? ''] ?? detail.terminationReason ?? '—'}
          </span>
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          输入：{message}
        </p>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {steps.map((step) => {
          const calls = detail.toolCalls.filter((call) => call.stepIndex === step.stepIndex);
          return (
            <section key={step.id} className="card card-pad">
              <div className="between" style={{ marginBottom: 6 }}>
                <strong className="tiny">
                  第 {step.stepIndex} 步 · {step.type === 'output' ? '输出' : '思考'}
                </strong>
                <span className="tiny muted">{step.durationMs ?? 0}ms</span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{step.outputSummary}</p>
              {calls.map((call) => (
                <div
                  key={call.id}
                  style={{
                    marginTop: 8,
                    borderTop: '1px solid var(--line)',
                    paddingTop: 8,
                  }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <span className="mono tiny">{call.toolName}</span>
                    <Badge tone={call.status === 'succeeded' ? 'ok' : 'bad'}>
                      {call.status === 'succeeded' ? '成功' : (call.errorCode ?? '失败')}
                    </Badge>
                    <span className="tiny muted">{call.durationMs}ms</span>
                  </div>
                  <div className="row" style={{ marginTop: 6, gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p className="tiny muted">参数（已脱敏）</p>
                      <pre className="tiny" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                        {JSON.stringify(call.paramsRedacted, null, 2)}
                      </pre>
                    </div>
                    <div style={{ flex: 1 }}>
                      <p className="tiny muted">返回摘要</p>
                      <p className="tiny">{call.resultSummary ?? '—'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      {detail.terminationReason && detail.terminationReason !== 'final_answer' ? (
        <div
          className="card card-pad"
          style={{ marginTop: 12, borderColor: 'var(--state-danger-border)' }}
        >
          {TERMINATION_LABELS[detail.terminationReason] ?? detail.terminationReason}
        </div>
      ) : null}

      <p className="tiny muted" style={{ marginTop: 12 }}>
        执行记录不可编辑，只能删除整条记录。
      </p>
    </div>
  );
}

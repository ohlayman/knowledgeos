import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import {
  useAgent,
  useAgentEstimate,
  useAgentRuns,
  useAgentTools,
  useAgentUsage,
  useTriggerAgent,
  useUpdateAgent,
} from '../../features/hooks.js';
import { formatRelative } from '../../lib/format.js';

export function AgentDetailPage() {
  const { id } = useParams();
  const agent = useAgent(id);
  const runs = useAgentRuns(id);
  const tools = useAgentTools();
  const estimate = useAgentEstimate(id);
  const usage = useAgentUsage();
  const update = useUpdateAgent(id ?? '');
  const trigger = useTriggerAgent(id ?? '');
  const toast = useToast();
  const navigate = useNavigate();
  const initialized = useRef(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('fake-chat');
  const [temperature, setTemperature] = useState(0.2);
  const [maxSteps, setMaxSteps] = useState(8);
  const [tokenBudget, setTokenBudget] = useState(20000);
  const [toolCallBudget, setToolCallBudget] = useState(12);
  const [allowProposal, setAllowProposal] = useState(false);
  const [allowlist, setAllowlist] = useState<string[]>(['search_knowledge', 'get_chunk']);
  const [input, setInput] = useState('');

  useEffect(() => {
    const version = agent.data?.versions[0];
    if (initialized.current || !agent.data || !version) {
      return;
    }
    setName(agent.data.name);
    setDescription(agent.data.description ?? '');
    setSystemPrompt(version.systemPrompt);
    setModel(version.model);
    setTemperature(version.temperature);
    setMaxSteps(version.maxSteps);
    setTokenBudget(version.tokenBudget);
    setToolCallBudget(version.toolCallBudget);
    setAllowProposal(version.allowProposal);
    setAllowlist(version.toolAllowlist);
    initialized.current = true;
  }, [agent.data]);

  if (agent.isLoading) {
    return (
      <div className="page">
        <SkeletonList />
      </div>
    );
  }
  if (agent.isError || !agent.data) {
    return (
      <div className="page">
        <ErrorState message={errorMessage(agent.error)} />
      </div>
    );
  }

  const version = agent.data.versions[0];
  const latestRun = runs.data?.[0];

  return (
    <div className="page">
      <PageHeader
        title={agent.data.name}
        subtitle={`当前版本 v${version?.versionNo ?? 1} · 本月 ${agent.data.monthTokens} tokens`}
        actions={
          <Link className="btn" to="/agents">
            返回列表
          </Link>
        }
      />

      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <section className="card card-pad" style={{ flex: 1 }}>
          <h3>配置</h3>
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            <label className="stack" style={{ gap: 4 }}>
              <span className="tiny muted">名称</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="tiny muted">描述</span>
              <input
                className="input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="tiny muted">System Prompt</span>
              <textarea
                className="textarea"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
            </label>
            <div className="row">
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">模型</span>
                <input
                  className="input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">温度</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">步数上限</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={12}
                  value={maxSteps}
                  onChange={(event) => setMaxSteps(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">单次 token 预算</span>
                <input
                  className="input"
                  type="number"
                  value={tokenBudget}
                  onChange={(event) => setTokenBudget(Number(event.target.value))}
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">工具调用上限</span>
                <input
                  className="input"
                  type="number"
                  value={toolCallBudget}
                  onChange={(event) => setToolCallBudget(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <span className="tiny muted">工具白名单（写入类工具不存在）</span>
              {tools.data?.map((tool) => (
                <label key={tool.name} className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={allowlist.includes(tool.name)}
                    onChange={(event) =>
                      setAllowlist((current) =>
                        event.target.checked
                          ? [...current, tool.name]
                          : current.filter((name) => name !== tool.name),
                      )
                    }
                  />
                  <span className="tiny">
                    {tool.name} · {tool.description}
                  </span>
                </label>
              ))}
            </div>

            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={allowProposal}
                onChange={(event) => setAllowProposal(event.target.checked)}
              />
              <span className="tiny">允许提案工具（只产提案，不落库）</span>
            </label>

            <button
              type="button"
              className="btn primary"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    name,
                    description,
                    systemPrompt,
                    model,
                    temperature,
                    maxSteps,
                    tokenBudget,
                    toolCallBudget,
                    allowProposal,
                    toolAllowlist: allowlist,
                  },
                  {
                    onSuccess: () => toast('已保存并生成新版本'),
                    onError: (error) => toast(errorMessage(error), 'error'),
                  },
                )
              }
            >
              保存配置
            </button>
          </div>
        </section>

        <aside className="stack" style={{ width: 360, gap: 12 }}>
          <section className="card card-pad">
            <h3>试运行</h3>
            {usage.data ? (
              <p className="tiny muted" style={{ margin: '6px 0' }}>
                今日剩余 {usage.data.remaining.toLocaleString()} tokens
              </p>
            ) : null}
            <p className="tiny muted">预估消耗约 {estimate.data?.estimatedTokens ?? 8000} tokens</p>
            <textarea
              className="textarea"
              style={{ marginTop: 8 }}
              placeholder="输入任务，例如：对比两个方案并给出依据"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="Agent 输入"
            />
            <button
              type="button"
              className="btn primary"
              style={{ marginTop: 8 }}
              disabled={!input.trim() || trigger.isPending}
              onClick={() => {
                const estimated = estimate.data?.estimatedTokens ?? 8000;
                const median = estimate.data?.medianTokens;
                if (median && estimated > median * 2) {
                  const confirmed = window.confirm(
                    `本次执行预计约 ${Math.round(estimated / 1000)}k token，高于近期平均（${Math.round(median / 1000)}k）。继续？`,
                  );
                  if (!confirmed) {
                    return;
                  }
                }
                trigger.mutate(input.trim(), {
                  onSuccess: (run) => {
                    navigate(`/agents/runs/${(run as { id: string }).id}`);
                  },
                  onError: (error) => toast(errorMessage(error), 'error'),
                });
              }}
            >
              开始执行
            </button>
          </section>

          <section className="card card-pad">
            <h3>最近执行</h3>
            {latestRun ? (
              <Link className="tiny" to={`/agents/runs/${latestRun.id}`}>
                最近一次：{latestRun.status} · {latestRun.terminationReason ?? ''} ·{' '}
                {formatRelative(latestRun.createdAt)}
              </Link>
            ) : (
              <p className="tiny muted">尚未执行。</p>
            )}
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>
              {runs.data?.slice(0, 5).map((run) => (
                <Link key={run.id} className="tiny" to={`/agents/runs/${run.id}`}>
                  <Badge
                    tone={run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'bad' : ''}
                  >
                    {run.status}
                  </Badge>{' '}
                  {formatRelative(run.createdAt)} · {run.totalSteps} 步 · {run.totalTokens} tokens
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

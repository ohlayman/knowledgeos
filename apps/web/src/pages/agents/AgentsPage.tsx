import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, EmptyState, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useAgents, useAgentUsage, useCreateAgent } from '../../features/hooks.js';
import { formatRelative } from '../../lib/format.js';

export function AgentsPage() {
  const agents = useAgents();
  const usage = useAgentUsage();
  const create = useCreateAgent();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('你是知识库助手，先检索再回答，结论必须引用证据。');

  return (
    <div className="page">
      <PageHeader
        title="Agent Studio"
        subtitle="有工具、多步执行、可回放的受控智能体"
        actions={
          usage.data ? (
            <span className="tiny muted">
              今日 {usage.data.tokens.toLocaleString()} / {usage.data.budget.toLocaleString()}{' '}
              tokens
            </span>
          ) : undefined
        }
      />

      {agents.isLoading ? <SkeletonList /> : null}
      {agents.isError ? <ErrorState message={errorMessage(agents.error)} /> : null}
      {agents.data && agents.data.length === 0 ? (
        <EmptyState
          title="还没有 Agent"
          description="Agent 与普通问答的区别：有工具、多步执行、可失败恢复、可回放。"
        />
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        {agents.data?.map((agent) => (
          <Link key={agent.id} className="card card-pad list-row" to={`/agents/${agent.id}`}>
            <div className="stack" style={{ gap: 4 }}>
              <strong>{agent.name}</strong>
              <span className="tiny muted">{agent.description || '暂无描述'}</span>
              <span className="tiny muted">
                {agent.runs[0]
                  ? `最近执行：${agent.runs[0].status} · ${formatRelative(agent.runs[0].createdAt)}`
                  : '尚未执行'}
              </span>
            </div>
            <div className="row">
              <Badge tone={agent.status === 'active' ? 'ok' : ''}>{agent.status}</Badge>
              <span className="tiny muted">本月 {agent.monthTokens ?? 0} tokens</span>
            </div>
          </Link>
        ))}
      </div>

      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h3>新建 Agent</h3>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <input
            className="input"
            placeholder="名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Agent 名称"
          />
          <input
            className="input"
            placeholder="描述（可选）"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-label="Agent 描述"
          />
          <textarea
            className="textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="System Prompt"
          />
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || !prompt.trim() || create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), description: description.trim(), systemPrompt: prompt },
                {
                  onSuccess: () => {
                    setName('');
                    setDescription('');
                    toast('Agent 已创建');
                  },
                  onError: (error) => toast(errorMessage(error), 'error'),
                },
              )
            }
          >
            新建 Agent
          </button>
        </div>
      </section>
    </div>
  );
}

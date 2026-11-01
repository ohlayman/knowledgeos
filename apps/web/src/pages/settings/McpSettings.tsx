import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  SkeletonList,
  useToast,
} from '../../components/ui.js';
import {
  useCreateMcpToken,
  useDocuments,
  useMcpAudits,
  useMcpAuditStats,
  useMcpTokens,
  useRevokeMcpToken,
  useTestMcpToken,
  useUpdateMcpToken,
} from '../../features/hooks.js';
import type {
  McpAudit,
  McpCreatedToken,
  McpScope,
  McpTestResult,
  McpToken,
} from '../../features/schemas.js';
import { errorMessage } from '../../lib/api-client.js';
import { formatDateTime, formatRelative } from '../../lib/format.js';

const TOOLS: Array<[string, string, boolean]> = [
  ['search_knowledge', '检索知识库片段', true],
  ['read_wiki', '读取已发布 Wiki 页面', true],
  ['get_related_knowledge', '查询图谱关联实体', true],
  ['get_knowledge_sources', '查询块/文档来源', true],
  ['ask_knowledge', '完整问答（含引用）', true],
  ['propose_knowledge_update', '创建 Wiki 更新提案', false],
];

const EXPIRY_OPTIONS = [
  ['30', '30 天'],
  ['90', '90 天'],
  ['365', '365 天'],
  ['never', '永不过期'],
] as const;

function isScopeEmpty(scope: McpScope): boolean {
  if (scope.mode === 'tags') {
    return (scope.tags?.length ?? 0) === 0;
  }
  if (scope.mode === 'documents') {
    return (scope.documentIds?.length ?? 0) === 0;
  }
  return false;
}

function scopeLabel(scope: McpScope): string {
  if (scope.mode === 'tags') {
    return scope.tags?.length ? `标签：${scope.tags.join('、')}` : '标签（未选择）';
  }
  if (scope.mode === 'documents') {
    return `指定文档 ${scope.documentIds?.length ?? 0} 份`;
  }
  return '全部文档';
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function editorTitle(tool: string): string {
  return TOOLS.find(([name]) => name === tool)?.[1] ?? tool;
}

export function McpSettings() {
  const tokens = useMcpTokens();
  const [tab, setTab] = useState<'tokens' | 'logs'>('tokens');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<McpToken | null>(null);
  const [created, setCreated] = useState<McpCreatedToken | null>(null);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const test = useTestMcpToken();
  const toast = useToast();

  if (created) {
    return <OneTimeSecret token={created} onDone={() => setCreated(null)} />;
  }

  if (tokens.isPending) {
    return <SkeletonList rows={4} />;
  }

  if (tokens.isError) {
    return (
      <ErrorState message={errorMessage(tokens.error)} onRetry={() => void tokens.refetch()} />
    );
  }

  const activeToken = tokens.data.find((token) => token.status === 'active');

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row" role="tablist" aria-label="MCP 视图">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tokens'}
            className={`btn sm ${tab === 'tokens' ? 'primary' : ''}`}
            onClick={() => setTab('tokens')}
          >
            接入令牌
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'logs'}
            className={`btn sm ${tab === 'logs' ? 'primary' : ''}`}
            onClick={() => setTab('logs')}
          >
            调用日志
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn sm"
            disabled={!activeToken || test.isPending}
            onClick={() => {
              if (!activeToken) {
                return;
              }
              test.mutate(activeToken.id, {
                onSuccess: (result) => {
                  setTestResult(result);
                  toast(result.message, result.ok ? 'default' : 'error');
                },
                onError: (error) => toast(errorMessage(error), 'error'),
              });
            }}
          >
            测试连接
          </button>
          <button type="button" className="btn primary sm" onClick={() => setWizardOpen(true)}>
            创建令牌
          </button>
        </div>
      </div>

      {testResult ? (
        <div
          className="card card-pad"
          role="status"
          style={{
            borderColor: testResult.ok ? 'var(--state-success-border, var(--line))' : 'var(--line)',
          }}
        >
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{testResult.ok ? '连接正常' : '连接失败'}</strong>
            <button type="button" className="btn ghost sm" onClick={() => setTestResult(null)}>
              关闭
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            {testResult.message}
            {testResult.resultCount !== undefined ? ` · 探针返回 ${testResult.resultCount} 条` : ''}
          </p>
        </div>
      ) : null}

      {tab === 'tokens' ? (
        tokens.data.length === 0 ? (
          <EmptyState
            title="还没有接入令牌"
            description="创建一个，让 Claude Code 或 Cursor 读取你的知识库。"
            action={
              <button type="button" className="btn primary" onClick={() => setWizardOpen(true)}>
                创建第一个令牌
              </button>
            }
          />
        ) : (
          <div className="list">
            {tokens.data.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                onEdit={() => setEditing(token)}
                onTest={() => {
                  test.mutate(token.id, {
                    onSuccess: (result) => {
                      setTestResult(result);
                      toast(result.message, result.ok ? 'default' : 'error');
                    },
                    onError: (error) => toast(errorMessage(error), 'error'),
                  });
                }}
              />
            ))}
          </div>
        )
      ) : (
        <AuditLogs />
      )}

      {wizardOpen ? (
        <TokenWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(token) => {
            setWizardOpen(false);
            setCreated(token);
          }}
        />
      ) : null}

      {editing ? <EditTokenDrawer token={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function TokenRow({
  token,
  onEdit,
  onTest,
}: {
  token: McpToken;
  onEdit: () => void;
  onTest: () => void;
}) {
  const revoke = useRevokeMcpToken();
  const toast = useToast();
  const statusTone = token.status === 'active' ? 'ok' : token.status === 'expired' ? 'warn' : 'bad';
  const statusLabel =
    token.status === 'active' ? '生效中' : token.status === 'expired' ? '已过期' : '已吊销';

  return (
    <div
      className="list-row"
      style={{ opacity: token.status === 'revoked' ? 0.6 : 1, flexWrap: 'wrap' }}
    >
      <div className="grow" style={{ minWidth: 180 }}>
        <strong>{token.name}</strong>
        <div className="tiny muted">
          {token.scopeSummary} · {token.tools.length} 个工具
        </div>
      </div>
      <div className="tiny muted" style={{ minWidth: 120 }}>
        {token.lastUsedAt ? `最近使用 ${formatRelative(token.lastUsedAt)}` : '尚未使用'}
      </div>
      <div className="tiny muted" style={{ minWidth: 80 }}>
        今日 {token.todayCalls} 次
      </div>
      <Badge tone={statusTone}>{statusLabel}</Badge>
      <div className="row" style={{ marginLeft: 'auto' }}>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            void copyText(token.id).then(() => toast('已复制令牌 ID'));
          }}
        >
          复制 ID
        </button>
        <button type="button" className="btn ghost sm" onClick={onTest}>
          测试
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={token.status === 'revoked'}
          onClick={onEdit}
        >
          编辑作用域
        </button>
        <button
          type="button"
          className="btn danger sm"
          disabled={token.status !== 'active' || revoke.isPending}
          onClick={() => {
            if (!window.confirm(`吊销「${token.name}」？吊销后立即失效，历史调用记录保留。`)) {
              return;
            }
            revoke.mutate(token.id, {
              onSuccess: () => toast('令牌已吊销'),
              onError: (error) => toast(errorMessage(error), 'error'),
            });
          }}
        >
          吊销
        </button>
      </div>
      {token.status === 'expired' && token.expiresAt ? (
        <div className="tiny muted" style={{ flexBasis: '100%' }}>
          已于 {formatDateTime(token.expiresAt)} 过期，无法再调用。
        </div>
      ) : null}
    </div>
  );
}

function ScopeEditor({
  scope,
  onChange,
}: {
  scope: McpScope;
  onChange: (scope: McpScope) => void;
}) {
  const [query, setQuery] = useState('');
  const documents = useDocuments({ q: query, limit: 30 });
  const tags = useMemo(
    () => [...new Set(documents.data?.items.flatMap((item) => item.tags) ?? [])].sort(),
    [documents.data],
  );
  const selectedTags = scope.tags ?? [];
  const selectedDocuments = scope.documentIds ?? [];

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" role="radiogroup" aria-label="文档范围">
        {(
          [
            ['all', '全部文档'],
            ['tags', '按标签'],
            ['documents', '指定文档'],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="row tiny" style={{ gap: 6 }}>
            <input
              type="radio"
              name="mcp-scope-mode"
              checked={scope.mode === mode}
              onChange={() =>
                onChange({
                  mode,
                  ...(mode === 'tags' ? { tags: selectedTags } : {}),
                  ...(mode === 'documents' ? { documentIds: selectedDocuments } : {}),
                })
              }
            />
            {label}
          </label>
        ))}
      </div>

      {scope.mode === 'tags' ? (
        tags.length === 0 ? (
          <p className="tiny muted">知识库中还没有标签，导入文档并添加标签后再选择。</p>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {tags.map((tag) => {
              const checked = selectedTags.includes(tag);
              return (
                <label key={tag} className="badge" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onChange({
                        ...scope,
                        tags: checked
                          ? selectedTags.filter((item) => item !== tag)
                          : [...selectedTags, tag],
                      })
                    }
                    style={{ marginRight: 4 }}
                  />
                  {tag}
                </label>
              );
            })}
          </div>
        )
      ) : null}

      {scope.mode === 'documents' ? (
        <div className="stack" style={{ gap: 6 }}>
          <input
            className="input"
            aria-label="搜索文档"
            placeholder="按标题搜索文档"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {(documents.data?.items ?? []).slice(0, 20).map((document) => {
              const checked = selectedDocuments.includes(document.id);
              return (
                <label key={document.id} className="list-row tiny" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onChange({
                        ...scope,
                        documentIds: checked
                          ? selectedDocuments.filter((id) => id !== document.id)
                          : [...selectedDocuments, document.id],
                      })
                    }
                  />
                  <span className="truncate grow">{document.title}</span>
                </label>
              );
            })}
            {(documents.data?.items.length ?? 0) === 0 ? (
              <div className="list-row tiny muted">没有匹配的文档</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isScopeEmpty(scope) ? (
        <p className="tiny" style={{ color: 'var(--state-warn-text, var(--ink-500))' }}>
          所选范围没有任何文档，该令牌将无法检索到内容。请至少选择一个标签或一份文档。
        </p>
      ) : (
        <p className="tiny muted">预览：{scopeLabel(scope)}</p>
      )}
    </div>
  );
}

function ToolsEditor({
  tools,
  onChange,
}: {
  tools: string[];
  onChange: (tools: string[]) => void;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {TOOLS.map(([name, description, defaultEnabled]) => {
        const checked = tools.includes(name);
        return (
          <label key={name} className="row tiny" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(checked ? tools.filter((item) => item !== name) : [...tools, name])
              }
              style={{ marginTop: 2 }}
            />
            <span>
              <strong>{name}</strong>
              <span className="muted"> · {description}</span>
              {defaultEnabled ? null : (
                <span className="muted">（默认关闭，只创建待审核提案）</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function TokenWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: McpCreatedToken) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<McpScope>({ mode: 'all' });
  const [tools, setTools] = useState<string[]>(
    TOOLS.filter(([, , enabled]) => enabled).map(([name]) => name),
  );
  const [dailyLimit, setDailyLimit] = useState(500);
  const [qpsLimit, setQpsLimit] = useState(5);
  const [expiry, setExpiry] = useState<'30' | '90' | '365' | 'never'>('90');
  const create = useCreateMcpToken();
  const toast = useToast();

  const canContinue = step !== 1 || (name.trim().length > 0 && !isScopeEmpty(scope));

  const submit = () => {
    if (isScopeEmpty(scope) || tools.length === 0) {
      toast('请选择作用域与至少一个工具', 'error');
      return;
    }
    create.mutate(
      {
        name: name.trim(),
        scope,
        tools,
        dailyLimit,
        qpsLimit,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      },
      {
        onSuccess: (token) => onCreated(token),
        onError: (error) => toast(errorMessage(error), 'error'),
      },
    );
  };

  return (
    <Drawer title="创建接入令牌" onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row tiny muted">第 {step} / 3 步</div>

        {step === 1 ? (
          <>
            <Field label="名称" htmlFor="mcp-name" hint="建议写用途，例如 Claude Code 本机">
              <input
                id="mcp-name"
                className="input"
                value={name}
                maxLength={128}
                onChange={(event) => setName(event.target.value)}
                placeholder="Claude Code 本机"
              />
            </Field>
            <div>
              <div className="tiny muted" style={{ marginBottom: 6 }}>
                文档范围
              </div>
              <ScopeEditor scope={scope} onChange={setScope} />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <div>
            <div className="tiny muted" style={{ marginBottom: 6 }}>
              允许调用的工具
            </div>
            <ToolsEditor tools={tools} onChange={setTools} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="stack" style={{ gap: 12 }}>
            <Field label="每日调用上限" htmlFor="mcp-daily">
              <input
                id="mcp-daily"
                className="input"
                type="number"
                min={1}
                max={100000}
                value={dailyLimit}
                onChange={(event) => setDailyLimit(Number(event.target.value))}
              />
            </Field>
            <Field label="QPS 上限" htmlFor="mcp-qps">
              <input
                id="mcp-qps"
                className="input"
                type="number"
                min={1}
                max={100}
                value={qpsLimit}
                onChange={(event) => setQpsLimit(Number(event.target.value))}
              />
            </Field>
            <Field label="有效期" htmlFor="mcp-expiry">
              <select
                id="mcp-expiry"
                className="select"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as typeof expiry)}
              >
                {EXPIRY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {expiry === 'never' ? (
              <p className="tiny" style={{ color: 'var(--state-warn-text, var(--ink-500))' }}>
                长期有效的令牌一旦泄露，影响会持续到手动吊销。
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="card card-pad" aria-live="polite">
          <div className="tiny muted">配置预览</div>
          <strong>{name.trim() || '未命名令牌'}</strong>
          <div className="tiny muted">
            {scopeLabel(scope)} · {tools.length} 个工具 · 每日 {dailyLimit} 次 · QPS {qpsLimit}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn ghost"
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
          >
            {step === 1 ? '取消' : '上一步'}
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="btn primary"
              disabled={!canContinue}
              onClick={() => setStep(step + 1)}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={create.isPending || tools.length === 0 || isScopeEmpty(scope)}
              onClick={submit}
            >
              {create.isPending ? '创建中…' : '创建令牌'}
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function EditTokenDrawer({ token, onClose }: { token: McpToken; onClose: () => void }) {
  const [scope, setScope] = useState<McpScope>(token.scope);
  const [tools, setTools] = useState<string[]>(token.tools);
  const [dailyLimit, setDailyLimit] = useState(token.dailyLimit);
  const [qpsLimit, setQpsLimit] = useState(token.qpsLimit);
  const update = useUpdateMcpToken(token.id);
  const toast = useToast();

  return (
    <Drawer title={`编辑「${token.name}」`} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <ScopeEditor scope={scope} onChange={setScope} />
        <ToolsEditor tools={tools} onChange={setTools} />
        <div className="grid grid-2">
          <Field label="每日调用上限" htmlFor="mcp-edit-daily">
            <input
              id="mcp-edit-daily"
              className="input"
              type="number"
              value={dailyLimit}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
            />
          </Field>
          <Field label="QPS 上限" htmlFor="mcp-edit-qps">
            <input
              id="mcp-edit-qps"
              className="input"
              type="number"
              value={qpsLimit}
              onChange={(event) => setQpsLimit(Number(event.target.value))}
            />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={update.isPending || isScopeEmpty(scope) || tools.length === 0}
            onClick={() =>
              update.mutate(
                { scope, tools, dailyLimit, qpsLimit },
                {
                  onSuccess: () => {
                    toast('已更新令牌作用域');
                    onClose();
                  },
                  onError: (error) => toast(errorMessage(error), 'error'),
                },
              )
            }
          >
            保存
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function OneTimeSecret({ token, onDone }: { token: McpCreatedToken; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snippetTab, setSnippetTab] = useState<'claude-code' | 'cursor' | 'generic'>('claude-code');
  const toast = useToast();

  useEffect(() => {
    if (saved) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const interceptClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('a')) {
        return;
      }
      if (!window.confirm('令牌只显示一次，离开后将无法查看。确定离开？')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', handler);
    document.addEventListener('click', interceptClick, true);
    return () => {
      window.removeEventListener('beforeunload', handler);
      document.removeEventListener('click', interceptClick, true);
    };
  }, [saved]);

  const snippets = buildSnippets();
  const snippet = snippets.find((item) => item.id === snippetTab)?.content ?? '';

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18 }}>令牌已创建</h2>
        <p className="tiny muted">这是唯一一次显示完整令牌。关闭后无法再次查看。</p>
      </div>

      <div
        className="card card-pad"
        style={{ background: 'var(--surface-sunken, var(--paper-1))' }}
      >
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <code style={{ wordBreak: 'break-all', fontSize: 14 }}>{token.token}</code>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void copyText(token.token).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      <label className="row tiny" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        我已保存到安全位置，知道关闭后无法再次查看
      </label>

      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row" role="tablist" aria-label="接入片段">
          {snippets.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={snippetTab === item.id}
              className={`btn sm ${snippetTab === item.id ? 'primary' : ''}`}
              onClick={() => setSnippetTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <pre
          className="tiny"
          style={{
            background: 'var(--surface-sunken, var(--paper-1))',
            padding: 12,
            borderRadius: 8,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {snippet}
        </pre>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="tiny muted">把 kos_xxxxxxxx 替换为你刚创建的令牌。</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void copyText(snippet).then(() => toast('已复制接入片段'));
            }}
          >
            复制接入片段
          </button>
        </div>
        <p className="tiny muted">
          配置后重启客户端，然后让 Agent 试一次「搜索我的知识库里的
          RRF」。工具返回内容属于不可信引用数据，客户端应自行防范提示注入。
        </p>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" disabled={!saved} onClick={onDone}>
          完成
        </button>
      </div>
    </section>
  );
}

function buildSnippets() {
  const entry = '<KnowledgeOS 目录>/apps/mcp-server/dist/index.js';
  const configPath = '<你的目录>/kos-mcp.json';
  const config = JSON.stringify(
    { apiUrl: 'http://127.0.0.1:3000', token: 'kos_xxxxxxxx' },
    null,
    2,
  );
  const client = JSON.stringify(
    {
      mcpServers: {
        knowledgeos: {
          command: 'node',
          args: [entry, '--config', configPath],
        },
      },
    },
    null,
    2,
  );

  return [
    { id: 'claude-code' as const, label: 'Claude Code', content: client },
    { id: 'cursor' as const, label: 'Cursor', content: client },
    {
      id: 'generic' as const,
      label: '通用 JSON',
      content: `// ${configPath}\n${config}\n\n// 客户端配置\n${client}`,
    },
  ];
}

function AuditLogs() {
  const [status, setStatus] = useState('');
  const [tool, setTool] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const audits = useMcpAudits({
    ...(status ? { status } : {}),
    ...(tool ? { tool } : {}),
    limit: 100,
  });
  const stats = useMcpAuditStats();

  if (audits.isPending || stats.isPending) {
    return <SkeletonList rows={4} />;
  }
  if (audits.isError || stats.isError) {
    return (
      <ErrorState
        message={errorMessage(audits.error ?? stats.error)}
        onRetry={() => {
          void audits.refetch();
          void stats.refetch();
        }}
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-2">
        <StatCard label="今日调用" value={String(stats.data.calls)} />
        <StatCard
          label="失败率"
          value={`${stats.data.calls ? Math.round((stats.data.failures / stats.data.calls) * 100) : 0}%`}
        />
        <StatCard label="平均延迟" value={`${stats.data.avgLatencyMs}ms`} />
        <StatCard label="被限流" value={String(stats.data.rateLimited)} />
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select
          className="select"
          aria-label="按状态筛选"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="rate_limited">限流</option>
        </select>
        <select
          className="select"
          aria-label="按工具筛选"
          value={tool}
          onChange={(event) => setTool(event.target.value)}
        >
          <option value="">全部工具</option>
          {TOOLS.map(([name]) => (
            <option key={name} value={name}>
              {editorTitle(name)}
            </option>
          ))}
        </select>
      </div>

      {audits.data.length === 0 ? (
        <EmptyState
          title="还没有调用记录"
          description="配置完成后，Agent 的每次调用会出现在这里。"
        />
      ) : (
        <div className="list">
          {audits.data.map((audit) => (
            <AuditRow
              key={audit.id}
              audit={audit}
              expanded={expanded === audit.id}
              onToggle={() => setExpanded(expanded === audit.id ? null : audit.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card metric">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function AuditRow({
  audit,
  expanded,
  onToggle,
}: {
  audit: McpAudit;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = audit.statusCode === 429 ? '限流' : audit.statusCode >= 400 ? '失败' : '成功';
  return (
    <div>
      <button type="button" className="list-row" onClick={onToggle} aria-expanded={expanded}>
        <span className="grow tiny">{formatDateTime(audit.createdAt)}</span>
        <span className="tiny" style={{ minWidth: 100 }}>
          {audit.tokenName ?? '已删除令牌'}
        </span>
        <span className="tiny" style={{ minWidth: 130 }}>
          {editorTitle(audit.tool)}
        </span>
        <span className="tiny muted" style={{ minWidth: 60 }}>
          {audit.durationMs}ms
        </span>
        <span className="tiny muted" style={{ minWidth: 50 }}>
          {audit.resultCount ?? 0} 条
        </span>
        <Badge tone={status === '成功' ? 'ok' : status === '限流' ? 'warn' : 'bad'}>{status}</Badge>
      </button>
      {expanded ? (
        <div className="card card-pad" style={{ margin: '0 16px 12px' }}>
          <div className="tiny muted">参数摘要（已脱敏，不含返回正文）</div>
          <pre className="tiny" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(audit.paramsSummary ?? {}, null, 2)}
          </pre>
          <div className="tiny muted">
            传输：{audit.transport} · 可疑内容：{audit.suspicious ? '是' : '否'}
          </div>
        </div>
      ) : null}
    </div>
  );
}

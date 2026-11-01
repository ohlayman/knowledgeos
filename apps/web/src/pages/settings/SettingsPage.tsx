import { useEffect, useState } from 'react';
import { PageHeader, StorageMetric } from '../../components/business.js';
import { Badge, ErrorState, Field, SkeletonList, useToast } from '../../components/ui.js';
import {
  useClearKnowledgeBase,
  useExportBundle,
  useMetrics,
  useSaveProvider,
  useSettings,
  useTestConnection,
  useUpdateSettings,
} from '../../features/hooks.js';
import type { Settings } from '../../features/schemas.js';
import { errorMessage } from '../../lib/api-client.js';
import { useTheme, type ThemeMode } from '../../lib/theme.js';
import { McpSettings } from './McpSettings.js';

type Tab = 'models' | 'retrieval' | 'mcp' | 'appearance' | 'storage';

const TABS: Array<[Tab, string]> = [
  ['models', '模型与连接'],
  ['retrieval', '检索偏好'],
  ['mcp', 'MCP 接入'],
  ['appearance', '外观'],
  ['storage', '存储'],
];

const RETRIEVAL_KEYS = [
  ['retrieval.topK', '最终证据数', 'number'],
  ['retrieval.vectorTopN', '向量召回数', 'number'],
  ['retrieval.keywordTopN', '关键词召回数', 'number'],
  ['retrieval.rrfK', 'RRF k 值', 'number'],
  ['retrieval.rerankEnabled', '启用重排', 'boolean'],
  ['retrieval.includeHistoryVersions', '检索包含历史版本', 'boolean'],
  ['chunking.targetMin', '切块目标下限', 'number'],
  ['chunking.targetMax', '切块目标上限', 'number'],
  ['chunking.hardMax', '切块硬上限', 'number'],
  ['processing.concurrency', '处理并发数', 'number'],
  ['answering.concurrency', '问答并发数', 'number'],
] as const;

export function SettingsPage() {
  const settings = useSettings();
  const metrics = useMetrics();
  const [tab, setTab] = useState<Tab>('models');

  if (settings.isPending) {
    return (
      <div className="page">
        <PageHeader title="设置" />
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="page">
        <PageHeader title="设置" />
        <ErrorState
          message={errorMessage(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="设置" subtitle="模型、检索参数、MCP 接入与本地存储" />

      <div className="settings-grid">
        <nav className="settings-nav" aria-label="设置分区">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-current={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="stack" style={{ gap: 20 }}>
          {tab === 'models' ? <ModelsTab settings={settings.data} /> : null}
          {tab === 'retrieval' ? <RetrievalTab settings={settings.data} /> : null}
          {tab === 'mcp' ? <McpSettings /> : null}
          {tab === 'appearance' ? <AppearanceTab /> : null}
          {tab === 'storage' ? (
            <section className="stack">
              <h2 style={{ fontSize: 16 }}>存储</h2>
              <div className="grid grid-2">
                <StorageMetric bytes={metrics.data?.storage.bytes ?? 0} />
                <div className="card metric">
                  <span className="label">Chunk 总数</span>
                  <span className="value">{metrics.data?.chunks.total ?? 0}</span>
                  <span className="note">向量就绪 {metrics.data?.chunks.vectorReady ?? 0}</span>
                </div>
              </div>
              <p className="tiny muted">
                原始文件只增不删，逻辑删除只修改数据库状态；物理清理由保留策略执行。
              </p>
              <ExportSection />
              <DangerZone />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModelsTab({ settings }: { settings: Settings }) {
  const toast = useToast();
  const save = useSaveProvider();
  const test = useTestConnection();
  const [llm, setLlm] = useState({ provider: 'openai', model: '', baseUrl: '', apiKey: '' });
  const [embedding, setEmbedding] = useState({
    provider: 'openai',
    model: '',
    baseUrl: '',
    apiKey: '',
    dim: 1536,
  });

  useEffect(() => {
    const chatProvider = settings.providers.find((row) => row.kind === 'llm');
    const embeddingProvider = settings.providers.find((row) => row.kind === 'embedding');

    setLlm({
      provider: chatProvider?.provider ?? 'openai',
      model: chatProvider?.model ?? settings.runtime.chat.model,
      baseUrl: chatProvider?.baseUrl ?? '',
      apiKey: '',
    });
    setEmbedding({
      provider: embeddingProvider?.provider ?? 'openai',
      model: embeddingProvider?.model ?? settings.runtime.embedding.model,
      baseUrl: embeddingProvider?.baseUrl ?? '',
      apiKey: '',
      dim: embeddingProvider ? settings.runtime.embedding.dim : settings.runtime.embedding.dim,
    });
  }, [settings]);

  return (
    <section className="stack" style={{ gap: 20 }}>
      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="between">
            <h3>问答模型</h3>
            <Badge tone={settings.runtime.chat.source === 'db' ? 'accent' : ''}>
              {settings.runtime.chat.source === 'db'
                ? '已保存'
                : settings.runtime.chat.source === 'env'
                  ? '来自环境变量'
                  : 'Fake（开发）'}
            </Badge>
          </div>
          <p className="tiny muted" style={{ margin: '6px 0 12px' }}>
            当前模型：{settings.runtime.chat.model}
          </p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(
                {
                  kind: 'llm',
                  provider: llm.provider,
                  model: llm.model,
                  ...(llm.baseUrl ? { baseUrl: llm.baseUrl } : {}),
                  ...(llm.apiKey ? { apiKey: llm.apiKey } : {}),
                },
                {
                  onSuccess: () => {
                    toast('已保存问答模型配置');
                    setLlm((current) => ({ ...current, apiKey: '' }));
                  },
                  onError: (error) => toast(errorMessage(error), 'error'),
                },
              );
            }}
          >
            <Field label="模型" htmlFor="llm-model">
              <input
                id="llm-model"
                className="input"
                value={llm.model}
                onChange={(event) => setLlm({ ...llm, model: event.target.value })}
                required
              />
            </Field>
            <Field label="Base URL" htmlFor="llm-base" hint="OpenAI 兼容网关地址">
              <input
                id="llm-base"
                className="input"
                value={llm.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => setLlm({ ...llm, baseUrl: event.target.value })}
              />
            </Field>
            <Field label="API Key" htmlFor="llm-key" hint="保存后只显示后四位">
              <input
                id="llm-key"
                className="input"
                type="password"
                value={llm.apiKey}
                placeholder="留空则不修改"
                onChange={(event) => setLlm({ ...llm, apiKey: event.target.value })}
              />
            </Field>
            <div className="row">
              <button type="submit" className="btn primary" disabled={save.isPending}>
                保存
              </button>
              <button
                type="button"
                className="btn"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(
                    {
                      kind: 'llm',
                      model: llm.model,
                      ...(llm.baseUrl ? { baseUrl: llm.baseUrl } : {}),
                      ...(llm.apiKey ? { apiKey: llm.apiKey } : {}),
                    },
                    {
                      onSuccess: (result) =>
                        toast(
                          result.ok
                            ? `连接成功（${result.latencyMs}ms）`
                            : `连接失败：${result.message ?? result.code}`,
                          result.ok ? 'default' : 'error',
                        ),
                      onError: (error) => toast(errorMessage(error), 'error'),
                    },
                  )
                }
              >
                连接测试
              </button>
            </div>
          </form>
        </div>

        <div className="card card-pad">
          <div className="between">
            <h3>Embedding 模型</h3>
            <Badge tone={settings.runtime.embedding.source === 'db' ? 'accent' : ''}>
              {settings.runtime.embedding.source === 'db'
                ? '已保存'
                : settings.runtime.embedding.source === 'env'
                  ? '来自环境变量'
                  : 'Fake（开发）'}
            </Badge>
          </div>
          <p className="tiny muted" style={{ margin: '6px 0 12px' }}>
            当前模型：{settings.runtime.embedding.model}（{settings.runtime.embedding.dim} 维）。
            更换模型后需要重启 worker 并重建索引。
          </p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(
                {
                  kind: 'embedding',
                  provider: embedding.provider,
                  model: embedding.model,
                  dim: embedding.dim,
                  ...(embedding.baseUrl ? { baseUrl: embedding.baseUrl } : {}),
                  ...(embedding.apiKey ? { apiKey: embedding.apiKey } : {}),
                },
                {
                  onSuccess: () => {
                    toast('已保存 Embedding 配置');
                    setEmbedding((current) => ({ ...current, apiKey: '' }));
                  },
                  onError: (error) => toast(errorMessage(error), 'error'),
                },
              );
            }}
          >
            <Field label="模型" htmlFor="embedding-model">
              <input
                id="embedding-model"
                className="input"
                value={embedding.model}
                onChange={(event) => setEmbedding({ ...embedding, model: event.target.value })}
                required
              />
            </Field>
            <Field label="维度" htmlFor="embedding-dim">
              <input
                id="embedding-dim"
                className="input"
                type="number"
                min={1}
                max={8192}
                value={embedding.dim}
                onChange={(event) =>
                  setEmbedding({ ...embedding, dim: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Base URL" htmlFor="embedding-base">
              <input
                id="embedding-base"
                className="input"
                value={embedding.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => setEmbedding({ ...embedding, baseUrl: event.target.value })}
              />
            </Field>
            <Field label="API Key" htmlFor="embedding-key" hint="保存后只显示后四位">
              <input
                id="embedding-key"
                className="input"
                type="password"
                value={embedding.apiKey}
                placeholder="留空则不修改"
                onChange={(event) => setEmbedding({ ...embedding, apiKey: event.target.value })}
              />
            </Field>
            <div className="row">
              <button type="submit" className="btn primary" disabled={save.isPending}>
                保存
              </button>
              <button
                type="button"
                className="btn"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(
                    {
                      kind: 'embedding',
                      model: embedding.model,
                      dim: embedding.dim,
                      ...(embedding.baseUrl ? { baseUrl: embedding.baseUrl } : {}),
                      ...(embedding.apiKey ? { apiKey: embedding.apiKey } : {}),
                    },
                    {
                      onSuccess: (result) =>
                        toast(
                          result.ok
                            ? `连接成功（${result.latencyMs}ms）`
                            : `连接失败：${result.message ?? result.code}`,
                          result.ok ? 'default' : 'error',
                        ),
                      onError: (error) => toast(errorMessage(error), 'error'),
                    },
                  )
                }
              >
                连接测试
              </button>
            </div>
          </form>
        </div>
      </div>

      {settings.providers.length > 0 ? (
        <section className="card card-pad">
          <h3 style={{ marginBottom: 8 }}>已保存的配置</h3>
          <div className="stack" style={{ gap: 6 }}>
            {settings.providers.map((provider) => (
              <div key={`${provider.kind}-${provider.model}`} className="between tiny">
                <span>
                  {provider.kind === 'llm' ? '问答' : 'Embedding'} · {provider.provider} /{' '}
                  {provider.model}
                </span>
                <span className="mono muted">
                  {provider.apiKeyLast4 ? `••••${provider.apiKeyLast4}` : '未设置密钥'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function RetrievalTab({ settings }: { settings: Settings }) {
  const toast = useToast();
  const update = useUpdateSettings();
  const [values, setValues] = useState<Record<string, number | boolean>>(() => {
    const initial: Record<string, number | boolean> = {};
    for (const [key, , type] of RETRIEVAL_KEYS) {
      const value = settings.settings[key];
      if (type === 'number' && typeof value === 'number') {
        initial[key] = value;
      }
      if (type === 'boolean' && typeof value === 'boolean') {
        initial[key] = value;
      }
    }
    return initial;
  });

  return (
    <section className="card card-pad">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>检索与处理参数</h2>
      <p className="tiny muted" style={{ marginBottom: 16 }}>
        修改会立即用于后续检索；切块参数只影响之后处理的文档。
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(values, {
            onSuccess: () => toast('设置已保存'),
            onError: (error) => toast(errorMessage(error), 'error'),
          });
        }}
      >
        <div className="grid grid-2">
          {RETRIEVAL_KEYS.map(([key, label, type]) =>
            type === 'boolean' ? (
              <label key={key} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={Boolean(values[key])}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                <span>{label}</span>
              </label>
            ) : (
              <Field key={key} label={label} htmlFor={key}>
                <input
                  id={key}
                  className="input"
                  type="number"
                  min={1}
                  value={typeof values[key] === 'number' ? (values[key] as number) : ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: Number(event.target.value) }))
                  }
                />
              </Field>
            ),
          )}
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={update.isPending}>
            保存设置
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const restored: Record<string, number | boolean> = {};
              for (const [key, , type] of RETRIEVAL_KEYS) {
                const value = settings.settings[key];
                if (
                  (type === 'number' && typeof value === 'number') ||
                  (type === 'boolean' && typeof value === 'boolean')
                ) {
                  restored[key] = value as number | boolean;
                }
              }
              setValues(restored);
            }}
          >
            重置为已保存值
          </button>
        </div>
      </form>
    </section>
  );
}

function ExportSection() {
  const exportBundle = useExportBundle();
  const toast = useToast();

  return (
    <section className="card card-pad">
      <h3 style={{ marginBottom: 4 }}>数据导出</h3>
      <p className="tiny muted" style={{ marginBottom: 12 }}>
        导出文档、版本、块、会话与设置（不含密钥明文），用于迁移或归档。
      </p>
      <button
        type="button"
        className="btn"
        disabled={exportBundle.isPending}
        onClick={() =>
          exportBundle.mutate(undefined, {
            onSuccess: () => toast('导出包已开始下载'),
            onError: (error) => toast(errorMessage(error), 'error'),
          })
        }
      >
        {exportBundle.isPending ? '打包中…' : '下载导出包'}
      </button>
    </section>
  );
}

function DangerZone() {
  const [confirm, setConfirm] = useState('');
  const clear = useClearKnowledgeBase();
  const toast = useToast();

  return (
    <section className="card card-pad" style={{ borderColor: 'var(--state-danger-border)' }}>
      <h3 style={{ marginBottom: 4, color: 'var(--danger)' }}>清空知识库</h3>
      <p className="tiny muted" style={{ marginBottom: 12 }}>
        删除全部文档、块、向量、对象存储与会话。此操作不可撤销，请先导出备份。
      </p>
      <div className="row">
        <input
          className="input"
          style={{ width: 200 }}
          placeholder="输入 DELETE 确认"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-label="清空确认词"
        />
        <button
          type="button"
          className="btn danger"
          disabled={confirm !== 'DELETE' || clear.isPending}
          onClick={() => {
            if (!window.confirm('确认清空全部知识库数据？')) {
              return;
            }
            clear.mutate('DELETE', {
              onSuccess: (result) => {
                setConfirm('');
                toast(`已清空 ${result.documents} 份文档`);
              },
              onError: (error) => toast(errorMessage(error), 'error'),
            });
          }}
        >
          {clear.isPending ? '清理中…' : '清空知识库'}
        </button>
      </div>
    </section>
  );
}

function AppearanceTab() {
  const { mode, setMode } = useTheme();

  return (
    <section className="card card-pad">
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>主题</h2>
      <div className="row" role="radiogroup" aria-label="主题模式">
        {(['light', 'dark', 'system'] as ThemeMode[]).map((option) => (
          <label key={option} className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              name="theme"
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            <span>{option === 'light' ? '浅色' : option === 'dark' ? '深色' : '跟随系统'}</span>
          </label>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        所有颜色来自语义令牌，切换主题不会改变信息层级。
      </p>
    </section>
  );
}

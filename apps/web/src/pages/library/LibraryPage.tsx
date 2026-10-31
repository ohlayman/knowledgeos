import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import {
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  SkeletonList,
  StatusBadge,
  useToast,
} from '../../components/ui.js';
import { useDocuments, useIngestText, type DocumentFilters } from '../../features/hooks.js';
import { errorMessage, ApiError } from '../../lib/api-client.js';
import { formatBytes, formatRelative } from '../../lib/format.js';

const STATUS_OPTIONS = [
  ['', '全部状态'],
  ['queued', '排队中'],
  ['processing', '处理中'],
  ['ready', '就绪'],
  ['failed', '失败'],
  ['needs_ocr', '需要 OCR'],
] as const;

const TYPE_OPTIONS = [
  ['', '全部来源'],
  ['file', '文件'],
  ['url', '网页'],
  ['manual', '手动文本'],
] as const;

interface UploadResult {
  fileName: string;
  status: string;
  errorCode?: string;
  message?: string;
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const filters: DocumentFilters = {
    ...(params.get('q') ? { q: params.get('q')! } : {}),
    ...(params.get('status') ? { status: params.get('status')! } : {}),
    ...(params.get('type') ? { type: params.get('type')! } : {}),
    ...(params.get('tag') ? { tag: params.get('tag')! } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 20,
  };
  const documents = useDocuments(filters);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setCursor(undefined);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader
        title="知识库"
        subtitle="导入、筛选并检查每一份原始材料"
        actions={
          <button type="button" className="btn primary" onClick={() => setImportOpen(true)}>
            导入材料
          </button>
        }
      />

      <div className="row" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="搜索标题或标签"
          defaultValue={params.get('q') ?? ''}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              updateParam('q', event.currentTarget.value.trim());
            }
          }}
          aria-label="搜索文档"
        />
        <select
          className="select"
          value={params.get('status') ?? ''}
          onChange={(event) => updateParam('status', event.target.value)}
          aria-label="按状态筛选"
        >
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={params.get('type') ?? ''}
          onChange={(event) => updateParam('type', event.target.value)}
          aria-label="按来源筛选"
        >
          {TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ width: 160 }}
          placeholder="标签"
          defaultValue={params.get('tag') ?? ''}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              updateParam('tag', event.currentTarget.value.trim());
            }
          }}
          aria-label="按标签筛选"
        />
      </div>

      {documents.isPending ? <SkeletonList rows={6} /> : null}

      {documents.isError ? (
        <ErrorState
          message={errorMessage(documents.error)}
          onRetry={() => void documents.refetch()}
        />
      ) : null}

      {documents.data && documents.data.items.length === 0 ? (
        params.toString() ? (
          <EmptyState
            title="没有符合筛选条件的文档"
            description="换个关键词或清除筛选条件再试一次。"
            action={
              <button type="button" className="btn" onClick={() => setParams({})}>
                清除筛选
              </button>
            }
          />
        ) : (
          <EmptyState
            title="还没有导入任何材料"
            description="支持 Markdown、文本型 PDF、网页链接与手动文本。"
            action={
              <button type="button" className="btn primary" onClick={() => setImportOpen(true)}>
                导入第一份材料
              </button>
            }
          />
        )
      ) : null}

      {documents.data && documents.data.items.length > 0 ? (
        <>
          <div className="list">
            {documents.data.items.map((document) => (
              <Link
                key={document.id}
                to={`/documents/${document.id}`}
                className="list-row"
                style={{ textDecoration: 'none' }}
              >
                <div className="grow">
                  <div className="truncate" style={{ fontWeight: 500 }}>
                    {document.title}
                  </div>
                  <div className="tiny muted">
                    v{document.currentVersion?.versionNo ?? 1} ·{' '}
                    {document.currentVersion?.charCount ?? 0} 字
                    {document.currentVersion?.pageCount
                      ? ` · ${document.currentVersion.pageCount} 页`
                      : ''}
                  </div>
                </div>
                {document.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="badge">
                    {tag}
                  </span>
                ))}
                <StatusBadge status={document.currentVersion?.status ?? 'queued'} />
                <span className="tiny muted" style={{ width: 80, textAlign: 'right' }}>
                  {formatRelative(document.updatedAt)}
                </span>
              </Link>
            ))}
          </div>

          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <span className="tiny muted">
              共 {documents.data.items.length} 条{documents.data.nextCursor ? '（还有更多）' : ''}
            </span>
            <div className="row">
              {cursor ? (
                <button type="button" className="btn sm" onClick={() => setCursor(undefined)}>
                  回到第一页
                </button>
              ) : null}
              <button
                type="button"
                className="btn sm"
                disabled={!documents.data.nextCursor}
                onClick={() => setCursor(documents.data.nextCursor ?? undefined)}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      ) : null}

      {importOpen ? <ImportDrawer onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function ImportDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'text' | 'file' | 'url'>('text');

  return (
    <Drawer title="导入材料" onClose={onClose}>
      <div className="row" role="tablist" aria-label="导入方式">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'text'}
          className={`btn sm ${tab === 'text' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('text')}
        >
          手动文本
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'file'}
          className={`btn sm ${tab === 'file' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('file')}
        >
          文件
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'url'}
          className={`btn sm ${tab === 'url' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('url')}
        >
          网页链接
        </button>
      </div>

      {tab === 'text' ? <TextImport onDone={onClose} /> : null}
      {tab === 'file' ? <FileImport /> : null}
      {tab === 'url' ? <UrlImport /> : null}
    </Drawer>
  );
}

function TextImport({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const ingest = useIngestText();
  const toast = useToast();

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        ingest.mutate(
          {
            title: title.trim(),
            content,
            tags: tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          },
          {
            onSuccess: () => {
              toast('已加入处理队列');
              onDone();
            },
            onError: (error) => toast(errorMessage(error), 'error'),
          },
        );
      }}
    >
      <Field label="标题" htmlFor="import-title">
        <input
          id="import-title"
          className="input"
          value={title}
          maxLength={200}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="正文" htmlFor="import-content" hint="最多 200,000 字符">
        <textarea
          id="import-content"
          className="textarea"
          value={content}
          maxLength={200_000}
          required
          onChange={(event) => setContent(event.target.value)}
        />
      </Field>
      <Field label="标签" htmlFor="import-tags" hint="用逗号分隔，可留空">
        <input
          id="import-tags"
          className="input"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </Field>
      <button type="submit" className="btn primary" disabled={ingest.isPending}>
        {ingest.isPending ? '提交中…' : '导入文本'}
      </button>
    </form>
  );
}

function FileImport() {
  const [results, setResults] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    const form = new FormData();
    for (const file of Array.from(files)) {
      form.append('files', file);
    }
    setBusy(true);
    try {
      const response = await fetch('/api/v1/documents/files', { method: 'POST', body: form });
      const payload = (await response.json()) as {
        items?: UploadResult[];
        error?: { message?: string };
      };
      if (!response.ok) {
        toast(payload.error?.message ?? '上传失败', 'error');
        return;
      }
      setResults(payload.items ?? []);
    } catch {
      toast('上传失败，请检查网络', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Field
        label="选择文件"
        htmlFor="import-files"
        hint="Markdown / 文本型 PDF，单个 ≤ 20MB，最多 200 个"
      >
        <input
          id="import-files"
          className="input"
          type="file"
          multiple
          accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
          onChange={(event) => void upload(event.target.files)}
          disabled={busy}
        />
      </Field>
      {busy ? <p className="tiny muted">上传中…</p> : null}
      {results.map((item) => (
        <div key={item.fileName} className="between card card-pad">
          <span className="truncate">{item.fileName}</span>
          <span className={`badge ${item.status === 'failed' ? 'bad' : 'ok'}`}>
            {item.status === 'failed'
              ? (item.errorCode ?? '失败')
              : item.status === 'duplicate'
                ? '重复跳过'
                : '已入队'}
          </span>
        </div>
      ))}
    </div>
  );
}

function UrlImport() {
  const [urls, setUrls] = useState('');
  const [results, setResults] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        const list = urls
          .split('\n')
          .map((url) => url.trim())
          .filter(Boolean)
          .slice(0, 20);
        if (list.length === 0) {
          return;
        }
        setBusy(true);
        void fetch('/api/v1/documents/urls', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ urls: list }),
        })
          .then(async (response) => {
            const payload = (await response.json()) as {
              items?: UploadResult[];
              error?: { message?: string };
            };
            if (!response.ok) {
              throw new ApiError({
                code: payload.error?.message ?? 'FETCH_FAILED',
                message: payload.error?.message ?? '导入失败',
                status: response.status,
                retryable: false,
              });
            }
            setResults(payload.items ?? []);
          })
          .catch((error: unknown) => toast(errorMessage(error), 'error'))
          .finally(() => setBusy(false));
      }}
    >
      <Field
        label="网页地址"
        htmlFor="import-urls"
        hint="每行一个，最多 20 个；仅支持公网 http/https"
      >
        <textarea
          id="import-urls"
          className="textarea"
          value={urls}
          onChange={(event) => setUrls(event.target.value)}
          placeholder="https://example.com/article"
        />
      </Field>
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? '抓取中…' : '导入链接'}
      </button>
      {results.map((item) => (
        <div key={item.fileName} className="between card card-pad">
          <span className="truncate">{item.fileName}</span>
          <span className={`badge ${item.status === 'failed' ? 'bad' : 'ok'}`}>
            {item.status === 'failed'
              ? (item.errorCode ?? '失败')
              : item.status === 'duplicate'
                ? '重复跳过'
                : '已入队'}
          </span>
        </div>
      ))}
    </form>
  );
}

export function formatSize(bytes: number): string {
  return formatBytes(bytes);
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import { useSaveWikiRevision, useWikiPage } from '../../features/hooks.js';

interface Paragraph {
  id: string;
  section: string;
  text: string;
  evidenceChunkIds: string[];
  origin: 'model' | 'human';
  versionIntroduced?: number;
}

export function WikiEditPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const page = useWikiPage(slug);
  const save = useSaveWikiRevision(slug ?? '');
  const toast = useToast();
  const initialized = useRef(false);

  const [summary, setSummary] = useState('');
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [changeSummary, setChangeSummary] = useState('');

  useEffect(() => {
    if (initialized.current || !page.data?.currentRevision) {
      return;
    }
    const content = page.data.currentRevision.content as unknown as {
      summary?: string;
      paragraphs?: Paragraph[];
    };
    setSummary(content.summary ?? '');
    setParagraphs(content.paragraphs ?? []);
    initialized.current = true;
  }, [page.data]);

  if (page.isLoading) {
    return (
      <div className="page">
        <SkeletonList />
      </div>
    );
  }
  if (page.isError || !page.data) {
    return (
      <div className="page">
        <ErrorState message={errorMessage(page.error)} />
      </div>
    );
  }

  const baseRevisionId = page.data.currentRevisionId;
  if (!baseRevisionId) {
    return (
      <div className="page">
        <ErrorState message="页面还没有可编辑的版本" />
      </div>
    );
  }

  const updateParagraph = (id: string, patch: Partial<Paragraph>) => {
    setParagraphs((current) =>
      current.map((paragraph) => (paragraph.id === id ? { ...paragraph, ...patch } : paragraph)),
    );
  };

  return (
    <div className="page">
      <PageHeader
        title={`编辑 ${page.data.title}`}
        subtitle="保存后生成新版本；人工段落不会被模型覆盖"
      />

      <div className="stack" style={{ gap: 12 }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="tiny muted">摘要</span>
          <input
            className="input"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>

        {paragraphs.map((paragraph, index) => (
          <section key={paragraph.id} className="card card-pad">
            <div className="between" style={{ marginBottom: 8 }}>
              <div className="row">
                <Badge tone={paragraph.origin === 'human' ? 'accent' : ''}>
                  {paragraph.origin === 'human' ? '人工' : '模型'}
                </Badge>
                <input
                  className="input"
                  style={{ width: 160 }}
                  value={paragraph.section}
                  aria-label={`第 ${index + 1} 段章节`}
                  onChange={(event) =>
                    updateParagraph(paragraph.id, { section: event.target.value })
                  }
                />
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() =>
                  setParagraphs((current) => current.filter((item) => item.id !== paragraph.id))
                }
              >
                删除
              </button>
            </div>
            <textarea
              className="textarea"
              value={paragraph.text}
              aria-label={`第 ${index + 1} 段正文`}
              onChange={(event) => updateParagraph(paragraph.id, { text: event.target.value })}
            />
            <p className="tiny muted" style={{ marginTop: 6 }}>
              证据：{paragraph.evidenceChunkIds.length} 个块
            </p>
          </section>
        ))}

        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() =>
              setParagraphs((current) => [
                ...current,
                {
                  id: `human-${Date.now()}`,
                  section: '定义',
                  text: '',
                  evidenceChunkIds: [],
                  origin: 'human',
                },
              ])
            }
          >
            新增段落
          </button>
        </div>

        <label className="stack" style={{ gap: 4 }}>
          <span className="tiny muted">变更说明</span>
          <input
            className="input"
            value={changeSummary}
            onChange={(event) => setChangeSummary(event.target.value)}
            placeholder="例如：补充限制条件"
          />
        </label>

        <button
          type="button"
          className="btn primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              {
                baseRevisionId,
                content: {
                  summary,
                  paragraphs: paragraphs.map((paragraph) => ({
                    ...paragraph,
                    origin: 'human' as const,
                  })),
                },
                ...(changeSummary ? { changeSummary } : {}),
              },
              {
                onSuccess: () => {
                  toast('已保存新版本');
                  navigate(`/wiki/${slug}`);
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
  );
}

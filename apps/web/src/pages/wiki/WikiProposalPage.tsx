import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/business.js';
import { Badge, ErrorState, SkeletonList, useToast } from '../../components/ui.js';
import { errorMessage } from '../../lib/api-client.js';
import {
  useAcceptProposal,
  useRejectProposal,
  useRewriteProposal,
  useWikiPage,
  useWikiProposal,
} from '../../features/hooks.js';

interface Paragraph {
  id: string;
  section: string;
  text: string;
  evidenceChunkIds: string[];
  origin: 'model' | 'human';
  versionIntroduced?: number;
}

interface PatchOp {
  op: 'add' | 'delete' | 'protected';
  paragraph?: Paragraph;
  paragraphId?: string;
  section?: string;
  reason?: string;
}

const REJECT_REASONS = [
  ['factual_error', '事实错误'],
  ['insufficient_evidence', '证据不足'],
  ['duplicate', '与已有内容重复'],
  ['wrong_ownership', '归属错误'],
  ['wording', '表述不当'],
] as const;

export function WikiProposalPage() {
  const { id } = useParams();
  const proposal = useWikiProposal(id);
  const targetPage = useWikiPage(proposal.data?.targetPage?.slug);
  const accept = useAcceptProposal();
  const reject = useRejectProposal();
  const rewrite = useRewriteProposal();
  const toast = useToast();
  const navigate = useNavigate();

  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [editedAdds, setEditedAdds] = useState<Paragraph[]>([]);

  useEffect(() => {
    const ops = ((proposal.data?.patch as unknown as { ops?: PatchOp[] } | null)?.ops ?? []).filter(
      (op): op is PatchOp & { paragraph: Paragraph } => op.op === 'add' && Boolean(op.paragraph),
    );
    setEditedAdds(ops.map((op) => op.paragraph));
  }, [proposal.data]);

  if (proposal.isLoading) {
    return (
      <div className="page">
        <SkeletonList />
      </div>
    );
  }
  if (proposal.isError || !proposal.data) {
    return (
      <div className="page">
        <ErrorState message={errorMessage(proposal.error)} />
      </div>
    );
  }

  const detail = proposal.data;
  const patch = (detail.patch as unknown as { ops?: PatchOp[]; summary?: string } | null) ?? {};
  const ops = patch.ops ?? [];
  const conflicts =
    (detail.conflicts as unknown as Array<{
      type: string;
      predicate?: string;
      detail?: string;
      a?: { value: string };
      b?: { value: string };
    }> | null) ?? [];

  const baseRevisionId = targetPage.data?.currentRevisionId ?? detail.baseRevisionId ?? undefined;

  return (
    <div className="page">
      <PageHeader
        title={`提案 · ${detail.changeType}`}
        subtitle={
          detail.targetPage
            ? `目标页面：${detail.targetPage.title}`
            : `新建页面：${(detail.patch as { newPage?: { title?: string } })?.newPage?.title ?? ''}`
        }
        actions={
          <Link className="btn" to="/wiki/review">
            返回队列
          </Link>
        }
      />

      {detail.status !== 'pending' ? (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <Badge>{detail.status}</Badge>
          {detail.rejectReason ? (
            <p className="tiny muted" style={{ marginTop: 6 }}>
              拒绝原因：{detail.rejectReason}
              {detail.rejectComment ? ` · ${detail.rejectComment}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {patch.summary ? <p className="muted">{patch.summary}</p> : null}

      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
        {ops.map((op, index) => (
          <section key={index} className="card card-pad">
            <div className="row" style={{ marginBottom: 6 }}>
              <Badge tone={op.op === 'add' ? 'ok' : op.op === 'delete' ? 'bad' : 'warn'}>
                {op.op === 'add' ? '新增段落' : op.op === 'delete' ? '删除段落' : '受保护'}
              </Badge>
              {op.paragraph?.section ?? op.section}
            </div>
            {op.paragraph ? <p>{op.paragraph.text}</p> : null}
            {op.op === 'protected' ? (
              <p className="tiny muted">{op.reason ?? '人工段落受保护，需显式解锁'}</p>
            ) : null}
            {op.op === 'delete' ? <p className="tiny muted">段落 ID：{op.paragraphId}</p> : null}
          </section>
        ))}
      </div>

      {conflicts.length > 0 ? (
        <section className="card card-pad" style={{ marginTop: 12 }}>
          <h3>冲突（{conflicts.length}）</h3>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {conflicts.map((conflict, index) => (
              <div key={index}>
                <Badge tone="warn">{conflict.type}</Badge>
                <p className="tiny">
                  {conflict.predicate ?? ''}：{conflict.a?.value} vs {conflict.b?.value}
                </p>
                <p className="tiny muted">{conflict.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card card-pad" style={{ marginTop: 12 }}>
        <h3>证据</h3>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
          {detail.evidenceChunks.map((chunk) => (
            <Link
              key={chunk.id}
              className="badge"
              to={`/documents/${chunk.documentId}?chunk=${chunk.id}`}
            >
              {chunk.text.slice(0, 18)}…
            </Link>
          ))}
        </div>
      </section>

      {detail.status === 'pending' ? (
        <section className="card card-pad" style={{ marginTop: 12 }}>
          <h3>审核</h3>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn primary"
              disabled={accept.isPending}
              onClick={() =>
                accept.mutate(
                  { id: detail.id, ...(baseRevisionId ? { baseRevisionId } : {}) },
                  {
                    onSuccess: () => {
                      toast('提案已接受');
                      navigate(detail.targetPage ? `/wiki/${detail.targetPage.slug}` : '/wiki');
                    },
                    onError: (error) => toast(errorMessage(error), 'error'),
                  },
                )
              }
            >
              接受
            </button>

            <select
              className="select"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-label="拒绝原因"
            >
              <option value="">选择拒绝原因</option>
              {REJECT_REASONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="补充说明（可选）"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              aria-label="拒绝补充说明"
            />
            <button
              type="button"
              className="btn"
              disabled={reject.isPending}
              onClick={() => {
                if (!reason) {
                  toast('请选择拒绝原因', 'error');
                  return;
                }
                reject.mutate(
                  { id: detail.id, reason, ...(comment ? { comment } : {}) },
                  {
                    onSuccess: () => {
                      toast('提案已拒绝');
                      navigate('/wiki/review');
                    },
                    onError: (error) => toast(errorMessage(error), 'error'),
                  },
                );
              }}
            >
              拒绝
            </button>
          </div>

          {detail.targetPageId && baseRevisionId ? (
            <div className="stack" style={{ gap: 8, marginTop: 16 }}>
              <h4>改写后接受</h4>
              {editedAdds.map((paragraph, index) => (
                <textarea
                  key={paragraph.id}
                  className="textarea"
                  value={paragraph.text}
                  aria-label={`改写段落 ${index + 1}`}
                  onChange={(event) =>
                    setEditedAdds((current) =>
                      current.map((item) =>
                        item.id === paragraph.id ? { ...item, text: event.target.value } : item,
                      ),
                    )
                  }
                />
              ))}
              <button
                type="button"
                className="btn"
                disabled={rewrite.isPending}
                onClick={() => {
                  const baseParagraphs =
                    (
                      targetPage.data?.currentRevision?.content as unknown as {
                        paragraphs?: Paragraph[];
                      } | null
                    )?.paragraphs ?? [];
                  rewrite.mutate(
                    {
                      id: detail.id,
                      baseRevisionId,
                      content: {
                        summary:
                          (
                            targetPage.data?.currentRevision?.content as unknown as {
                              summary?: string;
                            } | null
                          )?.summary ?? '',
                        paragraphs: [
                          ...baseParagraphs,
                          ...editedAdds.map((paragraph) => ({ ...paragraph, origin: 'human' })),
                        ],
                      },
                    },
                    {
                      onSuccess: () => {
                        toast('已改写并接受');
                        navigate(detail.targetPage ? `/wiki/${detail.targetPage.slug}` : '/wiki');
                      },
                      onError: (error) => toast(errorMessage(error), 'error'),
                    },
                  );
                }}
              >
                改写后接受
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CitationText, DegradedNote, PageHeader } from '../../components/business.js';
import { Badge, EmptyState, StatusBadge, useToast } from '../../components/ui.js';
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from '../../features/hooks.js';
import type { Citation, Message } from '../../features/schemas.js';
import { errorMessage } from '../../lib/api-client.js';
import { formatRelative } from '../../lib/format.js';
import { streamAnswer } from '../../lib/sse.js';

interface LiveAnswer {
  content: string;
  phase: 'retrieving' | 'generating' | 'done' | 'no_evidence' | 'error' | 'stopped';
  citations: Citation[];
  degraded: string[];
  error?: string;
  userText: string;
}

export function ResearchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const conversations = useConversations();
  const conversation = useConversation(id);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  const [input, setInput] = useState('');
  const [scopeTag, setScopeTag] = useState('');
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [live?.content, conversation.data?.messages.length]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const messages: Message[] = conversation.data?.messages ?? [];
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const evidenceCitations = live?.citations.length
    ? live.citations
    : (lastAssistant?.citations ?? []);

  const send = async () => {
    const content = input.trim();
    if (content.length === 0 || live) {
      return;
    }

    let conversationId = id;
    if (!conversationId) {
      try {
        const created = await createConversation.mutateAsync(undefined);
        conversationId = created.id;
        navigate(`/research/${created.id}`, { replace: true });
      } catch (error) {
        toast(errorMessage(error), 'error');
        return;
      }
    }

    setInput('');
    setActiveCitation(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setLive({
      content: '',
      phase: 'retrieving',
      citations: [],
      degraded: [],
      userText: content,
    });

    try {
      await streamAnswer(
        conversationId,
        {
          content,
          ...(scopeTag.trim() ? { scope: { tags: [scopeTag.trim()] } } : {}),
        },
        {
          onStatus: (data) =>
            setLive((current) =>
              current
                ? { ...current, phase: data.phase === 'generating' ? 'generating' : current.phase }
                : current,
            ),
          onRetrieval: (data) =>
            setLive((current) => (current ? { ...current, degraded: data.degraded } : current)),
          onDelta: (text) =>
            setLive((current) =>
              current
                ? { ...current, content: current.content + text, phase: 'generating' }
                : current,
            ),
          onCitations: (data) =>
            setLive((current) => (current ? { ...current, citations: data.citations } : current)),
          onDone: (data) =>
            setLive((current) =>
              current
                ? {
                    ...current,
                    phase:
                      data.status === 'no_evidence'
                        ? 'no_evidence'
                        : data.status === 'stopped'
                          ? 'stopped'
                          : 'done',
                  }
                : current,
            ),
          onError: (data) =>
            setLive((current) =>
              current ? { ...current, phase: 'error', error: data.message } : current,
            ),
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setLive((current) =>
          current ? { ...current, phase: 'error', error: errorMessage(error) } : current,
        );
      } else {
        setLive((current) => (current ? { ...current, phase: 'stopped' } : current));
      }
    } finally {
      abortRef.current = null;
      await client.invalidateQueries({ queryKey: ['conversation', conversationId] });
      await client.invalidateQueries({ queryKey: ['conversations'] });
      setLive(null);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="page" style={{ paddingBottom: 24 }}>
      <PageHeader
        title="问答"
        subtitle="每个结论都能点回原文的具体段落"
        actions={
          <button
            type="button"
            className="btn sm"
            onClick={() => navigate('/research')}
            disabled={!id}
          >
            新会话
          </button>
        }
      />

      <div className="chat" style={{ height: 'calc(100dvh - 180px)' }}>
        <div className="chat-main">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && !live ? (
              <EmptyState
                title="问点什么"
                description="例如：混合检索为什么需要 RRF？回答会带上可点击的引用。"
              />
            ) : null}

            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onCite={setActiveCitation}
                activeCitation={activeCitation}
              />
            ))}

            {live ? (
              <>
                <div className="msg user">
                  <div className="role">你</div>
                  {live.userText}
                </div>
                <div className="msg assistant">
                  <div className="role">
                    KnowledgeOS ·{' '}
                    {live.phase === 'retrieving'
                      ? '检索中'
                      : live.phase === 'generating'
                        ? '生成中'
                        : live.phase === 'no_evidence'
                          ? '未找到证据'
                          : live.phase === 'error'
                            ? '生成失败'
                            : live.phase === 'stopped'
                              ? '已停止'
                              : '完成'}
                  </div>
                  {live.content ? (
                    <CitationText
                      text={live.content}
                      citations={live.citations}
                      onSelect={setActiveCitation}
                    />
                  ) : (
                    <p className="tiny muted">
                      {live.phase === 'retrieving' ? '正在检索知识库…' : '正在生成…'}
                    </p>
                  )}
                  {live.error ? (
                    <p className="tiny" style={{ color: 'var(--danger)' }}>
                      {live.error}
                    </p>
                  ) : null}
                  <DegradedNote degraded={live.degraded} />
                </div>
              </>
            ) : null}
          </div>

          <div className="composer">
            <textarea
              value={input}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              aria-label="问题输入"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="stack" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ width: 140 }}
                placeholder="范围：标签"
                value={scopeTag}
                onChange={(event) => setScopeTag(event.target.value)}
                aria-label="检索范围标签"
              />
              {live ? (
                <button type="button" className="btn danger" onClick={stop}>
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void send()}
                  disabled={input.trim().length === 0}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="stack" style={{ minHeight: 0 }}>
          <section className="card card-pad" style={{ flex: 0 }}>
            <h3 style={{ marginBottom: 8 }}>证据</h3>
            {evidenceCitations.length === 0 ? (
              <p className="tiny muted">回答完成后，这里会列出被引用的块。</p>
            ) : (
              <div className="stack" style={{ gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                {evidenceCitations.map((citation) => {
                  const invalid = !(citation.valid ?? citation.isValid ?? true);
                  return (
                    <div
                      key={citation.ordinal}
                      className="evidence-item"
                      style={{
                        border: `1px solid ${invalid ? 'var(--state-danger-border)' : 'var(--line)'}`,
                        borderRadius: 'var(--r-c)',
                      }}
                    >
                      <div className="between" style={{ marginBottom: 4 }}>
                        <span className="mono tiny">[{citation.ordinal}]</span>
                        <Badge tone={invalid ? 'bad' : 'ok'}>
                          {invalid ? '不可验证' : '已验证'}
                        </Badge>
                      </div>
                      <p className="tiny" style={{ marginBottom: 6 }}>
                        {citation.quote}
                      </p>
                      <Link
                        className="tiny"
                        to={`/documents/${citation.documentId}?chunk=${citation.chunkId}`}
                      >
                        打开原文段落
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card card-pad" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div className="between" style={{ marginBottom: 8 }}>
              <h3>会话</h3>
              {id ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={deleteConversation.isPending}
                  onClick={() => {
                    if (!window.confirm('删除这个会话？')) {
                      return;
                    }
                    deleteConversation.mutate(id, {
                      onSuccess: () => navigate('/research'),
                      onError: (error) => toast(errorMessage(error), 'error'),
                    });
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
            {(conversations.data ?? []).length === 0 ? (
              <p className="tiny muted">还没有会话。</p>
            ) : (
              <div className="stack" style={{ gap: 2 }}>
                {conversations.data?.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="side-item"
                    aria-current={item.id === id}
                    onClick={() => navigate(`/research/${item.id}`)}
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="count">{formatRelative(item.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onCite,
  activeCitation,
}: {
  message: Message;
  onCite: (ordinal: number) => void;
  activeCitation: number | null;
}) {
  const check = message.citationCheck;
  const failed = check?.status === 'failed' || check?.status === 'partial';

  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="role">你</div>
        {message.content}
      </div>
    );
  }

  return (
    <div className="msg assistant">
      <div className="between" style={{ marginBottom: 4 }}>
        <div className="role">KnowledgeOS</div>
        <StatusBadge status={message.status} />
      </div>
      {failed ? (
        <p className="tiny" style={{ color: 'var(--danger)', marginBottom: 6 }}>
          引用不可验证
          {check?.outOfRange?.length ? `（越界：${check.outOfRange.join(', ')}）` : ''}
        </p>
      ) : null}
      <CitationText
        text={message.content}
        citations={message.citations.map((citation) => ({
          ...citation,
          valid: citation.valid ?? citation.isValid,
        }))}
        onSelect={onCite}
      />
      {activeCitation !== null ? (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          已选中引用 [{activeCitation}]，右侧可打开原文。
        </p>
      ) : null}
    </div>
  );
}

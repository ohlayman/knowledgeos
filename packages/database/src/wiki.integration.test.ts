import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { WikiPageContent } from '@kos/wiki-engine';
import { afterAll, describe, expect, it } from 'vitest';
import { WikiRepository } from './repositories/wiki.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const prisma = new PrismaClient();
const repo = new WikiRepository(prisma);

const suffix = randomUUID().slice(0, 8);
const contentType = (text: string): WikiPageContent => ({
  summary: `${text} 摘要`,
  paragraphs: [
    {
      id: `p-${text}`,
      section: '定义',
      text: `${text} 的正文段落，至少包含一个证据锚点与足够长度。`.repeat(3),
      evidenceChunkIds: [randomUUID()],
      origin: 'model',
      versionIntroduced: 1,
    },
  ],
});

function dedupe(versionId: string, pageId: string, changeType: string) {
  return createHash('sha256').update(`${versionId}|${pageId}|${changeType}`).digest('hex');
}

describe.skipIf(!enabled)('WikiRepository', () => {
  const pageIds: string[] = [];
  const proposalIds: string[] = [];

  afterAll(async () => {
    if (proposalIds.length > 0) {
      await prisma.wikiProposal.deleteMany({ where: { id: { in: proposalIds } } });
    }
    if (pageIds.length > 0) {
      await prisma.reviewTask.deleteMany({
        where: { targetId: { in: pageIds } },
      });
      await prisma.wikiPage.deleteMany({ where: { id: { in: pageIds } } });
    }
    await prisma.entity.deleteMany({ where: { normalizedName: { startsWith: `wiki-${suffix}` } } });
    await prisma.$disconnect();
  });

  it('creates a page with revisions and supports rollback as a new revision', async () => {
    const page = await repo.createPage({
      slug: `wiki-${suffix}`,
      title: `Wiki ${suffix}`,
      type: 'concept',
      summary: '初始摘要',
    });
    pageIds.push(page.id);

    const first = await repo.createRevision({
      pageId: page.id,
      editorType: 'model',
      content: contentType('第一版'),
      changeSummary: '初始版本',
    });
    const second = await repo.createRevision({
      pageId: page.id,
      editorType: 'human',
      content: contentType('第二版'),
      parentRevisionId: first.id,
      changeSummary: '人工修改',
    });

    expect(second.revisionNo).toBe(2);

    const rolledBack = await repo.rollback(page.id, first.id, '回到初始版本');
    expect(rolledBack.revisionNo).toBe(3);
    expect(rolledBack.editorType).toBe('system');
    expect((rolledBack.content as unknown as WikiPageContent).summary).toBe('第一版 摘要');

    const detail = await repo.getPageById(page.id);
    expect(detail?.currentRevisionId).toBe(rolledBack.id);
    expect(detail?.status).toBe('published');
  });

  it('rejects a proposal whose base revision is stale', async () => {
    const page = await repo.createPage({
      slug: `wiki-stale-${suffix}`,
      title: `Wiki Stale ${suffix}`,
      type: 'technology',
    });
    pageIds.push(page.id);

    const rev1 = await repo.createRevision({
      pageId: page.id,
      editorType: 'model',
      content: contentType('基线'),
      changeSummary: '基线',
    });
    await repo.createRevision({
      pageId: page.id,
      editorType: 'human',
      content: contentType('新版本'),
      parentRevisionId: rev1.id,
      changeSummary: '人工更新',
    });

    const proposal = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      baseRevisionId: rev1.id,
      dedupeKey: dedupe(suffix, page.id, 'update'),
      patch: { ops: [] },
      evidence: {},
    });
    proposalIds.push(proposal.id);

    const result = await repo.acceptProposal(proposal.id, { baseRevisionId: rev1.id });
    expect(result.status).toBe('stale');
    expect(result.proposalStatus).toBe('pending');
  });

  it('accepts a proposal by creating a revision and resolving its review task', async () => {
    const page = await repo.createPage({
      slug: `wiki-accept-${suffix}`,
      title: `Wiki Accept ${suffix}`,
      type: 'concept',
    });
    pageIds.push(page.id);

    const base = await repo.createRevision({
      pageId: page.id,
      editorType: 'model',
      content: { summary: '旧摘要', paragraphs: [] },
      changeSummary: '基线',
    });

    const proposal = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      baseRevisionId: base.id,
      dedupeKey: dedupe(`${suffix}-accept`, page.id, 'update'),
      patch: {
        ops: [{ op: 'add', paragraph: contentType('新增').paragraphs[0] }],
      } as unknown as Prisma.InputJsonValue,
      evidence: { chunkIds: [] },
    });
    proposalIds.push(proposal.id);

    const fromPayload = contentType('新增').paragraphs[0]!;
    const accepted = await repo.acceptProposal(proposal.id, {
      baseRevisionId: base.id,
      reviewerId: null,
      patchOverride: {
        ops: [{ op: 'add', paragraph: { ...fromPayload, evidenceChunkIds: [] } }],
      } as unknown as Prisma.InputJsonValue,
    });

    expect(accepted.status).toBe('accepted');
    const detail = await repo.getPageById(page.id);
    expect(
      (detail?.currentRevision?.content as unknown as WikiPageContent).paragraphs,
    ).toHaveLength(1);
    const taskCount = await prisma.reviewTask.count({
      where: { proposalId: proposal.id, status: 'open' },
    });
    expect(taskCount).toBe(0);
  });

  it('dedupes proposals by key and merges within the compile window', async () => {
    const page = await repo.createPage({
      slug: `wiki-dedupe-${suffix}`,
      title: `Wiki Dedupe ${suffix}`,
      type: 'concept',
    });
    pageIds.push(page.id);

    const key = dedupe(`${suffix}-dedupe`, page.id, 'update');
    const first = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      dedupeKey: key,
      patch: { ops: [] },
      evidence: {},
    });
    proposalIds.push(first.id);

    const second = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      dedupeKey: key,
      patch: { ops: [] },
      evidence: {},
    });
    expect(second.id).toBe(first.id);

    const merged = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      dedupeKey: dedupe(`${suffix}-dedupe-2`, page.id, 'update'),
      patch: {
        ops: [
          {
            op: 'add',
            paragraph: {
              id: `p-merge-${suffix}`,
              section: '定义',
              text: '合并窗口内的新增段落',
              evidenceChunkIds: [randomUUID()],
              origin: 'model',
              versionIntroduced: 1,
            },
          },
        ],
      },
      evidence: {},
      mergeWindowMs: 10 * 60 * 1000,
    });
    expect(merged.id).toBe(first.id);
  });

  it('marks a proposal invalid when its evidence chunks no longer exist', async () => {
    const page = await repo.createPage({
      slug: `wiki-evidence-${suffix}`,
      title: `Wiki Evidence ${suffix}`,
      type: 'concept',
    });
    pageIds.push(page.id);
    const base = await repo.createRevision({
      pageId: page.id,
      editorType: 'model',
      content: { summary: '', paragraphs: [] },
      changeSummary: '基线',
    });

    const proposal = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      baseRevisionId: base.id,
      dedupeKey: dedupe(`${suffix}-evidence`, page.id, 'update'),
      patch: {
        ops: [
          {
            op: 'add',
            paragraph: {
              id: `p-evidence-${suffix}`,
              section: '定义',
              text: '引用了已被删除的块。',
              evidenceChunkIds: [randomUUID()],
              origin: 'model',
              versionIntroduced: 1,
            },
          },
        ],
      },
      evidence: {},
    });
    proposalIds.push(proposal.id);

    const result = await repo.acceptProposal(proposal.id, { baseRevisionId: base.id });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toBe('evidence_missing');
    }

    const stored = await prisma.wikiProposal.findUnique({ where: { id: proposal.id } });
    expect(stored?.status).toBe('invalid');
    expect((stored?.validation as { reason?: string } | null)?.reason).toBe('evidence_missing');
  });

  it('rejects proposals with a structured reason', async () => {
    const page = await repo.createPage({
      slug: `wiki-reject-${suffix}`,
      title: `Wiki Reject ${suffix}`,
      type: 'concept',
    });
    pageIds.push(page.id);

    const proposal = await repo.createProposal({
      targetPageId: page.id,
      changeType: 'update',
      dedupeKey: dedupe(`${suffix}-reject`, page.id, 'update'),
      patch: { ops: [] },
      evidence: {},
    });
    proposalIds.push(proposal.id);

    const rejected = await repo.rejectProposal(proposal.id, {
      reason: 'evidence_insufficient',
      comment: '证据不足',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectReason).toBe('evidence_insufficient');
  });

  it('maintains bidirectional links and backlinks', async () => {
    const from = await repo.createPage({
      slug: `wiki-from-${suffix}`,
      title: `From ${suffix}`,
      type: 'concept',
    });
    const to = await repo.createPage({
      slug: `wiki-to-${suffix}`,
      title: `To ${suffix}`,
      type: 'concept',
    });
    pageIds.push(from.id, to.id);

    await repo.replaceLinks(from.id, [
      { targetSlug: to.slug, relationType: 'DEPENDS_ON', context: '依赖关系说明' },
      { targetSlug: `missing-${suffix}`, relationType: null, context: '待创建页面' },
    ]);

    const backlinks = await repo.getBacklinks(to.id);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]?.fromPageId).toBe(from.id);

    const outgoing = await repo.listLinks(from.id);
    expect(outgoing).toHaveLength(2);
    expect(outgoing.find((link) => link.targetSlug === `missing-${suffix}`)?.toPageId).toBeNull();
  });

  it('marks pages stale when a referenced chunk comes from an older version', async () => {
    const documents = await prisma.document.create({
      data: { id: randomUUID(), title: `wiki-stale-doc-${suffix}` },
    });
    const version = await prisma.documentVersion.create({
      data: {
        id: randomUUID(),
        documentId: documents.id,
        versionNo: 1,
        contentHash: `stale-${suffix}`,
        status: 'ready',
        isCurrent: false,
      },
    });
    const chunk = await prisma.chunk.create({
      data: {
        id: randomUUID(),
        documentId: documents.id,
        versionId: version.id,
        chunkIndex: 0,
        text: '旧版本证据块',
        tokenCount: 5,
        startOffset: 0,
        endOffset: 6,
        searchText: '旧版本证据块',
      },
    });

    const page = await repo.createPage({
      slug: `wiki-mark-${suffix}`,
      title: `Mark ${suffix}`,
      type: 'concept',
    });
    pageIds.push(page.id);
    await repo.createRevision({
      pageId: page.id,
      editorType: 'model',
      content: {
        summary: '引用旧块',
        paragraphs: [
          {
            id: `p-stale-${suffix}`,
            section: '定义',
            text: '引用旧版本块的内容',
            evidenceChunkIds: [chunk.id],
            origin: 'model',
            versionIntroduced: 1,
          },
        ],
      },
      changeSummary: '初始',
    });

    const marked = await repo.markPagesStaleForDocument(documents.id, randomUUID());
    expect(marked.pages).toBeGreaterThanOrEqual(1);

    const detail = await repo.getPageById(page.id);
    expect(detail?.status).toBe('stale');
    const task = await prisma.reviewTask.findFirst({
      where: { targetId: page.id, type: 'stale_review', status: 'open' },
    });
    expect(task).not.toBeNull();

    await prisma.document.deleteMany({ where: { id: documents.id } });
  });
});

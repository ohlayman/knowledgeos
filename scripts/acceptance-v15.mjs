import { randomUUID } from 'node:crypto';
import { compilePage } from '../packages/wiki-engine/dist/index.js';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const runId = randomUUID().slice(0, 6).toUpperCase();
const tag = `AC15${runId}`;
const results = [];
const createdDocuments = [];

function record(id, title, pass, evidence) {
  results.push({ id, pass });
  console.log(`${pass ? '通过' : '失败'}  ${id} ${title}  ${evidence}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function waitFor(check, timeoutMs = 90_000, interval = 800) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) {
      return last;
    }
    await sleep(interval);
  }
  return last;
}

async function ingest(title, content) {
  const response = await api('/documents/text', {
    method: 'POST',
    body: JSON.stringify({ title, content }),
  });
  const documentId = response.body.item.documentId;
  createdDocuments.push(documentId);
  await waitFor(async () => {
    const detail = await api(`/documents/${documentId}`);
    return detail.body.currentVersion?.status === 'ready';
  });
  return documentId;
}

async function pendingProposalForSlug(slug) {
  const list = await api('/wiki/proposals?status=pending&limit=200');
  return list.body.find((proposal) => proposal.patch?.newPage?.slug === slug);
}

async function pendingUpdateForPage(pageId) {
  const list = await api('/wiki/proposals?status=pending&limit=200');
  return list.body.find(
    (proposal) => proposal.targetPageId === pageId && proposal.changeType === 'update',
  );
}

async function getPageByTitle(title) {
  const list = await api('/wiki/pages?limit=200');
  return list.body.find((page) => page.title === title);
}

async function accept(id, baseRevisionId) {
  return api(`/wiki/proposals/${id}/accept`, {
    method: 'POST',
    body: JSON.stringify(baseRevisionId ? { baseRevisionId } : {}),
  });
}

async function waitPage(title) {
  const page = await waitFor(() => getPageByTitle(title));
  if (!page) {
    return null;
  }
  const detail = await api(`/wiki/pages/${encodeURIComponent(page.slug)}`);
  return detail.status === 200 ? detail.body : null;
}

try {
  console.log(`V1.5 验收 ${runId}\n`);

  // AC-V15-1: 已有页面主题的新材料生成更新提案，含段落级 diff 与可解析证据。
  const concept = `${tag}Concept`;
  await ingest(`${tag} 材料A`, `${concept} 是验收用的检索概念。${concept} 使用 RRF 融合两路召回。`);
  const createProposal = await waitFor(() => pendingProposalForSlug(concept.toLowerCase()));
  let ac1 = false;
  if (createProposal) {
    const accepted = await accept(createProposal.id);
    const page = accepted.status === 200 ? await getPageByTitle(concept) : null;
    if (page) {
      await ingest(`${tag} 材料B`, `${concept} 默认使用两路召回。${concept} 增加了时间过滤能力。`);
      const update = await pendingUpdateForPage(page.id);
      const ops = update?.patch?.ops ?? [];
      const chunkIds = (update?.evidence?.chunkIds ?? []).slice(0, 3);
      let chunksResolvable = chunkIds.length > 0;
      for (const chunkId of chunkIds) {
        const chunk = await api(`/chunks/${chunkId}`);
        if (chunk.status !== 200) {
          chunksResolvable = false;
        }
      }
      ac1 = Boolean(
        update &&
        update.baseRevisionId === page.currentRevisionId &&
        ops.some((op) => op.op === 'add') &&
        chunksResolvable,
      );
    }
  }
  record(
    'AC-V15-1',
    '新材料生成更新提案（diff + 证据）',
    ac1,
    ac1 ? '存在 add 段落与可解析证据' : '未生成更新提案',
  );

  const mainPage = await getPageByTitle(concept);

  // AC-V15-2: 两份矛盾材料出现冲突标记，页面显示未裁决冲突。
  const conflictEntity = `${tag}Polarity`;
  await ingest(`${tag} 冲突A`, `${conflictEntity} 支持稀疏向量。`);
  const conflictCreate = await waitFor(() => pendingProposalForSlug(conflictEntity.toLowerCase()));
  let ac2 = false;
  if (conflictCreate) {
    await accept(conflictCreate.id);
    await ingest(`${tag} 冲突B`, `${conflictEntity} 不支持稀疏向量。`);
    const conflicts = await waitFor(async () => {
      const list = await api('/wiki/conflicts');
      return list.body.find((conflict) => conflict.predicate?.includes('稀疏向量'));
    });
    const page = await waitFor(async () => {
      const current = await waitPage(conflictEntity);
      return current && current.unresolvedConflicts > 0 ? current : null;
    });
    ac2 = Boolean(conflicts) && Boolean(page);
  }
  record(
    'AC-V15-2',
    '矛盾材料标记冲突且页面提示',
    ac2,
    ac2 ? '冲突列表与页面提示均存在' : '未检测到冲突',
  );

  // AC-V15-3: 引用块被删除后，提案落库前被拦截并标记 invalid。
  const compileWithMissingEvidence = await compilePage(
    {
      pageType: 'concept',
      entityName: '缺失证据',
      evidence: [{ chunkId: randomUUID(), text: '存在的证据' }],
      facts: [],
      relations: [],
      existing: null,
    },
    {
      model: {
        model: 'acceptance',
        async complete() {
          return {
            text: JSON.stringify({
              paragraphs: [
                {
                  section: '定义',
                  text: '引用了不在允许集合内的块。',
                  evidenceChunkIds: [randomUUID()],
                },
              ],
            }),
          };
        },
      },
    },
  );
  record(
    'AC-V15-3',
    '证据失效时拦截提案',
    compileWithMissingEvidence.status === 'invalid' &&
      compileWithMissingEvidence.reason === 'evidence_not_in_scope',
    `编译结果 ${compileWithMissingEvidence.status}/${compileWithMissingEvidence.reason ?? ''}`,
  );

  // AC-V15-4: 回滚生成新版本且历史完整。
  let ac4 = false;
  if (mainPage) {
    const detail = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}`);
    const first = detail.body.revisions.at(-1);
    const save = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}/revisions`, {
      method: 'POST',
      body: JSON.stringify({
        baseRevisionId: detail.body.currentRevisionId,
        content: { summary: '验收改写', paragraphs: [] },
        changeSummary: '验收人工修改',
      }),
    });
    const rollback = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetRevisionId: first.id, reason: '验收回滚' }),
    });
    const after = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}`);
    ac4 =
      save.status === 201 &&
      rollback.status === 200 &&
      after.body.revisions.length >= 3 &&
      after.body.currentRevisionId === rollback.body.revision.id &&
      rollback.body.revision.editorType === 'system';
  }
  record('AC-V15-4', '回滚生成新版本且历史完整', ac4, ac4 ? '版本链与当前版本正确' : '回滚失败');

  // AC-V15-5: 人工段落不被模型覆盖。
  const humanParagraph = {
    id: 'human-acceptance',
    section: '定义',
    text: '人工确认过的定义段落，模型不得覆盖。',
    evidenceChunkIds: [randomUUID()],
    origin: 'human',
    versionIntroduced: 1,
  };
  const protectedCompile = await compilePage(
    {
      pageType: 'concept',
      entityName: '保护段落',
      evidence: [{ chunkId: humanParagraph.evidenceChunkIds[0], text: '证据' }],
      facts: [],
      relations: [],
      existing: { summary: '', paragraphs: [humanParagraph] },
    },
    {
      model: {
        model: 'acceptance',
        async complete() {
          return {
            text: JSON.stringify({
              paragraphs: [
                {
                  section: '定义',
                  text: humanParagraph.text,
                  evidenceChunkIds: humanParagraph.evidenceChunkIds,
                },
              ],
            }),
          };
        },
      },
    },
  );
  record(
    'AC-V15-5',
    '人工段落受保护',
    protectedCompile.status === 'ok' &&
      protectedCompile.patch.some((op) => op.op === 'protected') &&
      protectedCompile.content.paragraphs[0].origin === 'human',
    protectedCompile.status,
  );

  // AC-V15-6: 旧 baseRevisionId 的接受被拒绝。
  let ac6 = false;
  if (mainPage) {
    const page = await waitPage(concept);
    const update = await pendingUpdateForPage(page.id);
    if (update && page.currentRevisionId) {
      // 先人工写入新版本，制造提案基于旧版本的情形。
      await api(`/wiki/pages/${encodeURIComponent(page.slug)}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          baseRevisionId: page.currentRevisionId,
          content: { summary: '并发修改', paragraphs: [] },
        }),
      });
      const rejected = await accept(update.id, update.baseRevisionId ?? page.currentRevisionId);
      ac6 = rejected.status === 409;
    }
  }
  record('AC-V15-6', '旧版本接受被拒绝', ac6, ac6 ? '返回 409' : '未拦截');

  // AC-V15-7: 拒绝必须选择结构化原因。
  let ac7 = false;
  const rejectCandidate = (await api('/wiki/proposals?status=pending&limit=200')).body[0];
  if (rejectCandidate) {
    const missingReason = await api(`/wiki/proposals/${rejectCandidate.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const withReason = await api(`/wiki/proposals/${rejectCandidate.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'insufficient_evidence', comment: '验收拒绝' }),
    });
    ac7 = missingReason.status === 400 && withReason.status === 200;
  }
  record('AC-V15-7', '拒绝原因结构化校验', ac7, ac7 ? '缺少原因 400，带原因成功' : '校验失败');

  // AC-V15-8: 来源文档更新后页面标记 stale 并生成待办。
  let ac8 = false;
  if (mainPage) {
    const page = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}`);
    const chunkId = page.body.revisions.flatMap((revision) => revision.evidenceChunkIds)[0];
    if (chunkId) {
      const chunk = await api(`/chunks/${chunkId}`);
      const document = await api(`/documents/${chunk.body.documentId}`);
      await api('/documents/text', {
        method: 'POST',
        body: JSON.stringify({
          title: document.body.title,
          content: `${concept} 的来源文档更新为新版本，补充了新的限制条件。`,
        }),
      });
      const stale = await waitFor(async () => {
        const current = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}`);
        return current.body.status === 'stale';
      });
      const tasks = await api('/wiki/review-tasks?status=open');
      ac8 = Boolean(stale) && tasks.body.some((task) => task.type === 'stale_review');
    }
  }
  record('AC-V15-8', '来源更新触发过期标记与待办', ac8, ac8 ? '页面 stale + 复核待办' : '未触发');

  // AC-V15-9: 页面段落均有可解析证据锚点。
  let ac9 = false;
  const anchorChunk = mainPage
    ? (await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}`)).body.revisions.flatMap(
        (revision) => revision.evidenceChunkIds,
      )[0]
    : null;
  if (anchorChunk) {
    for (let index = 0; index < 20; index += 1) {
      const title = `${tag} 锚点页 ${index}`;
      const created = await api('/wiki/pages', {
        method: 'POST',
        body: JSON.stringify({ title, type: 'concept' }),
      });
      await api(`/wiki/pages/${encodeURIComponent(created.body.slug)}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          baseRevisionId: created.body.currentRevisionId,
          content: {
            summary: '锚点验收',
            paragraphs: [
              {
                id: `p-${tag}-${index}`,
                section: '定义',
                text: `第 ${index} 个验收页面的正文段落，包含一个可解析证据锚点。`,
                evidenceChunkIds: [anchorChunk],
                origin: 'human',
                versionIntroduced: 1,
              },
            ],
          },
        }),
      });
    }
    const pages = (await api('/wiki/pages?limit=200')).body.filter((page) =>
      page.title.startsWith(`${tag} 锚点页`),
    );
    let anchorsOk = pages.length === 20;
    for (const page of pages) {
      const detail = await api(`/wiki/pages/${encodeURIComponent(page.slug)}`);
      const paragraphs = detail.body.currentRevision?.content?.paragraphs ?? [];
      for (const paragraph of paragraphs) {
        for (const chunkId of paragraph.evidenceChunkIds ?? []) {
          const chunk = await api(`/chunks/${chunkId}`);
          if (chunk.status !== 200) {
            anchorsOk = false;
          }
        }
        if ((paragraph.evidenceChunkIds ?? []).length === 0) {
          anchorsOk = false;
        }
      }
    }
    ac9 = anchorsOk;
  }
  record('AC-V15-9', '20 个页面段落均有可解析证据', ac9, ac9 ? '20/20 通过' : '存在缺失锚点');

  // AC-V15-10: 反链自动出现。
  let ac10 = false;
  {
    const from = await api('/wiki/pages', {
      method: 'POST',
      body: JSON.stringify({ title: `${tag} 反链来源`, type: 'concept' }),
    });
    const to = await api('/wiki/pages', {
      method: 'POST',
      body: JSON.stringify({ title: `${tag} 反链目标`, type: 'concept' }),
    });
    await api(`/wiki/pages/${encodeURIComponent(from.body.slug)}/revisions`, {
      method: 'POST',
      body: JSON.stringify({
        baseRevisionId: from.body.currentRevisionId,
        content: {
          summary: '',
          paragraphs: [
            {
              id: `p-${tag}-link`,
              section: '定义',
              text: `参见 [[${tag} 反链目标]] 的说明。`,
              evidenceChunkIds: [],
              origin: 'human',
              versionIntroduced: 1,
            },
          ],
        },
      }),
    });
    const target = await api(`/wiki/pages/${encodeURIComponent(to.body.slug)}`);
    ac10 = target.body.backlinks.some((backlink) => backlink.fromPage.slug === from.body.slug);
  }
  record('AC-V15-10', '反链自动出现', ac10, ac10 ? '反链面板含来源页' : '无反链');

  // AC-V15-11: 同一版本重复触发不产生重复提案。
  let ac11 = false;
  if (mainPage) {
    const page = await api(`/wiki/pages/${encodeURIComponent(mainPage.slug)}`);
    const chunkId = page.body.revisions.flatMap((revision) => revision.evidenceChunkIds)[0];
    if (chunkId) {
      const chunk = await api(`/chunks/${chunkId}`);
      await api('/wiki/extract', {
        method: 'POST',
        body: JSON.stringify({ documentId: chunk.body.documentId }),
      });
      await sleep(5000);
      const afterFirst = (await api('/wiki/proposals?limit=200')).body;
      await api('/wiki/extract', {
        method: 'POST',
        body: JSON.stringify({ documentId: chunk.body.documentId }),
      });
      await sleep(5000);
      const afterSecond = (await api('/wiki/proposals?limit=200')).body;
      const keys = new Set(afterSecond.map((proposal) => proposal.dedupeKey));
      ac11 = afterSecond.length === afterFirst.length && afterSecond.length === keys.size;
    }
  }
  record('AC-V15-11', '重复编译不产生重复提案', ac11, ac11 ? '提案数与去重键稳定' : '出现重复提案');

  // AC-V15-12: 超过 12 段提示拆分。
  const split = await compilePage(
    {
      pageType: 'concept',
      entityName: '超长页面',
      evidence: [{ chunkId: randomUUID(), text: '证据' }],
      facts: [],
      relations: [],
      existing: null,
    },
    {
      model: {
        model: 'acceptance',
        async complete() {
          return {
            text: JSON.stringify({
              paragraphs: Array.from({ length: 13 }, (_, index) => ({
                section: '定义',
                text: `第 ${index} 段。`,
                evidenceChunkIds: [],
              })),
            }),
          };
        },
      },
    },
  );
  const splitWithEvidence = await compilePage(
    {
      pageType: 'concept',
      entityName: '超长页面',
      evidence: [{ chunkId: randomUUID(), text: '证据' }],
      facts: [],
      relations: [],
      existing: null,
    },
    {
      model: {
        model: 'acceptance',
        async complete() {
          const id = randomUUID();
          return {
            text: JSON.stringify({
              paragraphs: Array.from({ length: 13 }, (_, index) => ({
                section: '定义',
                text: `第 ${index} 段。`,
                evidenceChunkIds: [id],
              })),
            }),
          };
        },
      },
    },
  );
  record(
    'AC-V15-12',
    '超过 12 段提示拆分',
    splitWithEvidence.status === 'needs_split',
    `${split.status}/${splitWithEvidence.status}`,
  );
} catch (error) {
  console.error('\n验收中断：', error.message);
  results.push({ id: '执行过程', pass: false });
} finally {
  for (const id of createdDocuments) {
    await api(`/documents/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

const failed = results.filter((item) => !item.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  process.exit(1);
}

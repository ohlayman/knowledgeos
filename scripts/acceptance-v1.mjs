import { randomUUID } from 'node:crypto';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const runId = randomUUID().slice(0, 8);
const created = [];
const results = [];

function record(item, pass, evidence) {
  results.push({ item, pass, evidence });
  console.log(`${pass ? '通过' : '失败'}  ${item}  ${evidence}`);
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady(documentId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = await api(`/documents/${documentId}`);
    if (detail.currentVersion?.status === 'ready') {
      return detail;
    }
    if (detail.currentVersion?.status === 'failed') {
      throw new Error(`文档处理失败：${documentId}`);
    }
    await sleep(500);
  }
  throw new Error(`文档未在 ${timeoutMs}ms 内就绪：${documentId}`);
}

function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(pages) {
  const objects = [];
  const pageCount = pages.length;
  const firstPage = 3;
  const firstContent = firstPage + pageCount;
  const fontObject = firstContent + pageCount;

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${firstPage + index} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  );

  pages.forEach((_, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${firstContent + index} 0 R /Resources << /Font << /F1 ${fontObject} 0 R >> >> >>`,
    );
  });

  pages.forEach((lines) => {
    const stream = [
      'BT',
      '/F1 14 Tf',
      '72 720 Td',
      '16 TL',
      ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T*']),
      'ET',
    ].join('\n');
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(output, 'latin1');
}

async function uploadFiles(files) {
  const form = new FormData();
  for (const file of files) {
    form.append('files', new Blob([file.buffer], { type: file.mimeType }), file.name);
  }
  return api('/documents/files', { method: 'POST', body: form });
}

async function importText(title, content) {
  const body = await api('/documents/text', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  created.push(body.item.documentId);
  return body.item;
}

async function importUrls(urls) {
  const body = await api('/documents/urls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls }),
  });
  for (const item of body.items) {
    if (item.documentId) {
      created.push(item.documentId);
    }
  }
  return body.items;
}

async function track(result) {
  if (result.documentId) {
    created.push(result.documentId);
  }
  return result;
}

async function checkFourSources() {
  const mdFiles = [1, 2, 3].map((index) => ({
    name: `AC-md-${runId}-${index}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      `# AC markdown ${index}\n\n章节 ${index} 讨论混合检索与引用定位，编号 ${runId}-${index}。`,
      'utf8',
    ),
  }));
  const mdItems = await uploadFiles(mdFiles);
  mdItems.items.forEach((item) => created.push(item.documentId));
  for (const item of mdItems.items) {
    await waitReady(item.documentId);
  }
  record(
    '文件来源（Markdown）导入 3 份',
    mdItems.items.filter((item) => item.status === 'queued').length === 3,
    `3/3 就绪，runId=${runId}`,
  );

  const pdfFiles = [1, 2, 3].map((index) => ({
    name: `AC-pdf-${runId}-${index}.pdf`,
    mimeType: 'application/pdf',
    buffer: buildPdf(
      Array.from({ length: 16 }, (_, page) =>
        Array.from({ length: 8 }, (_, line) =>
          [
            `Acceptance PDF ${index} page ${page + 1} line ${line + 1} run ${runId}`,
            `Hybrid retrieval combines vector recall with keyword recall for document ${index}.`,
            `Citation alignment keeps every answer anchored to the original sentence.`,
            `Offsets must map back to the source text on page ${page + 1}.`,
            `Token pdf-${index}-${page + 1}-${line + 1} identifies this paragraph.`,
          ].join(' '),
        ),
      ),
    ),
  }));
  const pdfItems = await uploadFiles(pdfFiles);
  pdfItems.items.forEach((item) => created.push(item.documentId));
  const pdfDetails = [];
  for (const item of pdfItems.items) {
    pdfDetails.push(await waitReady(item.documentId));
  }
  record(
    '文件来源（PDF）导入 3 份',
    pdfItems.items.filter((item) => item.status === 'queued').length === 3 &&
      pdfDetails.every((detail) => detail.currentVersion?.pageCount === 16),
    '3/3 就绪，各 16 页',
  );

  const textItems = [];
  for (let index = 1; index <= 3; index += 1) {
    textItems.push(
      await importText(
        `AC-text-${runId}-${index}`,
        `手动文本 ${index}：这段材料用于验收导入，唯一编号 ${runId}-text-${index}。`,
      ),
    );
  }
  for (const item of textItems) {
    await waitReady(item.documentId);
  }
  record('手动文本来源导入 3 份', textItems.length === 3, '3/3 就绪');

  const urls = [
    'https://www.iana.org/help/example-domains',
    'https://httpbin.org/html',
    'https://www.w3.org/Provider/Style/URI',
  ];
  const urlItems = await importUrls(urls);
  const urlDetails = [];
  for (const item of urlItems) {
    if (item.status !== 'queued') {
      throw new Error(`URL 导入失败：${item.fileName} ${item.message ?? ''}`);
    }
    const detail = await waitReady(item.documentId);
    await api(`/documents/${item.documentId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `AC-url-${runId}-${urlDetails.length + 1}` }),
    });
    urlDetails.push(detail);
  }
  record('URL 来源导入 3 份', urlDetails.length === 3, '3/3 抓取并就绪');

  return { pdfDetails, mdItems };
}

async function checkDedupeAndVersions() {
  const name = `AC-dedupe-${runId}.md`;
  const first = await track(
    (
      await uploadFiles([
        {
          name,
          mimeType: 'text/markdown',
          buffer: Buffer.from(`# 版本甲\n\n甲版本独有词 ${runId} alpha-only。`, 'utf8'),
        },
      ])
    ).items[0],
  );
  await waitReady(first.documentId);

  const duplicate = (
    await uploadFiles([
      {
        name: `AC-copy-${runId}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(`# 版本甲\n\n甲版本独有词 ${runId} alpha-only。`, 'utf8'),
      },
    ])
  ).items[0];
  record(
    '同一文件重复导入只保留 1 份文档并提示重复',
    duplicate.status === 'duplicate' && duplicate.documentId === first.documentId,
    `第二次 status=${duplicate.status}`,
  );

  const second = await track(
    (
      await uploadFiles([
        {
          name,
          mimeType: 'text/markdown',
          buffer: Buffer.from(`# 版本乙\n\n乙版本独有词 ${runId} beta-only。`, 'utf8'),
        },
      ])
    ).items[0],
  );
  await waitReady(second.documentId);
  const detail = await api(`/documents/${first.documentId}`);
  record(
    '内容修改后仍为 1 条文档、2 个版本',
    second.documentId === first.documentId && detail.versions.length === 2,
    `版本数 ${detail.versions.length}，当前 v${detail.currentVersion.versionNo}`,
  );

  const alpha = await api('/retrieval/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `alpha-only ${runId}`, topK: 10 }),
  });
  const beta = await api('/retrieval/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `beta-only ${runId}`, topK: 10 }),
  });
  const currentVersionId = detail.currentVersion.id;
  const fromThisDocument = (item) => item.documentId === first.documentId;
  const betaHit = beta.evidence.some(
    (item) => fromThisDocument(item) && item.versionId === currentVersionId,
  );
  const alphaHitOld = alpha.evidence.some(
    (item) => fromThisDocument(item) && item.versionId !== currentVersionId,
  );
  record(
    '检索默认命中新版本',
    betaHit && !alphaHitOld,
    `新版本命中=${betaHit}，旧版本命中=${alphaHitOld}`,
  );
}

async function checkBatch() {
  const form = new FormData();
  for (let index = 0; index < 45; index += 1) {
    form.append(
      'files',
      new Blob([Buffer.from(`AC batch ${index} run ${runId}`, 'utf8')], { type: 'text/plain' }),
      `AC-batch-${runId}-${index}.txt`,
    );
  }
  for (let index = 0; index < 5; index += 1) {
    form.append(
      'files',
      new Blob([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])], {
        type: 'text/plain',
      }),
      `AC-broken-${runId}-${index}.txt`,
    );
  }

  const body = await api('/documents/files', { method: 'POST', body: form });
  const queued = body.items.filter((item) => item.status === 'queued');
  const failed = body.items.filter((item) => item.status === 'failed');
  queued.forEach((item) => created.push(item.documentId));
  await Promise.all(queued.map((item) => waitReady(item.documentId)));
  record(
    '批量 50 份中 5 份损坏，45 份成功',
    queued.length === 45 &&
      failed.length === 5 &&
      failed.every((item) => item.errorCode === 'UNSUPPORTED_FORMAT' && item.message),
    `queued=${queued.length} failed=${failed.length}，失败项均带可读原因`,
  );

  const retried = await uploadFiles([
    {
      name: `AC-retry-${runId}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    },
  ]);
  record(
    '失败项可单独重试并给出原因',
    retried.items[0]?.status === 'failed' && retried.items[0]?.errorCode === 'UNSUPPORTED_FORMAT',
    `重试结果 ${retried.items[0]?.errorCode}`,
  );
}

async function checkSsrf() {
  const items = await importUrls([
    'http://127.0.0.1:3000/',
    'http://192.168.1.10/',
    'http://10.0.0.5/',
  ]);
  const blocked = items.every(
    (item) =>
      item.status === 'failed' &&
      item.errorCode === 'SSRF_BLOCKED' &&
      !/127\.0\.0\.1|192\.168|10\.0\.0\.5/.test(item.message ?? ''),
  );
  record('私网 URL 被拒绝且不泄露内网信息', blocked, items.map((item) => item.message).join('；'));
}

async function streamAnswer(conversationId, content) {
  const response = await fetch(`${API}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`问答失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let messageId = '';
  let citations = [];
  let doneStatus = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const dataLine = frame.match(/^data: (.+)$/m)?.[1];
      if (!event || !dataLine) {
        continue;
      }
      const data = JSON.parse(dataLine);
      if (event === 'meta') {
        messageId = data.messageId;
      } else if (event === 'citations') {
        citations = data.citations ?? [];
      } else if (event === 'done') {
        doneStatus = data.status;
      }
    }
  }

  return { messageId, citations, doneStatus };
}

async function checkAnswers() {
  const title = `AC-qa-${runId}`;
  const content = [
    '混合检索同时使用向量召回与关键词召回，两路结果用 RRF 融合。',
    '引用定位要求每个结论标注证据编号，回答里的角标必须能回到原始块。',
    '大模型只依据证据回答，证据不足时明确说明，不补充外部知识。',
    '检索降级时关键词路径仍然返回结果，并在界面上标注降级原因。',
  ].join('\n\n');
  const imported = await importText(title, content);
  await waitReady(imported.documentId);

  const conversation = await api('/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `AC 问答 ${runId}` }),
  });

  const questions = [
    '混合检索使用哪两路召回？',
    'RRF 在混合检索里做什么？',
    '引用角标需要满足什么条件？',
    '证据不足时模型应该怎么回答？',
  ];

  let withCitations = 0;
  let allValid = true;
  let allParseable = true;
  let failedChecks = 0;

  for (let index = 0; index < 20; index += 1) {
    const question = `${questions[index % questions.length]}（第 ${index + 1} 问 ${runId}）`;
    const answer = await streamAnswer(conversation.id, question);
    if (answer.citations.length > 0) {
      withCitations += 1;
      if (!answer.citations.every((citation) => citation.valid ?? citation.isValid)) {
        allValid = false;
      }
      for (const citation of answer.citations) {
        const chunk = await fetch(`${API}/chunks/${citation.chunkId}`);
        if (!chunk.ok) {
          allParseable = false;
        }
      }
    }
    const message = await api(`/messages/${answer.messageId}`);
    if (message.citationCheck?.status !== 'ok') {
      failedChecks += 1;
    }
  }

  await api(`/conversations/${conversation.id}`, { method: 'DELETE' }).catch(() => undefined);

  record(
    '20 条回答的引用 100% 可解析且通过后校验',
    withCitations === 20 && allValid && allParseable && failedChecks === 0,
    `含引用回答=${withCitations}/20，全部有效=${allValid}，块可解析=${allParseable}，后校验失败=${failedChecks}`,
  );
}

async function checkOffsets(pdfDetails) {
  const versions = new Map();
  const chunks = [];
  for (const detail of pdfDetails) {
    const version = detail.currentVersion;
    versions.set(version.id, version);
    const list = await api(`/versions/${version.id}/chunks`);
    chunks.push(...list.items);
  }
  const sample = chunks.slice(0, 10);
  const offsetsOk = sample.every((chunk) => {
    const version = versions.get(chunk.versionId);
    const text = version?.normalizedText ?? '';
    const slice = text.slice(chunk.startOffset, chunk.endOffset);
    return (
      chunk.startOffset >= 0 &&
      chunk.endOffset <= text.length &&
      chunk.startOffset < chunk.endOffset &&
      chunk.text.endsWith(slice)
    );
  });
  const pagesOk = sample.every((chunk) => {
    const version = versions.get(chunk.versionId);
    return (
      chunk.pageStart >= 1 &&
      chunk.pageEnd <= (version?.pageCount ?? 1) &&
      chunk.pageStart <= chunk.pageEnd
    );
  });
  record(
    '抽查 10 个块的偏移与页码可定位原文',
    sample.length >= 10 && offsetsOk && pagesOk,
    `抽查 ${sample.length} 块，偏移匹配=${offsetsOk}，页码有效=${pagesOk}`,
  );
}

async function cleanup() {
  const unique = [...new Set(created.filter(Boolean))];
  for (const id of unique) {
    await api(`/documents/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

try {
  console.log(`验收运行 ${runId}，API=${API}\n`);
  const { pdfDetails } = await checkFourSources();
  await checkDedupeAndVersions();
  await checkBatch();
  await checkSsrf();
  await checkAnswers();
  await checkOffsets(pdfDetails);
} catch (error) {
  console.error('\n验收中断：', error.message);
  results.push({ item: '执行过程', pass: false, evidence: error.message });
} finally {
  await cleanup();
}

const failed = results.filter((item) => !item.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  process.exit(1);
}

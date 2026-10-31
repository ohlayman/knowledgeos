import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { loadEnvFile, repoRoot, runPgRestore } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const env = { ...loadEnvFile(), ...process.env };
const file = arg('file');
if (!file) {
  console.error(
    '用法：pnpm restore --file backup/knowledgeos-<time>.dump [--objects backup/objects-<time>.zip] [--database-url URL]',
  );
  process.exit(1);
}

const dumpPath = resolve(repoRoot, file);
if (!existsSync(dumpPath)) {
  console.error(`找不到备份文件：${dumpPath}`);
  process.exit(1);
}

const databaseUrl = arg('database-url') ?? env.DATABASE_URL;
if (!databaseUrl) {
  console.error('未提供 DATABASE_URL');
  process.exit(1);
}

const dumpBuffer = readFileSync(dumpPath);
const mode = runPgRestore(databaseUrl, dumpPath, dumpBuffer);
console.log(`数据库已恢复（${mode}）：${file}`);

const objectsArg = arg('objects');
if (objectsArg) {
  const zipPath = resolve(repoRoot, objectsArg);
  if (!existsSync(zipPath)) {
    console.error(`找不到对象包：${zipPath}`);
    process.exit(1);
  }
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const dataDir = resolve(repoRoot, env.DATA_DIR ?? './data');
  const objectsDir = join(dataDir, 'objects');
  mkdirSync(objectsDir, { recursive: true });

  let extracted = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }
    const target = join(objectsDir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await entry.async('nodebuffer'));
    extracted += 1;
  }
  console.log(`对象已恢复：${extracted} 个文件 → ${objectsDir}`);
}

console.log('下一步：');
console.log('  1. 启动 API 与 worker：pnpm --filter @kos/api dev / pnpm --filter @kos/worker dev');
console.log('  2. 对账任务会自动补建向量；也可在任务页对失败任务整单重试');
console.log('  3. 打开 Dashboard 确认文档与 Chunk 数量');

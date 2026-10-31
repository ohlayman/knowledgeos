import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { databaseTarget, loadEnvFile, repoRoot, runPgDump, sha256 } from './lib.mjs';

const env = { ...loadEnvFile(), ...process.env };
const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL 未配置，无法备份');
  process.exit(1);
}

const dataDir = resolve(repoRoot, env.DATA_DIR ?? './data');
const objectsDir = join(dataDir, 'objects');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join(repoRoot, 'backup');
mkdirSync(backupDir, { recursive: true });

const dumpFile = join(backupDir, `knowledgeos-${stamp}.dump`);

let dumpBytes;
let dumpMode = 'host';
const dumpResult = runPgDump(databaseUrl, dumpFile);
if (typeof dumpResult === 'string') {
  dumpMode = dumpResult;
  dumpBytes = readFileSync(dumpFile);
} else {
  dumpMode = dumpResult.mode;
  dumpBytes = dumpResult.buffer;
  writeFileSync(dumpFile, dumpBytes);
}

async function zipDirectory(directory) {
  const zip = new JSZip();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        zip.file(relative(directory, path).replaceAll('\\', '/'), readFileSync(path));
      }
    }
  };
  if (statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    walk(directory);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const objectsZip = await zipDirectory(objectsDir);
const objectsFile = join(backupDir, `objects-${stamp}.zip`);
writeFileSync(objectsFile, objectsZip);

const target = databaseTarget(databaseUrl);
const manifest = {
  createdAt: new Date().toISOString(),
  database: { host: new URL(databaseUrl).host, database: target.database, mode: dumpMode },
  files: [
    { name: `knowledgeos-${stamp}.dump`, bytes: dumpBytes.length, sha256: sha256(dumpBytes) },
    { name: `objects-${stamp}.zip`, bytes: objectsZip.length, sha256: sha256(objectsZip) },
  ],
};

const manifestFile = join(backupDir, `manifest-${stamp}.json`);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

console.log('备份完成：');
for (const file of manifest.files) {
  console.log(`  ${file.name}  ${file.bytes} bytes  sha256=${file.sha256.slice(0, 16)}…`);
}
console.log(`  清单：${relative(repoRoot, manifestFile)}`);
console.log('提示：向量不备份，恢复后由对账任务重建。');

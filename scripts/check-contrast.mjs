import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './lib.mjs';

const css = readFileSync(resolve(repoRoot, 'apps/web/src/styles/tokens.css'), 'utf8');

function parseBlock(selector) {
  const start = css.indexOf(selector);
  if (start < 0) {
    throw new Error(`找不到主题块：${selector}`);
  }
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const tokens = {};
  for (const line of css.slice(open + 1, close).split('\n')) {
    const match = line.match(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/);
    if (match) {
      tokens[match[1]] = match[2].toLowerCase();
    }
  }
  return tokens;
}

function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (offset) => {
    const c = ((value >> offset) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const REQUIRED = [
  ['ink-900', 'paper-0'],
  ['ink-900', 'paper-1'],
  ['ink-700', 'paper-0'],
  ['ink-700', 'paper-1'],
  ['ink-700', 'paper-2'],
  ['ink-500', 'paper-0'],
  ['ink-500', 'paper-1'],
  ['ink-500', 'paper-2'],
  ['accent', 'paper-0'],
  ['accent', 'paper-1'],
  ['on-accent', 'accent'],
  ['ink-900', 'highlight'],
  ['ink-700', 'highlight'],
];

const themes = {
  浅色: parseBlock(':root'),
  深色: parseBlock("[data-theme='dark']"),
};

let failed = 0;

for (const [name, tokens] of Object.entries(themes)) {
  console.log(`\n${name}主题`);
  for (const [foreground, background] of REQUIRED) {
    const ratio = contrast(tokens[foreground], tokens[background]);
    const pass = ratio >= 4.5;
    if (!pass) {
      failed += 1;
    }
    console.log(
      `  ${pass ? '通过' : '不足'}  --${foreground} / --${background}  ${ratio.toFixed(2)}:1`,
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} 组正文对比度低于 4.5:1`);
  process.exit(1);
}

console.log('\n全部正文对比度 ≥ 4.5:1');

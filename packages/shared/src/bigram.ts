export function buildSearchText(raw: string): string {
  const tokens: string[] = [];

  for (const segment of raw.split(/[\s，。！？；：、,.!?;:()[\]{}"'“”‘’—–-]+/)) {
    if (!segment) {
      continue;
    }
    if (/^\p{ASCII}+$/u.test(segment)) {
      tokens.push(segment.toLowerCase());
      continue;
    }

    const chars = Array.from(segment);
    if (chars.length === 1) {
      tokens.push(segment);
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.push(`${chars[index]}${chars[index + 1]}`);
    }
  }

  return tokens.join(' ');
}

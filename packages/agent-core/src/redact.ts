const SECRET_KEY = /(api[-_]?key|token|secret|password|authorization|cookie)/i;
const PATH_VALUE = /^(?:[A-Za-z]:[\\/]|\/)[^\s]*$/;
const MAX_DEPTH = 6;

export function redactParams(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactParams(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) {
        const keepTail = !/password/i.test(key) && typeof entry === 'string' && entry.length > 4;
        output[key] = keepTail ? `••••${entry.slice(-4)}` : '••••';
        continue;
      }
      if (typeof entry === 'string' && PATH_VALUE.test(entry)) {
        output[key] = '<path>';
        continue;
      }
      output[key] = redactParams(entry, depth + 1);
    }
    return output;
  }
  return value;
}

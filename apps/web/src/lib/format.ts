export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatRelative(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) {
    return '—';
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  processing: '处理中',
  ready: '就绪',
  failed: '失败',
  needs_ocr: '需要 OCR',
  expired: '已过期',
  running: '运行中',
  succeeded: '已完成',
  canceled: '已取消',
  pending: '等待',
  skipped: '跳过',
  complete: '完成',
  stopped: '已停止',
  streaming: '生成中',
  parse: '解析',
  clean: '清洗',
  metadata: '元数据',
  dedupe: '去重',
  chunk: '切块',
  embed: '向量化',
  index: '索引',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string): 'ok' | 'warn' | 'bad' | '' {
  if (status === 'ready' || status === 'succeeded' || status === 'complete') {
    return 'ok';
  }
  if (status === 'failed' || status === 'needs_ocr' || status === 'expired') {
    return 'bad';
  }
  if (status === 'queued' || status === 'processing' || status === 'running') {
    return 'warn';
  }
  return '';
}
